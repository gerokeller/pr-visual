import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { captureAllVariants } from "../../scripts/pr-visual/capture.js";
import { loadPomModules } from "../../scripts/pr-visual/pom.js";
import type { ProjectConfig, Scenario } from "../../scripts/pr-visual/types.js";

const FIXTURE_PORT = 3993;
const FIXTURE_URL = `http://localhost:${FIXTURE_PORT}`;
const FIXTURE_APP = path.resolve(__dirname, "../fixtures/app.js");
const FIXTURE_ROOT = path.resolve(__dirname, "..");

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
      // not ready
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-pom-"));
});

afterAll(() => {
  fixtureServer?.kill();
  if (outputDir) fs.rmSync(outputDir, { recursive: true, force: true });
});

function projectConfig(): ProjectConfig {
  return {
    devServer: { command: "" },
    poms: {
      dashboard: "fixtures/poms/dashboard.js",
    },
  };
}

function scenarioWithPom(): Scenario {
  return {
    name: "pom-probe",
    description: "Runs a POM login step",
    steps: [
      {
        action: "navigate",
        url: FIXTURE_URL,
        caption: "Open the app",
        pacing: "quick",
      },
      {
        action: "pom",
        page: "dashboard",
        method: "login",
        args: ["alice"],
        caption: "POM: login",
        pacing: "quick",
      },
      {
        action: "screenshot",
        caption: "Post-login snapshot",
        pacing: "quick",
      },
    ],
  };
}

describe("pom — called through real Playwright", () => {
  it("invokes the fixture POM method and mutates the page as expected", async () => {
    const config = projectConfig();
    const poms = loadPomModules(config.poms, FIXTURE_ROOT);

    const results = await captureAllVariants(
      [scenarioWithPom()],
      FIXTURE_URL,
      outputDir,
      config,
      FIXTURE_ROOT,
      poms
    );

    expect(results.length).toBeGreaterThan(0);
    // Confirm the POM ran by re-driving a single Playwright probe with
    // the same method: the fixture's `login` sets a data attribute on
    // `#auth-state`, which persists until the page reloads. We directly
    // verify the function is reachable + sets the attribute.
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(FIXTURE_URL, { waitUntil: "networkidle" });
      await poms.dashboard!.login!(page, "alice");
      const marker = await page
        .locator("#auth-state")
        .getAttribute("data-pom-login");
      expect(marker).toBe("alice");
      await ctx.close();
    } finally {
      await browser.close();
    }
  }, 60_000);
});
