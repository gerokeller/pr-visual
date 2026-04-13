import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRAND_COLOR,
  SIDE_BY_SIDE_CANVAS_SCALE,
  buildCompositionInput,
} from "../../scripts/pr-visual/compositing/build-props.js";
import type {
  CaptureResult,
  Scenario,
  ScenarioStep,
} from "../../scripts/pr-visual/types.js";

function makeResult(
  steps: ScenarioStep[],
  captionsOverride?: CaptureResult["captions"]
): CaptureResult {
  const captions =
    captionsOverride ??
    steps.map((step, i) => ({
      text: step.caption,
      route: "/",
      startMs: i * 1000,
      endMs: (i + 1) * 1000,
      ...(step.beat !== undefined ? { beat: step.beat } : {}),
      ...(step.emphasis !== undefined ? { emphasis: step.emphasis } : {}),
    }));
  return {
    viewport: {
      name: "desktop",
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
    },
    colorScheme: "light",
    screenshots: [],
    videoPath: "/tmp/x.webm",
    captions,
  };
}

const scenario: Scenario = {
  name: "Checkout flow",
  description: "Buyer completes a purchase",
  steps: [
    { action: "navigate", url: "/", caption: "Land on the page" },
    { action: "click", selector: "#cta", caption: "Press the call to action" },
    { action: "screenshot", caption: "Confirmation" },
  ],
};

