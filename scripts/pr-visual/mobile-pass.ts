import * as fs from "node:fs";
import * as path from "node:path";
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "playwright";
import {
  advancePacingContext,
  computeAdaptiveHoldMs,
  createPacingContext,
  dramaticPreSettleMs,
} from "./pacing.js";
import {
  DEFAULT_HIGHLIGHT_DURATION_MS,
  highlightElement,
  injectCustomCursor,
  showClickIndicator,
} from "./overlays.js";
import { invokePom, type LoadedPoms } from "./pom.js";
import type {
  MobileVideoConfig,
  ProjectConfig,
  Scenario,
  ScenarioStep,
} from "./types.js";

export const DEFAULT_MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
export const DEFAULT_MOBILE_DSF = 3;
export const DEFAULT_MOBILE_LAYOUT = "side-by-side" as const;

export interface ResolvedMobileConfig {
  width: number;
  height: number;
  deviceScaleFactor: number;
  layout: "side-by-side" | "pip" | "sequential";
}

export function resolveMobileConfig(
  config: MobileVideoConfig | undefined
): ResolvedMobileConfig {
  return {
    width: config?.viewport?.width ?? DEFAULT_MOBILE_VIEWPORT.width,
    height: config?.viewport?.height ?? DEFAULT_MOBILE_VIEWPORT.height,
    deviceScaleFactor: config?.deviceScaleFactor ?? DEFAULT_MOBILE_DSF,
    layout: config?.layout ?? DEFAULT_MOBILE_LAYOUT,
  };
}

/** Apply per-step mobile overrides. Returns null when the step is skipped
 *  on mobile, otherwise returns a (possibly identical) clone with overrides
 *  applied. */
export function applyMobileOverrides(step: ScenarioStep): ScenarioStep | null {
  if (step.mobileSkip) return null;

  const hasOverride =
    step.mobileSelector !== undefined || step.mobilePath !== undefined;
  if (!hasOverride) return step;

  const next: ScenarioStep = { ...step };
  if (step.mobileSelector !== undefined) {
    next.selector = step.mobileSelector;
  }
  if (step.mobilePath !== undefined) {
    next.url = step.mobilePath;
  }
  return next;
}

/** Record a single mobile pass for the given scenario. Returns the absolute
 *  path of the resulting `.webm`. The webm is destined for the Remotion
 *  compositor and is NOT part of the standard variant matrix. */
export interface MobilePassResult {
  videoPath: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  layout: ResolvedMobileConfig["layout"];
}

export async function runMobilePass(
  scenario: Scenario,
  baseUrl: string,
  outputDir: string,
  projectConfig: ProjectConfig,
  storageStatePath?: string,
  loadedPoms?: LoadedPoms
): Promise<MobilePassResult | null> {
  const mobile = resolveMobileConfig(projectConfig.video?.mobile);

  const adjustedSteps = scenario.steps
    .map((s) => applyMobileOverrides(s))
    .filter((s): s is ScenarioStep => s !== null);

  if (adjustedSteps.length === 0) {
    console.warn(
      "  [mobile] All scenario steps were filtered out by mobileSkip — skipping mobile pass."
    );
    return null;
  }

  const passDir = path.join(outputDir, "mobile-composite-pass");
  fs.mkdirSync(passDir, { recursive: true });

  const browser: Browser = await chromium.launch({ headless: true });
  try {
    const videoWidth = mobile.width * mobile.deviceScaleFactor;
    const videoHeight = mobile.height * mobile.deviceScaleFactor;

    const context: BrowserContext = await browser.newContext({
      viewport: { width: mobile.width, height: mobile.height },
      deviceScaleFactor: mobile.deviceScaleFactor,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      recordVideo: {
        dir: passDir,
        size: { width: videoWidth, height: videoHeight },
      },
      ...(storageStatePath ? { storageState: storageStatePath } : {}),
    });
    const page: Page = await context.newPage();

    const overlays = projectConfig.overlays;
    const variant = "mobile" as const;
    const wordsPerSecond = projectConfig.pacing?.wordsPerSecond;
    let pacingContext = createPacingContext();

    for (const step of adjustedSteps) {
      const preSettleMs = dramaticPreSettleMs(step);
      if (preSettleMs > 0) {
        await page.waitForTimeout(preSettleMs);
      }

      switch (step.action) {
        case "navigate": {
          const url = step.url?.startsWith("http")
            ? step.url
            : new URL(step.url ?? "/", baseUrl).toString();
          await page.goto(url, { waitUntil: "networkidle" });
          if (overlays?.cursor) {
            await injectCustomCursor(page, variant);
          }
          break;
        }
        case "click":
          if (step.selector) {
            if (overlays?.clicks) {
              const locator = page.locator(step.selector);
              await showClickIndicator(page, locator, variant);
            }
            await page.click(step.selector, { timeout: 5000 });
          }
          break;
        case "type":
          if (step.selector && step.value) {
            await page.fill(step.selector, step.value);
          }
          break;
        case "wait":
          await page.waitForTimeout(step.duration ?? 1000);
          break;
        case "scroll":
          await page.evaluate((sel) => {
            const el = sel ? document.querySelector(sel) : window;
            if (el instanceof Window) {
              el.scrollBy(0, 400);
            } else if (el) {
              el.scrollBy(0, 400);
            }
          }, step.selector ?? null);
          await page.waitForTimeout(300);
          break;
        case "highlight":
          if (step.selector && overlays?.highlights) {
            const locator = page.locator(step.selector);
            await highlightElement(
              page,
              locator,
              step.duration ?? DEFAULT_HIGHLIGHT_DURATION_MS
            );
          } else if (step.duration) {
            await page.waitForTimeout(step.duration);
          }
          break;
        case "pom":
          if (loadedPoms) {
            await invokePom(loadedPoms, page, step);
          }
          break;
        case "screenshot":
          // No-op on the mobile composite pass — screenshots come from the
          // matrix mobile variant.
          break;
      }

      const holdMs = computeAdaptiveHoldMs(step.caption, step, pacingContext, {
        ...(wordsPerSecond !== undefined ? { wordsPerSecond } : {}),
        ...(step.beat !== undefined ? { beat: step.beat } : {}),
      });
      await page.waitForTimeout(holdMs);

      pacingContext = advancePacingContext(pacingContext, step);
    }

    const videoObj = page.video();
    await context.close();

    if (!videoObj) return null;
    const savedVideoPath = await videoObj.path();
    const finalVideoPath = path.join(
      passDir,
      `${scenario.name.replace(/\s+/g, "-").toLowerCase()}-mobile.webm`
    );
    if (!fs.existsSync(savedVideoPath)) return null;
    fs.renameSync(savedVideoPath, finalVideoPath);

    return {
      videoPath: finalVideoPath,
      width: videoWidth,
      height: videoHeight,
      deviceScaleFactor: mobile.deviceScaleFactor,
      layout: mobile.layout,
    };
  } finally {
    await browser.close();
  }
}
