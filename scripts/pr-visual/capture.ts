import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
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

async function executeStep(
  page: Page,
  step: ScenarioStep,
  baseUrl: string
): Promise<void> {
  switch (step.action) {
    case "navigate": {
      const url = step.url?.startsWith("http")
        ? step.url
        : new URL(step.url ?? "/", baseUrl).toString();
      await page.goto(url, { waitUntil: "networkidle" });
      break;
    }
    case "click":
      if (step.selector) {
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
      await page.evaluate(
        (sel) => {
          const el = sel ? document.querySelector(sel) : window;
          if (el instanceof Window) {
            el.scrollBy(0, 400);
          } else if (el) {
            el.scrollBy(0, 400);
          }
        },
        step.selector ?? null
      );
      await page.waitForTimeout(300);
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
  outputDir: string
): Promise<CaptureResult> {
  const contextDir = path.join(
    outputDir,
    `${viewport.name}-${colorScheme}`
  );
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

  for (const step of scenario.steps) {
    const stepStartMs = Date.now() - startTime;

    await executeStep(page, step, baseUrl);

    const currentRoute = new URL(page.url()).pathname;
    const stepEndMs = Date.now() - startTime;

    captions.push({
      text: step.caption,
      route: currentRoute,
      startMs: stepStartMs,
      endMs: stepEndMs + 2000, // Caption lingers 2s after step completes
    });

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
      });
      screenshotIndex++;
    }
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
            outputDir
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
