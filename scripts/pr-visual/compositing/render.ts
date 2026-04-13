import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { assertValidCompositionInput, type CompositionInput } from "./types.js";

const nodeRequire = createRequire(__filename);

/** Absolute path to the Remotion entry file (`register.tsx`) — passed to the
 *  Remotion bundler so it knows what to webpack. */
export function resolveRegisterEntry(): string {
  // tsx runs pr-visual under CommonJS (no "type": "module" in package.json),
  // so __dirname is available at runtime.
  return path.join(__dirname, "register.tsx");
}

export interface RenderArgs {
  /** Path to the recorded source video (e.g. the captioned MP4). */
  sourceVideoPath: string;
  /** Optional mobile companion video path. Staged into the bundle's public/
   *  dir under the filename in `inputProps.mobileVideoSrc`. */
  mobileVideoPath?: string;
  /** Output directory where the composited MP4 is written. */
  outputDir: string;
  /** Composition props, must be valid per `assertValidCompositionInput`. */
  inputProps: CompositionInput;
}

export interface RenderResult {
  /** Absolute path to the composited MP4. */
  outputPath: string;
}

/** Run Remotion: bundle the entry, select the composition, render H.264 CRF 16.
 *  Stages the source video into the bundle's `public/` so `staticFile()` in
 *  the composition resolves it. */
export async function renderComposition(
  args: RenderArgs
): Promise<RenderResult> {
  assertValidCompositionInput(args.inputProps);

  // Lazy peer-dep imports via Node's CommonJS resolver — the lazy loader
  // (./index.ts) has already verified these are installed. Using
  // `nodeRequire` keeps the import opaque to bundler static analysis.
  const { bundle } = nodeRequire("@remotion/bundler") as {
    bundle: (opts: { entryPoint: string }) => Promise<string>;
  };
  const { renderMedia, selectComposition } = nodeRequire(
    "@remotion/renderer"
  ) as {
    renderMedia: (opts: Record<string, unknown>) => Promise<unknown>;
    selectComposition: (opts: Record<string, unknown>) => Promise<unknown>;
  };

  const entryPoint = resolveRegisterEntry();
  console.log("[compositing] bundling Remotion project...");
  const bundleLocation: string = await bundle({ entryPoint });

  // Stage the source video into the bundle's public dir so staticFile()
  // resolves to it inside the composition.
  const publicDir = path.join(bundleLocation, "public");
  fs.mkdirSync(publicDir, { recursive: true });
  const stagedVideoName = path.basename(args.inputProps.videoSrc);
  const stagedVideoPath = path.join(publicDir, stagedVideoName);
  fs.copyFileSync(args.sourceVideoPath, stagedVideoPath);

  // Stage the mobile companion when present.
  if (args.mobileVideoPath && args.inputProps.mobileVideoSrc) {
    const stagedMobilePath = path.join(
      publicDir,
      path.basename(args.inputProps.mobileVideoSrc)
    );
    fs.copyFileSync(args.mobileVideoPath, stagedMobilePath);
  }

  console.log("[compositing] selecting composition...");
  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: "demo-video",
    inputProps: args.inputProps,
  });

  const baseName = path.basename(
    args.sourceVideoPath,
    path.extname(args.sourceVideoPath)
  );
  // Drop a "-captioned" suffix if present — keeps the final filename tidy.
  const rootName = baseName.replace(/-captioned$/, "");
  const outputPath = path.join(args.outputDir, `${rootName}-composited.mp4`);

  console.log(`[compositing] rendering ${path.basename(outputPath)}...`);
  await renderMedia({
    composition,
    serveUrl: bundleLocation,
    codec: "h264",
    crf: 16,
    pixelFormat: "yuv420p",
    outputLocation: outputPath,
    inputProps: args.inputProps,
  });

  return { outputPath };
}
