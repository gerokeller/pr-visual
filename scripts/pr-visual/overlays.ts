import type { Locator, Page } from "playwright";
import type { ViewportConfig } from "./types.js";

export type InputVariant = "desktop" | "mobile";

/** Default hold for a `highlight` step if `duration` is omitted. */
export const DEFAULT_HIGHLIGHT_DURATION_MS = 1500;

export function resolveInputVariant(
  viewport: Pick<ViewportConfig, "isMobile">
): InputVariant {
  return viewport.isMobile ? "mobile" : "desktop";
}

/**
 * Inject a visible custom cursor that tracks the Playwright mouse.
 *
 * - `desktop`: 22px blue dot with white ring + subtle shadow.
 * - `mobile`: 40px translucent touch indicator, sized like a fingertip.
 *
 * Safe to call multiple times; the `#demo-cursor` id guard prevents
 * double-injection on the same page. A page navigation wipes the DOM, so
 * callers should re-inject after each successful `navigate`.
 */
export async function injectCustomCursor(
  page: Page,
  variant: InputVariant = "desktop"
): Promise<void> {
  await page.evaluate((v: InputVariant) => {
    if (document.getElementById("demo-cursor")) return;

    const isMobile = v === "mobile";

    const style = document.createElement("style");
    style.id = "demo-cursor-styles";
    const cursorSize = isMobile ? 40 : 22;
    const trailSize = isMobile ? 28 : 14;
    const bg = isMobile ? "rgba(59, 130, 246, 0.55)" : "#3b82f6";
    const ringColor = isMobile
      ? "rgba(255, 255, 255, 0.9)"
      : "rgba(255, 255, 255, 0.92)";
    const ringWidth = isMobile ? 3 : 2;
    const shadow = isMobile
      ? "0 0 28px rgba(59, 130, 246, 0.55), 0 4px 18px rgba(0, 0, 0, 0.3)"
      : "0 0 16px rgba(59, 130, 246, 0.5), 0 2px 8px rgba(0, 0, 0, 0.35)";

    style.textContent = [
      "#demo-cursor {",
      `  position: fixed; width: ${cursorSize}px; height: ${cursorSize}px;`,
      "  border-radius: 50%;",
      `  background: ${bg};`,
      `  box-shadow: ${shadow}, inset 0 0 0 ${ringWidth}px ${ringColor};`,
      "  pointer-events: none; z-index: 999999;",
      "  transform: translate(-50%, -50%) scale(1);",
      "  transition: transform 0.12s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.12s ease;",
      `  opacity: ${isMobile ? "0.88" : "0.95"};`,
      "  left: -100px; top: -100px;",
      "}",
      "#demo-cursor-trail {",
      `  position: fixed; width: ${trailSize}px; height: ${trailSize}px;`,
      "  border-radius: 50%;",
      `  background: ${isMobile ? "rgba(59, 130, 246, 0.35)" : "#3b82f6"};`,
      "  pointer-events: none; z-index: 999998;",
      "  transform: translate(-50%, -50%); opacity: 0;",
      "  transition: opacity 0.3s ease, left 0.16s ease, top 0.16s ease;",
      "  left: -100px; top: -100px;",
      "}",
    ].join("\n");
    document.head.appendChild(style);

    const cursor = document.createElement("div");
    cursor.id = "demo-cursor";
    document.body.appendChild(cursor);

    const trail = document.createElement("div");
    trail.id = "demo-cursor-trail";
    document.body.appendChild(trail);

    document.addEventListener("mousemove", (e) => {
      cursor.style.left = `${e.clientX}px`;
      cursor.style.top = `${e.clientY}px`;
      trail.style.left = `${e.clientX}px`;
      trail.style.top = `${e.clientY}px`;
      trail.style.opacity = isMobile ? "0.45" : "0.35";
      setTimeout(() => {
        trail.style.opacity = "0";
      }, 220);
    });

    document.addEventListener("mousedown", () => {
      cursor.style.transform = `translate(-50%, -50%) scale(${isMobile ? 0.85 : 0.7})`;
      cursor.style.boxShadow = isMobile
        ? `0 0 44px rgba(59, 130, 246, 0.8), 0 4px 22px rgba(0, 0, 0, 0.35), inset 0 0 0 3px rgba(255, 255, 255, 0.95)`
        : `0 0 24px rgba(59, 130, 246, 0.85), 0 2px 10px rgba(0, 0, 0, 0.4), inset 0 0 0 2px rgba(255, 255, 255, 1)`;
    });

    document.addEventListener("mouseup", () => {
      cursor.style.transform = "translate(-50%, -50%) scale(1)";
      cursor.style.boxShadow =
        shadow + `, inset 0 0 0 ${ringWidth}px ${ringColor}`;
    });
  }, variant);
}

/**
 * Show a click ripple at the center of `locator`.
 *
 * Desktop: blue ring + center dot, 650ms animation.
 * Mobile: outward tap-ring + lagging second ring + center dot, 950ms.
 *
 * Caller should invoke this *before* `page.click()` so the indicator is
 * visible in the recording at the moment of the click.
 */
