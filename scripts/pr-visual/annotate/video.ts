import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CaptionTiming } from "../types.js";

const CAPTION_FONT_SIZE = 24;
const ROUTE_FONT_SIZE = 18;
const CAPTION_COLOR = "&HFFFFFF";
const ROUTE_COLOR = "&H9B59B6";
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
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
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
Style: Route,Courier New,${ROUTE_FONT_SIZE},${ROUTE_COLOR},${ROUTE_COLOR},${SHADOW_COLOR},${SHADOW_COLOR},0,0,0,0,100,100,0,0,1,2,0,2,20,20,${routeMarginBottom},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  for (const cap of captions) {
    const start = msToAssTime(cap.startMs);
    const end = msToAssTime(cap.endMs);
    ass += `Dialogue: 0,${start},${end},Caption,,0,0,0,,${escapeAssText(cap.text)}\n`;
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

  // Burn subtitles with ffmpeg
  const ffmpegCmd = [
    "ffmpeg",
    "-y",
    "-i",
    JSON.stringify(videoPath),
    "-vf",
    `ass=${JSON.stringify(assPath).slice(1, -1)}`,
    "-c:v libx264",
    "-profile:v high",
    "-level 4.2",
    "-preset slow",
    "-crf 18",
    "-tune stillimage",
    "-pix_fmt yuv420p",
    "-movflags +faststart",
    "-an",
    JSON.stringify(outputPath),
  ].join(" ");

  try {
    execSync(ffmpegCmd, {
      stdio: "pipe",
      timeout: 120_000,
    });
    console.log(`    Video captioned: ${path.basename(outputPath)}`);
  } catch (err) {
    const error = err as Error & { stderr?: Buffer };
    console.warn(
      `    ffmpeg failed: ${error.stderr?.toString() ?? error.message}`
    );
    return videoPath; // Return original if captioning fails
  }

  // Clean up intermediate ASS file
  fs.unlinkSync(assPath);

  return outputPath;
}
