import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import sharp from "sharp";
import { captureAllVariants } from "../../scripts/pr-visual/capture.js";
import {
  QUALITY_PRESETS,
  type Scenario,
} from "../../scripts/pr-visual/types.js";

const FIXTURE_PORT = 3997;
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
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-quality-"));
});

afterAll(() => {
  fixtureServer?.kill();
  if (outputDir) fs.rmSync(outputDir, { recursive: true, force: true });
});

function staticScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: "quality-probe",
    description: "Probe desktop viewport dimensions for quality presets",
    steps: [
      {
        action: "navigate",
        url: FIXTURE_URL,
        caption: "Load the fixture",
      },
      {
        action: "wait",
        duration: 200,
        caption: "Settle",
      },
      {
        action: "screenshot",
        caption: "Desktop capture",
      },
    ],
    ...overrides,
  };
}

async function getPngDimensions(
  file: string
): Promise<{ width: number; height: number }> {
  const meta = await sharp(file).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Could not read dimensions from ${file}`);
  }
  return { width: meta.width, height: meta.height };
}

describe("quality presets — desktop screenshot dimensions", () => {
  it("720p preset produces desktop screenshots at viewport × DSF", async () => {
    const scenario = staticScenario({ quality: "720p" });
    const results = await captureAllVariants(
      [scenario],
      FIXTURE_URL,
      outputDir
    );

    const desktop = results.find((r) => r.viewport.name === "desktop");
    expect(desktop).toBeDefined();
    expect(desktop!.viewport.width).toBe(QUALITY_PRESETS["720p"].width);
    expect(desktop!.viewport.height).toBe(QUALITY_PRESETS["720p"].height);
    expect(desktop!.viewport.deviceScaleFactor).toBe(2);

    const ss = desktop!.screenshots[0];
    expect(ss).toBeDefined();
    const dims = await getPngDimensions(ss!.rawPath);
    expect(dims.width).toBe(QUALITY_PRESETS["720p"].width * 2);
    expect(dims.height).toBe(QUALITY_PRESETS["720p"].height * 2);
  }, 30_000);

  it("project-level quality applies when scenario omits quality", async () => {
    const results = await captureAllVariants(
      [staticScenario()],
      FIXTURE_URL,
      outputDir,
      {
        devServer: { command: "" },
        quality: "1080p",
      }
    );
    const desktop = results.find((r) => r.viewport.name === "desktop");
    expect(desktop!.viewport.width).toBe(QUALITY_PRESETS["1080p"].width);
    expect(desktop!.viewport.height).toBe(QUALITY_PRESETS["1080p"].height);
  }, 30_000);

  it("scenario-level viewport override applies", async () => {
    const scenario = staticScenario({
      viewport: { width: 1024, height: 768 },
    });
    const results = await captureAllVariants(
      [scenario],
      FIXTURE_URL,
      outputDir
    );
    const desktop = results.find((r) => r.viewport.name === "desktop");
    expect(desktop!.viewport.width).toBe(1024);
    expect(desktop!.viewport.height).toBe(768);
    expect(desktop!.viewport.deviceScaleFactor).toBe(2);
  }, 30_000);

  it("mobile viewport is unaffected by quality preset", async () => {
    const scenario = staticScenario({ quality: "4k" });
    const results = await captureAllVariants(
      [scenario],
      FIXTURE_URL,
      outputDir
    );
    const mobile = results.find((r) => r.viewport.name === "mobile");
    expect(mobile).toBeDefined();
    expect(mobile!.viewport.width).toBe(390);
    expect(mobile!.viewport.height).toBe(844);
    expect(mobile!.viewport.deviceScaleFactor).toBe(3);
  }, 60_000);

  it("PR_VISUAL_QUALITY env var overrides scenario quality", async () => {
    const prev = process.env.PR_VISUAL_QUALITY;
    process.env.PR_VISUAL_QUALITY = "720p";
    try {
      const scenario = staticScenario({ quality: "4k" });
      const results = await captureAllVariants(
        [scenario],
        FIXTURE_URL,
        outputDir
      );
      const desktop = results.find((r) => r.viewport.name === "desktop");
      expect(desktop!.viewport.width).toBe(QUALITY_PRESETS["720p"].width);
      expect(desktop!.viewport.height).toBe(QUALITY_PRESETS["720p"].height);
    } finally {
      if (prev === undefined) delete process.env.PR_VISUAL_QUALITY;
      else process.env.PR_VISUAL_QUALITY = prev;
    }
  }, 30_000);
});
