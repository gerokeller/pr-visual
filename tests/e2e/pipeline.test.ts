import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { generateScenarios } from "../../scripts/pr-visual/scenario-generator.js";
import { captureAllVariants } from "../../scripts/pr-visual/capture.js";
import { annotateScreenshots } from "../../scripts/pr-visual/annotate/screenshots.js";

const FIXTURE_PORT = 3999;
const FIXTURE_URL = `http://localhost:${FIXTURE_PORT}`;
const FIXTURE_APP = path.resolve(__dirname, "../fixtures/app.js");

let fixtureServer: ChildProcess;
let outputDir: string;

beforeAll(async () => {
  // Start the fixture app
  fixtureServer = spawn("node", [FIXTURE_APP], {
    env: { ...process.env, PORT: String(FIXTURE_PORT) },
    stdio: "pipe",
  });

  // Wait for it to be ready
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

  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-e2e-"));
});

afterAll(() => {
  fixtureServer?.kill();
  if (outputDir) fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("e2e pipeline", () => {
  it("generates static fallback scenarios when no API key is set", async () => {
    // Ensure no API key so we hit the static fallback
    delete process.env.ANTHROPIC_API_KEY;

    const scenarios = await generateScenarios(FIXTURE_URL);
    expect(scenarios.length).toBeGreaterThanOrEqual(1);
    expect(scenarios[0]!.name).toBe("Homepage");
    expect(scenarios[0]!.steps.length).toBeGreaterThan(0);
  });

  it("captures screenshots across all viewport/colorScheme variants", async () => {
    const scenarios = await generateScenarios(FIXTURE_URL);
    const results = await captureAllVariants(scenarios, FIXTURE_URL, outputDir);

    // 1 scenario × 2 viewports × 2 color schemes = 4 variants
    expect(results).toHaveLength(4);

    for (const result of results) {
      // Each variant should have screenshots
      expect(result.screenshots.length).toBeGreaterThan(0);

      // Raw screenshot files should exist
      for (const ss of result.screenshots) {
        expect(fs.existsSync(ss.rawPath)).toBe(true);
        // File should be a valid PNG (check magic bytes)
        const header = Buffer.alloc(4);
        const fd = fs.openSync(ss.rawPath, "r");
        fs.readSync(fd, header, 0, 4, 0);
        fs.closeSync(fd);
        // PNG magic: 137 80 78 71
        expect(header[0]).toBe(137);
        expect(header[1]).toBe(80);
      }

      // Video should exist (Playwright records by default)
      expect(result.videoPath).toBeTruthy();

      // Captions should be tracked
      expect(result.captions.length).toBeGreaterThan(0);
      for (const cap of result.captions) {
        expect(cap.text).toBeTruthy();
        expect(cap.endMs).toBeGreaterThanOrEqual(cap.startMs);
      }
    }
  });

  it("annotates screenshots with sidebar producing valid WebP files", async () => {
    const scenarios = await generateScenarios(FIXTURE_URL);
    const results = await captureAllVariants(scenarios, FIXTURE_URL, outputDir);
    const annotated = await annotateScreenshots(results);

    expect(annotated.length).toBeGreaterThan(0);

    for (const a of annotated) {
      expect(fs.existsSync(a.path)).toBe(true);
      expect(a.path).toMatch(/\.webp$/);

      // WebP magic: "RIFF" at offset 0, "WEBP" at offset 8
      const header = Buffer.alloc(12);
      const fd = fs.openSync(a.path, "r");
      fs.readSync(fd, header, 0, 12, 0);
      fs.closeSync(fd);
      expect(header.toString("ascii", 0, 4)).toBe("RIFF");
      expect(header.toString("ascii", 8, 12)).toBe("WEBP");

      // Caption and viewport metadata should be populated
      expect(a.caption).toBeTruthy();
      expect(["desktop", "mobile"]).toContain(a.viewport);
      expect(["light", "dark"]).toContain(a.colorScheme);
    }
  });
});
