import type { CaptureResult, Scenario, VideoConfig } from "../types.js";
import { computeAdaptiveDurations } from "./duration.js";
import { FPS } from "./styles.js";
import type { CompositionInput, StepSummary } from "./types.js";

export const DEFAULT_BRAND_COLOR = "#3b82f6";
const CAPTION_BAR_HEIGHT = 240;
/** Side-by-side widens the canvas by 25% so the desktop column keeps near-
 *  native size and the phone column has room. PiP/sequential reuse the
 *  desktop canvas dimensions unchanged. */
export const SIDE_BY_SIDE_CANVAS_SCALE = 1.25;

export interface MobileCompositeInput {
  /** Filename of the staged mobile webm relative to the Remotion `public/`. */
  videoSrc: string;
  width: number;
  height: number;
  layout: "side-by-side" | "pip" | "sequential";
}

export interface VoiceOverInput {
  /** Filename of the staged MP3 relative to the Remotion `public/`. */
  src: string;
  stepIndex: number;
  durationSec: number;
}

export interface BuildPropsArgs {
  /** Captured variant whose video we are compositing (typically desktop+light). */
  result: CaptureResult;
  /** Scenario the variant came from. */
  scenario: Scenario;
  /** Project-level video configuration. */
  video: VideoConfig | undefined;
  /** Path the bundler will serve the recorded video from, relative to the
   *  Remotion `public/` dir (usually just the filename after staging). */
  videoSrc: string;
  /** Optional mobile companion. When present, the composition includes
   *  per-layout mobile chrome and may widen the canvas. */
  mobile?: MobileCompositeInput;
  /** Optional voice-over clips (already staged under the bundle's public/). */
  voiceOverClips?: VoiceOverInput[];
}

/** Convert pr-visual's CaptureResult + VideoConfig into the CompositionInput
 *  consumed by the Remotion composition. */
export function buildCompositionInput(args: BuildPropsArgs): CompositionInput {
  const { result, scenario, video, videoSrc, mobile, voiceOverClips } = args;

  const fps = FPS;

  // Recorded video duration: last caption endMs (already includes the
  // adaptive pacing hold from #4) + a small tail so the fade-out finishes.
  const lastCaption = result.captions[result.captions.length - 1];
  const recordingDurationMs = (lastCaption?.endMs ?? 0) + 250;
  const videoDurationFrames = Math.max(
    fps,
    Math.round((recordingDurationMs / 1000) * fps)
  );

  const annotatedSteps: StepSummary[] = scenario.steps
    .filter((step) => Boolean(step.caption))
    .map((step, i) => ({
      index: i + 1,
      action: step.action,
      annotation: step.caption,
    }));

  const { introFrames, outroFrames } = computeAdaptiveDurations(
    scenario.name,
    scenario.description,
    annotatedSteps.length,
    fps
  );

  const stepTimestamps = result.captions.map((c) => c.endMs);
  const stepAnnotations = result.captions.map((c) => c.text || null);
  const stepBeats = result.captions.map((c) => c.beat ?? null);
  const stepEmphases = result.captions.map((c) => c.emphasis ?? null);
  const stepActions = scenario.steps.map((s) => s.action);

  const desktopVideoWidth =
    result.viewport.width * result.viewport.deviceScaleFactor;
  const desktopVideoHeight =
    result.viewport.height * result.viewport.deviceScaleFactor;

  // Side-by-side widens the canvas to fit a phone column without shrinking
  // the desktop. PiP/sequential keep the desktop canvas unchanged because
  // the phone is overlaid or swapped in instead.
  const widenForMobile =
    mobile !== undefined && mobile.layout === "side-by-side";
  const canvasWidth = widenForMobile
    ? Math.round(desktopVideoWidth * SIDE_BY_SIDE_CANVAS_SCALE)
    : desktopVideoWidth;
  const canvasHeight = desktopVideoHeight + CAPTION_BAR_HEIGHT;

  return {
    title: scenario.name,
    description: scenario.description,
    videoSrc,
    videoDurationFrames,
    fps,
    width: canvasWidth,
    height: canvasHeight,
    introDurationFrames: introFrames,
    outroDurationFrames: outroFrames,
    brandColor: video?.brandColor ?? DEFAULT_BRAND_COLOR,
    steps: annotatedSteps,
    ...(video?.category !== undefined ? { category: video.category } : {}),
    ...(video?.sprintLabel !== undefined
      ? { sprintLabel: video.sprintLabel }
      : {}),
    ...(video?.orgName !== undefined ? { orgName: video.orgName } : {}),
    ...(video?.highlights !== undefined
      ? { highlights: video.highlights }
      : {}),
    recordingDurationSec: recordingDurationMs / 1000,
    desktopVideoWidth,
    desktopVideoHeight,
    useCanvasCaptions: true,
    captionBarHeight: CAPTION_BAR_HEIGHT,
    stepTimestamps,
    stepAnnotations,
    stepBeats,
    stepEmphases,
    stepActions,
    ...(mobile !== undefined
      ? {
          mobileVideoSrc: mobile.videoSrc,
          mobileWidth: mobile.width,
          mobileHeight: mobile.height,
          mobileLayout: mobile.layout,
        }
      : {}),
    ...(voiceOverClips && voiceOverClips.length > 0 ? { voiceOverClips } : {}),
  };
}
