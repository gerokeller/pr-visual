import { describe, it, expect } from "vitest";
import {
  BEAT_CHIP_DURATION_MS,
  BEAT_CHIP_FONT_SIZE,
  CAPTION_FONT_SIZE,
  CAPTION_STRONG_FONT_SIZE,
  escapeAssText,
  generateAssSubtitles,
  msToAssTime,
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
    expect(escapeAssText("Navigate to homepage")).toBe("Navigate to homepage");
  });

  it("handles mixed special characters", () => {
    expect(escapeAssText("path\\to\\{file}")).toBe("path\\\\to\\\\\\{file\\}");
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

  it("includes Caption, CaptionStrong, Route, and BeatChip styles", () => {
    const ass = generateAssSubtitles(captions, 1920, 1080);
    expect(ass).toContain(`Style: Caption,Arial,${CAPTION_FONT_SIZE}`);
    expect(ass).toContain(
      `Style: CaptionStrong,Arial,${CAPTION_STRONG_FONT_SIZE}`
    );
    expect(ass).toContain("Style: Route,Courier New,18");
    expect(ass).toContain(`Style: BeatChip,Arial,${BEAT_CHIP_FONT_SIZE}`);
  });

  it("CaptionStrong font size is strictly greater than Caption", () => {
    expect(CAPTION_STRONG_FONT_SIZE).toBeGreaterThan(CAPTION_FONT_SIZE);
  });

  it("generates dialogue events for each caption", () => {
    const ass = generateAssSubtitles(captions, 1920, 1080);
    // First caption
    expect(ass).toContain(
      "Dialogue: 0,0:00:00.00,0:00:02.00,Caption,,0,0,0,,Navigate to homepage"
    );
    expect(ass).toContain("Dialogue: 1,0:00:00.00,0:00:02.00,Route,,0,0,0,,/");
    // Second caption
    expect(ass).toContain(
      "Dialogue: 0,0:00:02.00,0:00:04.50,Caption,,0,0,0,,Click login button"
    );
    expect(ass).toContain(
      "Dialogue: 1,0:00:02.00,0:00:04.50,Route,,0,0,0,,/login"
    );
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

describe("generateAssSubtitles() — beats and emphasis", () => {
  it("emits N-1 beat chips for N distinct consecutive beats", () => {
    // Three beats (setup, action, payoff) → two transitions → two chips.
    const threeBeatCaptions: CaptionTiming[] = [
      {
        text: "Open the app",
        route: "/",
        startMs: 0,
        endMs: 2000,
        beat: "setup",
      },
      {
        text: "Fill the form",
        route: "/form",
        startMs: 2000,
        endMs: 4000,
        beat: "action",
      },
      {
        text: "See the result",
        route: "/done",
        startMs: 4000,
        endMs: 6000,
        beat: "payoff",
      },
    ];
    const ass = generateAssSubtitles(threeBeatCaptions, 1920, 1080);
    const chipLines = ass
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:") && l.includes(",BeatChip,"));
    expect(chipLines).toHaveLength(2);
    // Chips emit at the *second* and *third* step starts (the transitions),
    // not on the first step.
    expect(chipLines[0]!).toContain(msToAssTime(2000));
    expect(chipLines[1]!).toContain(msToAssTime(4000));
  });

  it("does not emit a chip when consecutive beats are identical", () => {
    const captions: CaptionTiming[] = [
      { text: "a", route: "/", startMs: 0, endMs: 1000, beat: "action" },
      { text: "b", route: "/", startMs: 1000, endMs: 2000, beat: "action" },
      { text: "c", route: "/", startMs: 2000, endMs: 3000, beat: "action" },
    ];
    const ass = generateAssSubtitles(captions, 1920, 1080);
    const chipLines = ass
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:") && l.includes(",BeatChip,"));
    expect(chipLines).toHaveLength(0);
  });

  it("does not emit a chip on the very first step (no transition yet)", () => {
    const captions: CaptionTiming[] = [
      { text: "a", route: "/", startMs: 0, endMs: 1000, beat: "setup" },
    ];
    const ass = generateAssSubtitles(captions, 1920, 1080);
    const chipLines = ass
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:") && l.includes(",BeatChip,"));
    expect(chipLines).toHaveLength(0);
  });

  it("beat chip duration is clamped to BEAT_CHIP_DURATION_MS", () => {
    const captions: CaptionTiming[] = [
      { text: "a", route: "/", startMs: 0, endMs: 500, beat: "setup" },
      {
        text: "b",
        route: "/",
        startMs: 500,
        endMs: 10_000,
        beat: "payoff",
      },
    ];
    const ass = generateAssSubtitles(captions, 1920, 1080);
    const chipLine = ass.split("\n").find((l) => l.includes(",BeatChip,"))!;
    // Chip emits at step 2's start (500ms) and ends 700ms later → 1200ms.
    expect(chipLine).toContain(msToAssTime(500 + BEAT_CHIP_DURATION_MS));
  });

  it("beat chip renders with fade tags and uppercase label", () => {
    const captions: CaptionTiming[] = [
      { text: "a", route: "/", startMs: 0, endMs: 1000, beat: "setup" },
      { text: "b", route: "/", startMs: 1000, endMs: 2000, beat: "payoff" },
    ];
    const ass = generateAssSubtitles(captions, 1920, 1080);
    const chipLine = ass.split("\n").find((l) => l.includes(",BeatChip,"))!;
    expect(chipLine).toContain("\\fad(150,150)");
    expect(chipLine).toContain("PAYOFF");
  });

  it("emphasis strong routes the caption to CaptionStrong style", () => {
    const captions: CaptionTiming[] = [
      {
        text: "normal step",
        route: "/",
        startMs: 0,
        endMs: 1000,
      },
      {
        text: "strong step",
        route: "/",
        startMs: 1000,
        endMs: 2000,
        emphasis: "strong",
      },
    ];
    const ass = generateAssSubtitles(captions, 1920, 1080);
    expect(ass).toContain(
      "Dialogue: 0,0:00:00.00,0:00:01.00,Caption,,0,0,0,,normal step"
    );
    expect(ass).toContain(
      "Dialogue: 0,0:00:01.00,0:00:02.00,CaptionStrong,,0,0,0,,strong step"
    );
  });
});
