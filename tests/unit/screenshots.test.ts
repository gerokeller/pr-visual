import { describe, it, expect } from "vitest";
import {
  escapeXml,
  wrapText,
  buildSidebarSvg,
} from "../../scripts/pr-visual/annotate/screenshots.js";

describe("escapeXml()", () => {
  it("escapes ampersand", () => {
    expect(escapeXml("a & b")).toBe("a &amp; b");
  });

  it("escapes angle brackets", () => {
    expect(escapeXml("<div>")).toBe("&lt;div&gt;");
  });

  it("escapes quotes", () => {
    expect(escapeXml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("escapes apostrophes", () => {
    expect(escapeXml("it's")).toBe("it&apos;s");
  });

  it("handles multiple special characters", () => {
    expect(escapeXml('<a href="x">&')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;"
    );
  });

  it("leaves plain text unchanged", () => {
    expect(escapeXml("Homepage full page view")).toBe(
      "Homepage full page view"
    );
  });
});

describe("wrapText()", () => {
  it("returns single line when text fits", () => {
    expect(wrapText("short text", 20)).toEqual(["short text"]);
  });

  it("wraps long text at word boundaries", () => {
    const result = wrapText("this is a longer text that should wrap", 15);
    expect(result.length).toBeGreaterThan(1);
    for (const line of result) {
      expect(line.length).toBeLessThanOrEqual(15);
    }
  });

  it("handles single word longer than maxChars", () => {
    // Words longer than maxChars still appear — wrapText wraps at word
    // boundaries, it doesn't truncate individual words
    const result = wrapText("superlongword short", 5);
    const allText = result.join(" ");
    expect(allText).toContain("superlongword");
    expect(allText).toContain("short");
  });

  it("handles empty string", () => {
    expect(wrapText("", 20)).toEqual([]);
  });

  it("preserves all words", () => {
    const input = "one two three four five";
    const result = wrapText(input, 10);
    const reconstructed = result.join(" ");
    expect(reconstructed).toBe(input);
  });
});

describe("buildSidebarSvg()", () => {
  it("returns a Buffer containing valid SVG", () => {
    const svg = buildSidebarSvg("Test caption", "desktop", "light", 480, 1800, 2);
    const str = svg.toString("utf-8");
    expect(str).toContain("<svg");
    expect(str).toContain("</svg>");
    expect(str).toContain('width="480"');
    expect(str).toContain('height="1800"');
  });

  it("includes the viewport badge", () => {
    const svg = buildSidebarSvg("Caption", "mobile", "dark", 720, 2532, 3);
    const str = svg.toString("utf-8");
    expect(str).toContain("MOBILE | DARK");
  });

  it("uses dark theme colors for dark mode", () => {
    const svg = buildSidebarSvg("Caption", "desktop", "dark", 480, 1800, 2);
    const str = svg.toString("utf-8");
    expect(str).toContain("#1e1e2e"); // dark background
    expect(str).toContain("#e0e0e0"); // dark text
  });

  it("uses light theme colors for light mode", () => {
    const svg = buildSidebarSvg("Caption", "desktop", "light", 480, 1800, 2);
    const str = svg.toString("utf-8");
    expect(str).toContain("#f8f9fa"); // light background
    expect(str).toContain("#1a1a2e"); // light text
  });

  it("scales accent bar width with DPR", () => {
    const svg2x = buildSidebarSvg("C", "desktop", "light", 480, 1800, 2);
    expect(svg2x.toString("utf-8")).toContain('width="6"'); // 3 * 2

    const svg3x = buildSidebarSvg("C", "mobile", "light", 720, 2532, 3);
    expect(svg3x.toString("utf-8")).toContain('width="9"'); // 3 * 3
  });

  it("wraps long captions into multiple text elements", () => {
    const longCaption =
      "This is a very long caption that should definitely wrap across multiple lines in the sidebar";
    const svg = buildSidebarSvg(longCaption, "desktop", "light", 480, 1800, 2);
    const str = svg.toString("utf-8");
    const textElements = str.match(/<text /g);
    // At least badge text + 2 caption lines
    expect(textElements!.length).toBeGreaterThanOrEqual(3);
  });
});
