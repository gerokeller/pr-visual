import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { captureAllVariants } from "../../scripts/pr-visual/capture.js";
import type { Scenario } from "../../scripts/pr-visual/types.js";

const FIXTURE_PORT = 3996;
const FIXTURE_URL = `http://localhost:${FIXTURE_PORT}`;
const FIXTURE_APP = path.resolve(__dirname, "../fixtures/app.js");

let fixtureServer: ChildProcess;
let outputDir: string;

beforeAll(async () => {
  fixtureServer = spawn("node", [FIXTURE_APP], {
    env: { ...process.env, PORT: String(FIXTURE_PORT) },
    stdio: "pipe",
  });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${FIXTURE_URL}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) break;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-pacing-"));
});

afterAll(() => {
  fixtureServer?.kill();
  if (outputDir) fs.rmSync(outputDir, { recursive: true, force: true });
});

function scenarioWithPacing(
  pacing: "quick" | "dramatic"
): Scenario {
  return {
    name: `pacing-${pacing}`,
    description: `Probe pacing=${pacing}`,
    steps: [
      {
        action: "navigate",
        url: FIXTURE_URL,
        caption: "Load the fixture",
        pacing,
      },
      {
        action: "screenshot",
        caption: "Snapshot after nav",
        pacing,
      },
    ],
  };
}

describe("adaptive pacing — end-to-end timing", () => {
  it(
    "dramatic pacing produces a visibly longer run than quick for the same scenario",
    async () => {
      const quickResults = await captureAllVariants(
        [scenarioWithPacing("quick")],
        FIXTURE_URL,
        outputDir
      );
      const dramaticResults = await captureAllVariants(
        [scenarioWithPacing("dramatic")],
        FIXTURE_URL,
        outputDir
      );

      // Compare desktop+light variants for both (same (viewport, colorScheme)
      // so Playwright overhead is symmetrical).
      const quickDesktop = quickResults.find(
        (r) => r.viewport.name === "desktop" && r.colorScheme === "light"
      )!;
      const dramaticDesktop = dramaticResults.find(
        (r) => r.viewport.name === "desktop" && r.colorScheme === "light"
      )!;

      const quickTotalMs =
        quickDesktop.captions[quickDesktop.captions.length - 1]!.endMs;
      const dramaticTotalMs =
        dramaticDesktop.captions[dramaticDesktop.captions.length - 1]!.endMs;

      // Two steps: quick floor 900 × 2 = 1800ms of holds.
      //            dramatic floor 3200 × 2 = 6400ms of holds + 2× 800ms pre-settle.
      // Expected delta is at least ~5s; assert a conservative 3s to avoid flake.
      expect(dramaticTotalMs - quickTotalMs).toBeGreaterThan(3000);
    },
    120_000
  );
});