describe("buildCompositionInput", () => {
  it("uses scenario name + description as title/description", () => {
    const props = buildCompositionInput({
      result: makeResult(scenario.steps),
      scenario,
      video: undefined,
      videoSrc: "x.mp4",
    });
    expect(props.title).toBe(scenario.name);
    expect(props.description).toBe(scenario.description);
    expect(props.videoSrc).toBe("x.mp4");
  });

  it("computes width = viewport*dsf, height = viewport*dsf + caption bar", () => {
    const props = buildCompositionInput({
      result: makeResult(scenario.steps),
      scenario,
      video: undefined,
      videoSrc: "x.mp4",
    });
    // 1440*2 = 2880; 900*2 = 1800; bar = 240 → height 2040.
    expect(props.width).toBe(2880);
    expect(props.desktopVideoWidth).toBe(2880);
    expect(props.desktopVideoHeight).toBe(1800);
    expect(props.height).toBeGreaterThan(props.desktopVideoHeight!);
    expect(props.height - props.desktopVideoHeight!).toBe(240);
  });

  it("emits one StepSummary per captioned step (ignores empty captions)", () => {
    const stepsWithBlank: ScenarioStep[] = [
      ...scenario.steps,
      { action: "wait", caption: "" },
    ];
    const props = buildCompositionInput({
      result: makeResult(stepsWithBlank),
      scenario: { ...scenario, steps: stepsWithBlank },
      video: undefined,
      videoSrc: "x.mp4",
    });
    expect(props.steps).toHaveLength(3);
    expect(props.steps[0]!.index).toBe(1);
    expect(props.steps[2]!.action).toBe("screenshot");
  });

  it("forwards optional video config fields (brand color, category, etc.)", () => {
    const props = buildCompositionInput({
      result: makeResult(scenario.steps),
      scenario,
      video: {
        compositing: "remotion",
        brandColor: "#ff0000",
        category: "Checkout",
        sprintLabel: "Sprint 12",
        orgName: "Acme",
        highlights: ["Faster", "Cleaner"],
      },
      videoSrc: "x.mp4",
    });
    expect(props.brandColor).toBe("#ff0000");
    expect(props.category).toBe("Checkout");
    expect(props.sprintLabel).toBe("Sprint 12");
    expect(props.orgName).toBe("Acme");
    expect(props.highlights).toEqual(["Faster", "Cleaner"]);
  });

  it("falls back to the documented default brand color", () => {
    const props = buildCompositionInput({
      result: makeResult(scenario.steps),
      scenario,
      video: { compositing: "remotion" },
      videoSrc: "x.mp4",
    });
    expect(props.brandColor).toBe(DEFAULT_BRAND_COLOR);
    expect(DEFAULT_BRAND_COLOR).toBe("#3b82f6");
  });

  it("derives video duration from the last caption endMs (+ tail) and clamps to >= 1s", () => {
    const props = buildCompositionInput({
      result: makeResult(scenario.steps),
      scenario,
      video: undefined,
      videoSrc: "x.mp4",
    });
    // 3 captions ending at 3000ms + 250ms tail = 3250ms -> 98 frames at 30fps.
    expect(props.videoDurationFrames).toBe(98);
    expect(props.fps).toBe(30);
  });

  describe("mobile companion", () => {
    it("does not set mobile* fields when no companion is supplied", () => {
      const props = buildCompositionInput({
        result: makeResult(scenario.steps),
        scenario,
        video: undefined,
        videoSrc: "x.mp4",
      });
      expect(props.mobileVideoSrc).toBeUndefined();
      expect(props.mobileLayout).toBeUndefined();
    });

    it("forwards mobile fields and layout when supplied", () => {
      const props = buildCompositionInput({
        result: makeResult(scenario.steps),
        scenario,
        video: undefined,
        videoSrc: "x.mp4",
        mobile: {
          videoSrc: "x-mobile.webm",
          width: 1170,
          height: 2532,
          layout: "pip",
        },
      });
      expect(props.mobileVideoSrc).toBe("x-mobile.webm");
      expect(props.mobileWidth).toBe(1170);
      expect(props.mobileHeight).toBe(2532);
      expect(props.mobileLayout).toBe("pip");
    });

    it("widens the canvas for side-by-side layout", () => {
      const props = buildCompositionInput({
        result: makeResult(scenario.steps),
        scenario,
        video: undefined,
        videoSrc: "x.mp4",
        mobile: {
          videoSrc: "x-mobile.webm",
          width: 1170,
          height: 2532,
          layout: "side-by-side",
        },
      });
      // desktop video width 2880; widened by SIDE_BY_SIDE_CANVAS_SCALE.
      expect(props.width).toBe(Math.round(2880 * SIDE_BY_SIDE_CANVAS_SCALE));
      // Desktop intrinsic dims unchanged so VideoWithFade can fit them.
      expect(props.desktopVideoWidth).toBe(2880);
      expect(props.desktopVideoHeight).toBe(1800);
    });

    it("does NOT widen the canvas for pip or sequential layouts", () => {
      for (const layout of ["pip", "sequential"] as const) {
        const props = buildCompositionInput({
          result: makeResult(scenario.steps),
          scenario,
          video: undefined,
          videoSrc: "x.mp4",
          mobile: {
            videoSrc: "x-mobile.webm",
            width: 1170,
            height: 2532,
            layout,
          },
        });
        expect(props.width).toBe(2880);
      }
    });

    it("SIDE_BY_SIDE_CANVAS_SCALE is 1.25 (documented)", () => {
      expect(SIDE_BY_SIDE_CANVAS_SCALE).toBe(1.25);
    });
  });

  it("populates step* arrays so the canvas caption bar renders", () => {
    const stepsWithBeat: ScenarioStep[] = [
      {
        action: "navigate",
        url: "/",
        caption: "Open",
        beat: "setup",
        emphasis: "normal",
      },
      {
        action: "click",
        selector: "#x",
        caption: "Tap",
        beat: "payoff",
        emphasis: "strong",
      },
    ];
    const props = buildCompositionInput({
      result: makeResult(stepsWithBeat),
      scenario: { ...scenario, steps: stepsWithBeat },
      video: undefined,
      videoSrc: "x.mp4",
    });
    expect(props.useCanvasCaptions).toBe(true);
    expect(props.captionBarHeight).toBe(240);
    expect(props.stepBeats).toEqual(["setup", "payoff"]);
    expect(props.stepEmphases).toEqual(["normal", "strong"]);
    expect(props.stepActions).toEqual(["navigate", "click"]);
    expect(props.stepAnnotations).toEqual(["Open", "Tap"]);
    expect(props.stepTimestamps).toEqual([1000, 2000]);
  });
});
