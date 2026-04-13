import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CaptionTiming } from "../types.js";

export const CAPTION_FONT_SIZE = 24;
export const ROUTE_FONT_SIZE = 18;
/** Font size for strong-emphasis captions (1.5x base). */
export const CAPTION_STRONG_FONT_SIZE = Math.round(CAPTION_FONT_SIZE * 1.5);
/** Font size for the beat-transition chip (title-card style). */
export const BEAT_CHIP_FONT_SIZE = 40;
/** Total duration a beat-transition chip is visible. */
export const BEAT_CHIP_DURATION_MS = 700;
const CAPTION_COLOR = "&HFFFFFF";
const ROUTE_COLOR = "&H9B59B6";
const BEAT_CHIP_COLOR = "&HE7C56C"; // soft amber, visible on dark video
const SHADOW_COLOR = "&H000000";

/** @internal exported for testing */
export function msToAssTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

/** @internal exported for testing */
export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}");
}

/** @internal exported for testing */
export function generateAssSubtitles(
  captions: CaptionTiming[],
  videoWidth: number,
  videoHeight: number
): string {
  const marginBottom = 40;
  const routeMarginBottom = marginBottom + CAPTION_FONT_SIZE + 16;

  let ass = `[Script Info]
Title: PR Visual Captions
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Arial,${CAPTION_FONT_SIZE},${CAPTION_COLOR},${CAPTION_COLOR},${SHADOW_COLOR},${SHADOW_COLOR},-1,0,0,0,100,100,0,0,1,2,1,2,20,20,${marginBottom},1
Style: CaptionStrong,Arial,${CAPTION_STRONG_FONT_SIZE},${CAPTION_COLOR},${CAPTION_COLOR},${SHADOW_COLOR},${SHADOW_COLOR},-1,0,0,0,100,100,0,0,1,3,2,2,20,20,${marginBottom},1
Style: Route,Courier New,${ROUTE_FONT_SIZE},${ROUTE_COLOR},${ROUTE_COLOR},${SHADOW_COLOR},${SHADOW_COLOR},0,0,0,0,100,100,0,0,1,2,0,2,20,20,${routeMarginBottom},1
Style: BeatChip,Arial,${BEAT_CHIP_FONT_SIZE},${BEAT_CHIP_COLOR},${BEAT_CHIP_COLOR},${SHADOW_COLOR},${SHADOW_COLOR},-1,0,0,0,100,100,4,0,1,3,2,5,20,20,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  let previousBeat: CaptionTiming["beat"] | undefined;

  for (const cap of captions) {
    const start = msToAssTime(cap.startMs);
    const end = msToAssTime(cap.endMs);

    // Beat-transition chip — emit only at an actual transition from one
    // beat to another, so N distinct beats produce N-1 chips.
    if (
      cap.beat !== undefined &&
      previousBeat !== undefined &&
      cap.beat !== previousBeat
    ) {
      const chipEnd = msToAssTime(
        Math.min(cap.endMs, cap.startMs + BEAT_CHIP_DURATION_MS)
      );
      const chipText = `{\\fad(150,150)}${escapeAssText(cap.beat.toUpperCase())}`;
      ass += `Dialogue: 2,${start},${chipEnd},BeatChip,,0,0,0,,${chipText}\n`;
    }
    previousBeat = cap.beat;

    const captionStyle =
      cap.emphasis === "strong" ? "CaptionStrong" : "Caption";
    ass += `Dialogue: 0,${start},${end},${captionStyle},,0,0,0,,${escapeAssText(cap.text)}\n`;
    ass += `Dialogue: 1,${start},${end},Route,,0,0,0,,${escapeAssText(cap.route)}\n`;
  }

  return ass;
}

export async function burnCaptions(
  videoPath: string,
  captions: CaptionTiming[],
  videoWidth: number,
  videoHeight: number
): Promise<string> {
  const dir = path.dirname(videoPath);
  const baseName = path.basename(videoPath, path.extname(videoPath));
  const assPath = path.join(dir, `${baseName}.ass`);
  const outputPath = path.join(dir, `${baseName}-captioned.mp4`);

  // Write ASS subtitle file
  const assContent = generateAssSubtitles(captions, videoWidth, videoHeight);
  fs.writeFileSync(assPath, assContent, "utf-8");

  // Escape the path for ffmpeg filter syntax — colons and backslashes need escaping
  const escapedAssPath = assPath
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "'\\''");

  // Try the `ass` filter first (requires libass), fall back to `subtitles` filter
  const filters = [`ass='${escapedAssPath}'`, `subtitles='${escapedAssPath}'`];

  let captioned = false;
  for (const vf of filters) {
    const ffmpegCmd = [
      "ffmpeg",
      "-y",
      "-i",
      `'${videoPath}'`,
      "-vf",
      vf,
      "-c:v libx264",
      "-profile:v high",
      "-level 4.2",
      "-preset slow",
      "-crf 18",
      "-tune stillimage",
      "-pix_fmt yuv420p",
      "-movflags +faststart",
      "-an",
      `'${outputPath}'`,
    ].join(" ");

    try {
      execSync(ffmpegCmd, {
        stdio: "pipe",
        timeout: 120_000,
      });
      console.log(`    Video captioned: ${path.basename(outputPath)}`);
      captioned = true;
      break;
    } catch {
      // Try next filter
    }
  }

  if (!captioned) {
    console.warn(`    ffmpeg captioning failed — returning original video`);
    try {
      fs.unlinkSync(assPath);
    } catch {
      /* ignore */
    }
    return videoPath;
  }

  // Clean up intermediate ASS file
  try {
    fs.unlinkSync(assPath);
  } catch {
    /* ignore */
  }

  return outputPath;
}
