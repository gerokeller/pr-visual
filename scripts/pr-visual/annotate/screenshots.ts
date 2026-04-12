import sharp from "sharp";
import * as path from "node:path";
import type { CaptureResult, AnnotatedScreenshot } from "../types.js";

const SIDEBAR_WIDTH_BASE = 240;
const FONT_SIZE_BASE = 14;
const PADDING_BASE = 16;
const BG_LIGHT = "#f8f9fa";
const BG_DARK = "#1e1e2e";
const TEXT_LIGHT = "#1a1a2e";
const TEXT_DARK = "#e0e0e0";
const ACCENT = "#6c5ce7";

/** @internal exported for testing */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** @internal exported for testing */
export function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > maxChars) {
      lines.push(current.trim());
      current = word;
    } else {
      current += (current ? " " : "") + word;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

/** @internal exported for testing */
export function buildSidebarSvg(
  caption: string,
  viewport: string,
  colorScheme: string,
  sidebarWidth: number,
  sidebarHeight: number,
  dpr: number
): Buffer {
  const fontSize = FONT_SIZE_BASE * dpr;
  const padding = PADDING_BASE * dpr;
  const lineHeight = fontSize * 1.5;
  const bg = colorScheme === "dark" ? BG_DARK : BG_LIGHT;
  const textColor = colorScheme === "dark" ? TEXT_DARK : TEXT_LIGHT;

  const maxChars = Math.floor((sidebarWidth - padding * 2) / (fontSize * 0.55));
  const captionLines = wrapText(caption, maxChars);

  const badgeText = `${viewport.toUpperCase()} | ${colorScheme.toUpperCase()}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sidebarWidth}" height="${sidebarHeight}">
  <rect width="100%" height="100%" fill="${bg}"/>
  <rect x="0" y="0" width="${3 * dpr}" height="100%" fill="${ACCENT}"/>
  <text x="${padding}" y="${padding + fontSize}"
        font-family="system-ui, -apple-system, sans-serif"
        font-size="${fontSize * 0.75}" font-weight="600"
        fill="${ACCENT}" letter-spacing="1">
    ${escapeXml(badgeText)}
  </text>
  <line x1="${padding}" y1="${padding + fontSize + 8 * dpr}"
        x2="${sidebarWidth - padding}" y2="${padding + fontSize + 8 * dpr}"
        stroke="${ACCENT}" stroke-width="${dpr}" opacity="0.3"/>
  ${captionLines
    .map(
      (line, i) =>
        `<text x="${padding}" y="${padding + fontSize * 2.5 + lineHeight * i}"
              font-family="system-ui, -apple-system, sans-serif"
              font-size="${fontSize}" fill="${textColor}">
        ${escapeXml(line)}
      </text>`
    )
    .join("\n  ")}
</svg>`;

  return Buffer.from(svg);
}

export async function annotateScreenshots(
  results: CaptureResult[]
): Promise<AnnotatedScreenshot[]> {
  const annotated: AnnotatedScreenshot[] = [];

  for (const result of results) {
    const dpr = result.viewport.deviceScaleFactor;
    const sidebarWidth = SIDEBAR_WIDTH_BASE * dpr;

    for (const screenshot of result.screenshots) {
      const img = sharp(screenshot.rawPath);
      const metadata = await img.metadata();
      const imgWidth = metadata.width ?? result.viewport.width * dpr;
      const imgHeight = metadata.height ?? result.viewport.height * dpr;

      const sidebarSvg = buildSidebarSvg(
        screenshot.caption,
        result.viewport.name,
        result.colorScheme,
        sidebarWidth,
        imgHeight,
        dpr
      );

      const outputPath = screenshot.rawPath.replace(/\.png$/, ".webp");

      // Create canvas with screenshot on left + sidebar on right
      await sharp({
        create: {
          width: imgWidth + sidebarWidth,
          height: imgHeight,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .composite([
          { input: screenshot.rawPath, left: 0, top: 0 },
          { input: sidebarSvg, left: imgWidth, top: 0 },
        ])
        .webp({ quality: 90 })
        .toFile(outputPath);

      screenshot.annotatedPath = outputPath;

      annotated.push({
        path: outputPath,
        caption: screenshot.caption,
        viewport: result.viewport.name,
        colorScheme: result.colorScheme,
      });

      console.log(`    Annotated: ${path.basename(outputPath)}`);
    }
  }

  return annotated;
}