export async function showClickIndicator(
  page: Page,
  locator: Locator,
  variant: InputVariant = "desktop"
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) return;

  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);

  await page.evaluate(
    ({ cx, cy, v }: { cx: number; cy: number; v: InputVariant }) => {
      if (!document.getElementById("demo-click-style")) {
        const style = document.createElement("style");
        style.id = "demo-click-style";
        style.textContent = [
          "@keyframes demo-ripple {",
          "  0% { transform: translate(-50%, -50%) scale(0.2); opacity: 0.9; }",
          "  100% { transform: translate(-50%, -50%) scale(1.1); opacity: 0; }",
          "}",
          "@keyframes demo-dot-fade {",
          "  0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }",
          "  70% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }",
          "  100% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }",
          "}",
          "@keyframes demo-tap-ring {",
          "  0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0.9; }",
          "  70% { opacity: 0.6; }",
          "  100% { transform: translate(-50%, -50%) scale(1.6); opacity: 0; }",
          "}",
        ].join("\n");
        document.head.appendChild(style);
      }

      const isMobile = v === "mobile";
      const rippleSize = isMobile ? 110 : 80;
      const rippleColor = isMobile ? "#60a5fa" : "#3b82f6";
      const rippleWidth = isMobile ? 4 : 3;
      const rippleAnim = isMobile
        ? "demo-tap-ring 0.7s ease-out forwards"
        : "demo-ripple 0.65s ease-out forwards";

      const ripple = document.createElement("div");
      ripple.className = "demo-click-ripple";
      ripple.style.cssText = [
        "position: fixed",
        `left: ${cx}px`,
        `top: ${cy}px`,
        `width: ${rippleSize}px`,
        `height: ${rippleSize}px`,
        "border-radius: 50%",
        `border: ${rippleWidth}px solid ${rippleColor}`,
        `box-shadow: 0 0 24px ${isMobile ? "rgba(96, 165, 250, 0.55)" : "rgba(59, 130, 246, 0.45)"}`,
        "pointer-events: none",
        "z-index: 99998",
        `animation: ${rippleAnim}`,
      ].join("; ");
      document.body.appendChild(ripple);

      let ripple2: HTMLDivElement | null = null;
      if (isMobile) {
        ripple2 = document.createElement("div");
        ripple2.className = "demo-click-ripple";
        ripple2.style.cssText = [
          "position: fixed",
          `left: ${cx}px`,
          `top: ${cy}px`,
          `width: ${rippleSize}px`,
          `height: ${rippleSize}px`,
          "border-radius: 50%",
          `border: 2px solid ${rippleColor}`,
          "pointer-events: none",
          "z-index: 99998",
          "animation: demo-tap-ring 0.95s ease-out 0.15s forwards",
        ].join("; ");
        document.body.appendChild(ripple2);
      }

      const dotSize = isMobile ? 26 : 18;
      const dotBg = "rgba(59, 130, 246, 0.7)";
      const dot = document.createElement("div");
      dot.className = "demo-click-dot";
      dot.style.cssText = [
        "position: fixed",
        `left: ${cx}px`,
        `top: ${cy}px`,
        `width: ${dotSize}px`,
        `height: ${dotSize}px`,
        "border-radius: 50%",
        `background: ${dotBg}`,
        `box-shadow: 0 0 16px ${isMobile ? "rgba(59, 130, 246, 0.8)" : "rgba(59, 130, 246, 0.6)"}, 0 0 0 2px rgba(255, 255, 255, 0.85)`,
        "pointer-events: none",
        "z-index: 99998",
        "animation: demo-dot-fade 0.75s ease-out forwards",
      ].join("; ");
      document.body.appendChild(dot);

      const lifetime = isMobile ? 1200 : 850;
      setTimeout(() => {
        ripple.remove();
        ripple2?.remove();
        dot.remove();
      }, lifetime);
    },
    { cx: x, cy: y, v: variant }
  );

  // Brief pause so the indicator is visible in the recording.
  await page.waitForTimeout(variant === "mobile" ? 220 : 170);
}

/** Inject highlight keyframes + spotlight overlay (idempotent). */
export async function ensureHighlightStyles(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.getElementById("demo-highlight-styles")) return;
    const style = document.createElement("style");
    style.id = "demo-highlight-styles";
    style.textContent = [
      "@keyframes demo-highlight-pulse {",
      "  0%, 100% { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.6), 0 0 20px rgba(59, 130, 246, 0.3); }",
      "  50% { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.8), 0 0 30px rgba(59, 130, 246, 0.5); }",
      "}",
      ".demo-highlighted {",
      "  animation: demo-highlight-pulse 1.5s ease-in-out infinite !important;",
      "  border-radius: inherit; position: relative; z-index: 10000;",
      "}",
      "#demo-spotlight {",
      "  position: fixed; inset: 0;",
      "  background: rgba(0, 0, 0, 0.3);",
      "  pointer-events: none; z-index: 9999;",
      "  opacity: 0; transition: opacity 0.3s ease;",
      "}",
      "#demo-spotlight.active { opacity: 1; }",
    ].join("\n");
    document.head.appendChild(style);
  });
}

/**
 * Highlight a selector with a pulsing glow and dimmed backdrop for
 * `durationMs`. Cleans up classes and spotlight on completion.
 */
export async function highlightElement(
  page: Page,
  locator: Locator,
  durationMs: number
): Promise<void> {
  const handle = await locator.elementHandle();
  if (!handle) return;

  await ensureHighlightStyles(page);

  await page.evaluate((el: Element) => {
    let spotlight = document.getElementById("demo-spotlight");
    if (!spotlight) {
      spotlight = document.createElement("div");
      spotlight.id = "demo-spotlight";
      document.body.appendChild(spotlight);
    }
    spotlight.classList.add("active");
    (el as HTMLElement).classList.add("demo-highlighted");
  }, handle);

  await page.waitForTimeout(durationMs);

  await page.evaluate((el: Element) => {
    (el as HTMLElement).classList.remove("demo-highlighted");
    const spotlight = document.getElementById("demo-spotlight");
    if (spotlight) spotlight.classList.remove("active");
  }, handle);
}
