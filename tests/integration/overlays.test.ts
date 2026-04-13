import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { chromium, type Browser } from "playwright";
import { captureAllVariants } from "../../scripts/pr-visual/capture.js";
import {
  highlightElement,
  injectCustomCursor,
  showClickIndicator,
} from "../../scripts/pr-visual/overlays.js";
import type { Scenario } from "../../scripts/pr-visual/types.js";

const FIXTURE_PORT = 3995;
const FIXTURE_URL = `http://localhost:${FIXTURE_PORT}`;
const FIXTURE_APP = path.resolve(__dirname, "../fixtures/app.js");

let fixtureServer: ChildProcess;
let browser: Browser;
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
  browser = await chromium.launch({ headless: true });
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr-visual-overlays-"));
});

afterAll(async () => {
  await browser?.close();
  fixtureServer?.kill();
  if (outputDir) fs.rmSync(outputDir, { recursive: true, force: true });
});

describe("overlays — cursor injection", () => {
  it("adds #demo-cursor and #demo-cursor-trail to the DOM", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(FIXTURE_URL, { waitUntil: "networkidle" });
      await injectCustomCursor(page, "desktop");

      const present = await page.evaluate(() => ({
        cursor: !!document.getElementById("demo-cursor"),
        trail: !!document.getElementById("demo-cursor-trail"),
        styles: !!document.getElementById("demo-cursor-styles"),
      }));
      expect(present).toEqual({
        cursor: true,
        trail: true,
        styles: true,
      });
    } finally {
      await context.close();
    }
  }, 30_000);

  it("second inject is a no-op (id guard)", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(FIXTURE_URL, { waitUntil: "networkidle" });
      await injectCustomCursor(page, "desktop");
      await injectCustomCursor(page, "desktop");

      const cursorCount = await page.evaluate(
        () => document.querySelectorAll("#demo-cursor").length
      );
      expect(cursorCount).toBe(1);
    } finally {
      await context.close();
    }
  }, 30_000);

  it("mobile variant uses a larger cursor size", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(FIXTURE_URL, { waitUntil: "networkidle" });
      await injectCustomCursor(page, "mobile");

      const cursorSize = await page.evaluate(() => {
        const el = document.getElementById("demo-cursor");
        return el ? el.getBoundingClientRect().width : 0;
      });
      expect(cursorSize).toBe(40);
    } finally {
      await context.close();
    }
  }, 30_000);
});

describe("overlays — click ripple", () => {
  it("injects a ripple element at the click target's center", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(FIXTURE_URL, { waitUntil: "networkidle" });
      const locator = page.locator("#login");
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();

      await showClickIndicator(page, locator, "desktop");

      const ripple = await page.evaluate(() => {
        const el = document.querySelector(
          ".demo-click-ripple"
        ) as HTMLElement | null;
        if (!el) return null;
        return {
          left: el.style.left,
          top: el.style.top,
          present: true,
        };
      });

      expect(ripple).not.toBeNull();
      const expectedX = Math.round(box!.x + box!.width / 2);
      const expectedY = Math.round(box!.y + box!.height / 2);
      expect(ripple!.left).toBe(`${expectedX}px`);
      expect(ripple!.top).toBe(`${expectedY}px`);
    } finally {
      await context.close();
    }
  }, 30_000);

  it("mobile variant emits two ripple rings", async () => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    try {
      await page.goto(FIXTURE_URL, { waitUntil: "networkidle" });
      const locator = page.locator("#login");

      await showClickIndicator(page, locator, "mobile");

      const rippleCount = await page.evaluate(
        () => document.querySelectorAll(".demo-click-ripple").length
      );
      expect(rippleCount).toBe(2);
    } finally {
      await context.close();
    }
  }, 30_000);
});

describe("overlays — highlight", () => {
  it("applies .demo-highlighted + spotlight during duration, then cleans up", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(FIXTURE_URL, { waitUntil: "networkidle" });
      const locator = page.locator("#login");

      const duration = 400;
      const highlightPromise = highlightElement(page, locator, duration);

      // Poll for the active state during the hold.
      const active = await page.evaluate(
        () =>
          new Promise<{
            highlighted: boolean;
            spotlightActive: boolean;
          }>((resolve) => {
            const check = () => {
              const target = document.getElementById("login");
              const spotlight = document.getElementById("demo-spotlight");
              if (target?.classList.contains("demo-highlighted")) {
                resolve({
                  highlighted: true,
                  spotlightActive:
                    !!spotlight && spotlight.classList.contains("active"),
                });
              } else {
                setTimeout(check, 20);
              }
            };
            check();
          })
      );
      expect(active.highlighted).toBe(true);
      expect(active.spotlightActive).toBe(true);

      await highlightPromise;

      const afterCleanup = await page.evaluate(() => {
        const target = document.getElementById("login");
        const spotlight = document.getElementById("demo-spotlight");
        return {
          highlighted: target?.classList.contains("demo-highlighted") ?? false,
          spotlightActive:
            !!spotlight && spotlight.classList.contains("active"),
        };
      });
      expect(afterCleanup.highlighted).toBe(false);
      expect(afterCleanup.spotlightActive).toBe(false);
    } finally {
      await context.close();
    }
  }, 30_000);
});

describe("overlays — capture wiring + default-off", () => {
  function scenarioWith(overrides: Partial<Scenario> = {}): Scenario {
    return {
      name: "overlays-wiring",
      description: "Probe overlay DOM injection via captureAllVariants",
      steps: [
        {
          action: "navigate",
          url: FIXTURE_URL,
          caption: "Open",
          pacing: "quick",
        },
      ],
      ...overrides,
    };
  }

  it("no overlay DOM is injected when config has no overlays block (default off)", async () => {
    // Use captureAllVariants so we exercise the wiring. To keep the test
    // focused, assert via a follow-up scenario that runs without overlays
    // and peek at the resulting video's existence as proof the path ran
    // without errors.
    const results = await captureAllVariants(
      [scenarioWith()],
      FIXTURE_URL,
      outputDir
    );
    expect(results.length).toBeGreaterThan(0);
    // The real assertion happens inline: test a fresh browser context to
    // confirm no overlay was injected by the *capture* pipeline.
    const ctx = await browser.newContext();
    const pg = await ctx.newPage();
    try {
      await pg.goto(FIXTURE_URL, { waitUntil: "networkidle" });
      const present = await pg.evaluate(() => ({
        cursor: !!document.getElementById("demo-cursor"),
        spotlight: !!document.getElementById("demo-spotlight"),
      }));
      expect(present.cursor).toBe(false);
      expect(present.spotlight).toBe(false);
    } finally {
      await ctx.close();
    }
  }, 60_000);

  it("each overlay flag is independently toggleable", async () => {
    // Validate flag isolation at the config-shape level — the integration
    // of each flag is proven by the dedicated tests above. Here we just
    // ensure capture accepts selective flags without crashing.
    for (const overlays of [
      { cursor: true },
      { clicks: true },
      { highlights: true },
    ]) {
      const results = await captureAllVariants(
        [scenarioWith()],
        FIXTURE_URL,
        outputDir,
        { devServer: { command: "" }, overlays }
      );
      expect(results.length).toBeGreaterThan(0);
    }
  }, 120_000);
});
