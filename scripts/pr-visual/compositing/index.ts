import { createRequire } from "node:module";
import * as path from "node:path";
import type { CaptureResult, ProjectConfig, Scenario } from "../types.js";
import { buildCompositionInput } from "./build-props.js";

// Use Node's native CommonJS resolver to probe the optional peer deps. This
// bypasses bundler static analysis (vite/vitest) that would otherwise fail
// the test run before our try/catch can react.
const nodeRequire = createRequire(__filename);

export const REQUIRED_PEER_DEPS = [
  "remotion",
  "@remotion/bundler",
  "@remotion/renderer",
  "react",
  "react-dom",
] as const;

export const MISSING_DEPS_MESSAGE =
  `[compositing] Remotion peer dependencies not installed — ` +
  `falling back to the captioned MP4 path.\n` +
  `  Install with: npm i -D ${REQUIRED_PEER_DEPS.join(" ")}`;

export interface ComposeMobile {
  /** Path to the mobile pass `.webm`. */
  videoPath: string;
  /** Mobile recording dimensions in encoded pixels (viewport x DSF). */
  width: number;
  height: number;
  /** Composition layout. */
  layout: "side-by-side" | "pip" | "sequential";
}

export interface ComposeVoiceOverClip {
  /** Absolute path to the MP3 produced by `generateVoiceOver`. */
  path: string;
  /** Scenario step index this clip belongs to (0-based). */
  stepIndex: number;
  /** Duration of the clip in seconds. */
  durationSec: number;
}

export interface ComposeArgs {
  /** Project configuration. Compositing only runs when
   *  `project.video?.compositing === "remotion"` OR when a `mobile` companion
   *  is supplied (mobile.enabled implies compositing). */
  project: ProjectConfig;
  /** Source video path (the captioned MP4 from the existing pipeline). */
  sourceVideoPath: string;
  /** Output directory; the composited MP4 is written next to the source. */
  outputDir: string;
  /** Capture variant whose video we are compositing (typically desktop+light). */
  result: CaptureResult;
  /** Scenario the variant came from. */
  scenario: Scenario;
  /** Optional mobile companion produced by `runMobilePass`. When present,
   *  the composition includes mobile chrome per the configured layout. */
  mobile?: ComposeMobile;
  /** Optional voice-over clips produced by `generateVoiceOver`. Each is
   *  anchored to the start of its step on the canvas timeline. */
  voiceOverClips?: ComposeVoiceOverClip[];
}

export interface ComposeResult {
  /** Absolute path to the composited MP4 if rendering ran, else null. */
  outputPath: string | null;
  /** True when compositing was skipped because peer deps were missing. */
  fellBack: boolean;
}

function isModuleNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
    return true;
  }
  const message = (err as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /Cannot (?:find|resolve) (?:module|package)/i.test(message)
  );
}

/** Probe whether a peer dep is installed. Uses Node's CommonJS resolver
 *  (via `createRequire`) so bundler static analysis cannot hijack the
 *  lookup. Returns `null` on `MODULE_NOT_FOUND`, rethrows anything else. */
function probePeerDep(name: string): boolean {
  try {
    nodeRequire.resolve(name);
    return true;
  } catch (err) {
    if (isModuleNotFound(err)) return false;
    throw err;
  }
}

/** Public entrypoint. Lazy-loads the Remotion peer dependencies, then
 *  delegates to `render.ts`. On `MODULE_NOT_FOUND` it warns and returns
 *  `{ outputPath: null, fellBack: true }` so the caller can keep the
 *  captioned MP4 as the final artifact. */
export async function composeVideo(args: ComposeArgs): Promise<ComposeResult> {
  // mobile.enabled and voiceover.enabled both imply compositing — avoids
  // the "I enabled X but got no composite" gotcha.
  const mobileImpliesCompositing = args.project.video?.mobile?.enabled === true;
  const voiceOverImpliesCompositing = args.project.voiceover?.enabled === true;
  const compositingRequested =
    args.project.video?.compositing === "remotion" ||
    mobileImpliesCompositing ||
    voiceOverImpliesCompositing;
  if (!compositingRequested) {
    return { outputPath: null, fellBack: false };
  }

  // Probe the peer deps before doing real work. Synchronous Node resolution
  // sidesteps any bundler-injected import shim.
  for (const dep of REQUIRED_PEER_DEPS) {
    if (!probePeerDep(dep)) {
      console.warn(MISSING_DEPS_MESSAGE);
      return { outputPath: null, fellBack: true };
    }
  }

  const { renderComposition } = await import("./render.js");

  const voiceOverInputs = args.voiceOverClips?.length
    ? args.voiceOverClips.map((clip) => ({
        src: `vo-step-${String(clip.stepIndex).padStart(2, "0")}-${path.basename(clip.path)}`,
        stepIndex: clip.stepIndex,
        durationSec: clip.durationSec,
      }))
    : undefined;

  const inputProps = buildCompositionInput({
    result: args.result,
    scenario: args.scenario,
    video: args.project.video,
    videoSrc: path.basename(args.sourceVideoPath),
    ...(args.mobile
      ? {
          mobile: {
            videoSrc: path.basename(args.mobile.videoPath),
            width: args.mobile.width,
            height: args.mobile.height,
            layout: args.mobile.layout,
          },
        }
      : {}),
    ...(voiceOverInputs ? { voiceOverClips: voiceOverInputs } : {}),
  });

  const { outputPath } = await renderComposition({
    sourceVideoPath: args.sourceVideoPath,
    outputDir: args.outputDir,
    inputProps,
    ...(args.mobile ? { mobileVideoPath: args.mobile.videoPath } : {}),
    ...(args.voiceOverClips
      ? { voiceOverSourcePaths: args.voiceOverClips.map((c) => c.path) }
      : {}),
  });

  return { outputPath, fellBack: false };
}
