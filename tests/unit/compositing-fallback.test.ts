import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MISSING_DEPS_MESSAGE,
  REQUIRED_PEER_DEPS,
  composeVideo,
} from "../../scripts/pr-visual/compositing/index.js";
import type {
  CaptureResult,
  ProjectConfig,
  Scenario,
} from "../../scripts/pr-visual/types.js";
import { assertValidCompositionInput } from "../../scripts/pr-visual/compositing/types.js";

const baseProject: ProjectConfig = {
  devServer: { command: "" },
};

const scenario: Scenario = {
  name: "Test scenario",
  description: "test",
  steps: [{ action: "navigate", url: "/", caption: "Open the page" }],
};

const result: CaptureResult = {
  viewport: {
    name: "desktop",
    width: 1440,
    height: 900,
    deviceScaleFactor: 2,
  },
  colorScheme: "light",
  screenshots: [],
  videoPath: "/tmp/x.webm",
  captions: [{ text: "Open the page", route: "/", startMs: 0, endMs: 1000 }],
};

describe("composeVideo", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a no-op when video.compositing is not 'remotion'", async () => {
    const out = await composeVideo({
      project: baseProject,
      sourceVideoPath: "/tmp/x.mp4",
      outputDir: "/tmp",
      result,
      scenario,
    });
    expect(out).toEqual({ outputPath: null, fellBack: false });
  });

  it("mobile.enabled triggers the compositing path even without compositing: 'remotion'", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Peer deps are not installed in CI/local — we expect the fallback
    // warning to fire, proving the code path was entered.
    const out = await composeVideo({
      project: {
        ...baseProject,
        video: { mobile: { enabled: true } },
      },
      sourceVideoPath: "/tmp/x.mp4",
      outputDir: "/tmp",
      result,
      scenario,
    });
    expect(out).toEqual({ outputPath: null, fellBack: true });
    expect(warn).toHaveBeenCalled();
  });

  it("warns and falls back when remotion peer deps are missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await composeVideo({
      project: {
        ...baseProject,
        video: { compositing: "remotion" },
      },
      sourceVideoPath: "/tmp/x.mp4",
      outputDir: "/tmp",
      result,
      scenario,
    });
    expect(out).toEqual({ outputPath: null, fellBack: true });
    expect(warn).toHaveBeenCalled();
    const message = warn.mock.calls[0]![0] as string;
    expect(message).toContain("Remotion peer dependencies not installed");
    for (const dep of REQUIRED_PEER_DEPS) {
      expect(message).toContain(dep);
    }
  });

  it("missing-deps message lists every required peer dep", () => {
    for (const dep of REQUIRED_PEER_DEPS) {
      expect(MISSING_DEPS_MESSAGE).toContain(dep);
    }
  });
});

describe("assertValidCompositionInput", () => {
  const valid = {
    title: "t",
    description: "d",
    videoSrc: "v.mp4",
    videoDurationFrames: 100,
    fps: 30,
    width: 1920,
    height: 1080,
    introDurationFrames: 60,
    outroDurationFrames: 90,
    brandColor: "#3b82f6",
    steps: [],
  };

  it("accepts a fully populated input", () => {
    expect(() => assertValidCompositionInput(valid)).not.toThrow();
  });

  it.each([
    "title",
    "videoSrc",
    "videoDurationFrames",
    "fps",
    "width",
    "height",
    "brandColor",
    "steps",
  ])("rejects missing %s", (key) => {
    const broken = { ...valid } as Record<string, unknown>;
    delete broken[key];
    expect(() => assertValidCompositionInput(broken)).toThrow(
      new RegExp(`CompositionInput\\.${key} is required`)
    );
  });

  it("rejects non-array steps", () => {
    expect(() =>
      assertValidCompositionInput({ ...valid, steps: "nope" })
    ).toThrow(/steps must be an array/);
  });

  it("rejects negative numeric fields", () => {
    expect(() => assertValidCompositionInput({ ...valid, fps: -1 })).toThrow(
      /fps must be a non-negative finite number/
    );
  });

  it("rejects non-object input", () => {
    expect(() => assertValidCompositionInput(null)).toThrow(
      /must be an object/
    );
  });
});
