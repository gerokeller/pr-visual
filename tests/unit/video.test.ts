import { describe, it, expect } from "vitest";
import {
  msToAssTime,
  escapeAssText,
  generateAssSubtitles,
} from "../../scripts/pr-visual/annotate/video.js";
import type { CaptionTiming } from "../../scripts/pr-visual/types.js";

describe("msToAssTime()", () => {
  it("formats zero", () => {
    expect(msToAssTime(0)).toBe("0:00:00.00");
  });

  it("formats sub-second durations", () => {
    expect(msToAssTime(500)).toBe("0:00:00.50");
  });

  it("formats seconds", () => {
    expect(msToAssTime(5000)).toBe("0:00:05.00");
  });

  it("formats minutes and seconds", () => {
    expect(msToAssTime(65_500)).toBe("0:01:05.50");
  });

  it("formats hours", () => {
    expect(msToAssTime(3_661_000)).toBe("1:01:01.00");
  });

  it("handles fractional milliseconds", () => {
    expect(msToAssTime(1234)).toBe("0:00:01.23");
  });
});

describe("escapeAssText()", () => {
  it("escapes backslashes", () => {
    expect(escapeAssText("a\\b")).toBe("a\\\\b");
  });

  it("escapes curly braces", () => {
    expect(escapeAssText("{bold}")).toBe("\\{bold\\}");
  });

  it("leaves normal text unchanged", () => {
    expect(escapeAssText("Navigate to homepage")).toBe(
      "Navigate to homepage"
    );
  });

  it("handles mixed special characters", () => {
    expect(escapeAssText("path\\to\\{file}")).toBe(
      "path\\\\to\\\\\\{file\\}"
    );
  });
});

describe("generateAssSubtitles()", () => {
  const captions: CaptionTiming[] = [
    { text: "Navigate to homepage", route: "/", startMs: 0, endMs: 2000 },
    {
      text: "Click login button",
      route: "/login",
      startMs: 2000,
      endMs: 4500,
    },
  ];

  it("generates valid ASS with Script Info header", () => {
    const ass = generateAssSubtitles(captions, 1920, 1080);
    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("PlayResY: 1080");
  });

  it("includes both Caption and Route styles", () => {
    const ass = generateAssSubtitles(captions, 1920, 1080);
    expect(ass).toContain("Style: Caption,Arial,24");
    expect(ass).toContain("Style: Route,Courier New,18");
  });

  it("generates dialogue events for each caption", () => {
    const ass = generateAssSubtitles(captions, 1920, 1080);
    // First caption
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.00,Caption,,0,0,0,,Navigate to homepage");
    expect(ass).toContain("Dialogue: 1,0:00:00.00,0:00:02.00,Route,,0,0,0,,/");
    // Second caption
    expect(ass).toContain("Dialogue: 0,0:00:02.00,0:00:04.50,Caption,,0,0,0,,Click login button");
    expect(ass).toContain("Dialogue: 1,0:00:02.00,0:00:04.50,Route,,0,0,0,,/login");
  });

  it("produces two dialogue lines per caption (caption + route)", () => {
    const ass = generateAssSubtitles(captions, 1920, 1080);
    const dialogueLines = ass
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:"));
    expect(dialogueLines).toHaveLength(4); // 2 captions × 2 tracks
  });

  it("handles empty captions array", () => {
    const ass = generateAssSubtitles([], 1920, 1080);
    expect(ass).toContain("[Script Info]");
    const dialogueLines = ass
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:"));
    expect(dialogueLines).toHaveLength(0);
  });
});
