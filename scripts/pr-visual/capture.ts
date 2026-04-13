import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import * as path from "node:path";
import * as fs from "node:fs";
import type {
  ViewportConfig,
  ColorScheme,
  ProjectConfig,
  Scenario,
  ScenarioStep,
  CaptionTiming,
  CaptureResult,
  ScreenshotResult,
} from "./types.js";
import { VIEWPORTS, COLOR_SCHEMES } from "./types.js";
import { resolveDesktopViewport } from "./quality.js";
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
  type InputVariant,
  resolveInputVariant,
  showClickIndicator,
} from "./overlays.js";

interface ExecuteStepOptions {
  overlays?: ProjectConfig["overlays"];
  variant: InputVariant;
}

async function executeStep(
  page: Page,
  step: ScenarioStep,
  baseUrl: string,
  options: ExecuteStepOptions
): Promise<void> {
  const { overlays, variant } = options;

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
        // Highlight disabled but still honor the intended hold so the
        // scenario timing stays stable across config toggles.
        await page.waitForTimeout(step.duration);
      }
      break;
    case "screenshot":
      // Handled by the caller
      break;
  }
}

async function captureScenario(
  browser: Browser,
  scenario: Scenario,
  viewport: ViewportConfig,
  colorScheme: ColorScheme,
  baseUrl: string,
  outputDir: string,
  projectConfig?: ProjectConfig
): Promise<CaptureResult> {
  const contextDir = path.join(outputDir, `${viewport.name}-${colorScheme}`);
  fs.mkdirSync(contextDir, { recursive: true });

  const videoWidth = viewport.width * viewport.deviceScaleFactor;
  const videoHeight = viewport.height * viewport.deviceScaleFactor;

  const contextOptions: Parameters<Browser["newContext"]>[0] = {
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    colorScheme,
    isMobile: viewport.isMobile ?? false,
    ...(viewport.userAgent ? { userAgent: viewport.userAgent } : {}),
    recordVideo: {
      dir: contextDir,
      size: { width: videoWidth, height: videoHeight },
    },
  };

  const context: BrowserContext = await browser.newContext(contextOptions);
  const page: Page = await context.newPage();

  const screenshots: ScreenshotResult[] = [];
  const captions: CaptionTiming[] = [];
  const startTime = Date.now();
  let screenshotIndex = 0;
  let pacingContext = createPacingContext();
  const wordsPerSecond = projectConfig?.pacing?.wordsPerSecond;
  const variant = resolveInputVariant(viewport);
  const overlays = projectConfig?.overlays;

  for (const step of scenario.steps) {
    const preSettleMs = dramaticPreSettleMs(step);
    if (preSettleMs > 0) {
      await page.waitForTimeout(preSettleMs);
    }

    const stepStartMs = Date.now() - startTime;

    await executeStep(page, step, baseUrl, { overlays, variant });

    const currentRoute = new URL(page.url()).pathname;
    const stepEndMs = Date.now() - startTime;

    if (step.action === "screenshot" || step.action === "navigate") {
      await page.waitForTimeout(500); // Brief settle time
      const rawPath = path.join(
        contextDir,
        `step-${screenshotIndex.toString().padStart(3, "0")}.png`
      );
      await page.screenshot({ path: rawPath, fullPage: false });
      screenshots.push({
        stepIndex: screenshotIndex,
        caption: step.caption,
        rawPath,
        annotatedPath: "", // Filled in by annotate step
        ...(step.beat !== undefined ? { beat: step.beat } : {}),
        ...(step.emphasis !== undefined ? { emphasis: step.emphasis } : {}),
      });
      screenshotIndex++;
    }

    const holdMs = computeAdaptiveHoldMs(step.caption, step, pacingContext, {
      ...(wordsPerSecond !== undefined ? { wordsPerSecond } : {}),
      ...(step.beat !== undefined ? { beat: step.beat } : {}),
    });
    await page.waitForTimeout(holdMs);

    captions.push({
      text: step.caption,
      route: currentRoute,
      startMs: stepStartMs,
      endMs: stepEndMs + holdMs,
      ...(step.beat !== undefined ? { beat: step.beat } : {}),
      ...(step.emphasis !== undefined ? { emphasis: step.emphasis } : {}),
    });

    pacingContext = advancePacingContext(pacingContext, step);
  }

  // Close context to finalize video
  const videoObj = page.video();
  await context.close();

  let videoPath: string | null = null;
  if (videoObj) {
    const savedVideoPath = await videoObj.path();
    const finalVideoPath = path.join(
      contextDir,
      `${scenario.name.replace(/\s+/g, "-").toLowerCase()}.webm`
    );
    if (fs.existsSync(savedVideoPath)) {
      fs.renameSync(savedVideoPath, finalVideoPath);
      videoPath = finalVideoPath;
    }
  }

  return {
    viewport,
    colorScheme,
    screenshots,
    videoPath,
    captions,
  };
}

export async function captureAllVariants(
  scenarios: Scenario[],
  baseUrl: string,
  outputDir: string,
  projectConfig?: ProjectConfig
): Promise<CaptureResult[]> {
  const browser = await chromium.launch({ headless: true });
  const results: CaptureResult[] = [];

  try {
    for (const scenario of scenarios) {
      const desktopViewport = resolveDesktopViewport(scenario, projectConfig);
      const viewports: ViewportConfig[] = [desktopViewport, VIEWPORTS.mobile];
      for (const viewport of viewports) {
        for (const colorScheme of COLOR_SCHEMES) {
          console.log(
            `  Capturing: ${scenario.name} — ${viewport.name} ${viewport.width}x${viewport.height}@${viewport.deviceScaleFactor}x — ${colorScheme}`
          );
          const result = await captureScenario(
            browser,
            scenario,
            viewport,
            colorScheme,
            baseUrl,
            outputDir,
            projectConfig
          );
          results.push(result);
        }
      }
    }
  } finally {
    await browser.close();
  }

  return results;
}
