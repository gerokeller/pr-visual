import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Beat, Emphasis } from "./types.js";
import { COLORS, FONTS } from "./styles.js";

type BeatValue = Beat | null;
type EmphasisValue = Emphasis | null;

interface CaptionBarProps {
  /** End-of-step timestamps, ms from the start of the recording segment. */
  stepTimestamps: number[];
  stepAnnotations: (string | null)[];
  stepBeats: BeatValue[];
  stepEmphases: EmphasisValue[];
  stepActions: string[];
  height: number;
  width: number;
}

const BEAT_LABELS: Record<NonNullable<BeatValue>, string> = {
  setup: "Setup",
  action: "The moment",
  payoff: "Payoff",
  close: "Takeaway",
};

function actionIcon(action: string): string {
  switch (action) {
    case "navigate":
      return "\u2192";
    case "click":
      return "\u25CF";
    case "type":
      return "\u2328";
    case "highlight":
      return "\u25C9";
    case "scroll":
      return "\u2195";
    default:
      return "";
  }
}

/** Bottom caption strip: a single glassmorphism pill that cross-fades
 *  between steps at their timestamp boundaries. */
export function CaptionBar({
  stepTimestamps,
  stepAnnotations,
  stepBeats,
  stepEmphases,
  stepActions,
  height,
  width,
}: CaptionBarProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;

  let currentIdx = 0;
  for (let i = 0; i < stepTimestamps.length; i++) {
    if (nowMs < stepTimestamps[i]!) {
      currentIdx = i;
      break;
    }
    if (i === stepTimestamps.length - 1) currentIdx = i;
  }

  const stepStartMs = currentIdx > 0 ? stepTimestamps[currentIdx - 1]! : 0;
  const stepEndMs = stepTimestamps[currentIdx] ?? stepStartMs;
  const stepDurationMs = Math.max(1, stepEndMs - stepStartMs);
  const timeInStepMs = nowMs - stepStartMs;

  const annotation = stepAnnotations[currentIdx] ?? "";
  const beat = stepBeats[currentIdx];
  const emphasis = stepEmphases[currentIdx] ?? "normal";
  const action = stepActions[currentIdx] ?? "";
  const totalSteps = stepTimestamps.length;

  const fadeInMs = 300;
  const fadeOutMs = 250;
  const fadeIn = interpolate(timeInStepMs, [0, fadeInMs], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    timeInStepMs,
    [stepDurationMs - fadeOutMs, stepDurationMs],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const opacity = annotation ? fadeIn * fadeOut : 0;
  const overallProgress = (currentIdx + 1) / totalSteps;

  const isStrong = emphasis === "strong";

  return (
    <AbsoluteFill
      style={{
        width,
        height,
        background: `linear-gradient(180deg, rgba(10, 15, 28, 0) 0%, rgba(10, 15, 28, 0.85) 40%, rgba(8, 12, 24, 0.95) 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 48px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: Math.min(width * 0.9, 1600),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
          opacity,
          transform: `translateY(${(1 - fadeIn) * 6}px)`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: isStrong ? "20px 36px" : "14px 30px",
            background: "rgba(15, 23, 42, 0.92)",
            border: isStrong
              ? "1px solid rgba(96, 165, 250, 0.55)"
              : "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: 999,
            boxShadow: isStrong
              ? "0 0 0 1px rgba(0, 0, 0, 0.35), 0 20px 60px rgba(0, 0, 0, 0.55), 0 0 40px rgba(59, 130, 246, 0.25)"
              : "0 0 0 1px rgba(0, 0, 0, 0.25), 0 12px 40px rgba(0, 0, 0, 0.45)",
            fontFamily: FONTS.body,
            color: COLORS.text,
          }}
        >
          <span
            style={{
              padding: "5px 10px",
              background: "rgba(59, 130, 246, 0.28)",
              color: "#93c5fd",
              fontFamily: FONTS.mono,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: "0.04em",
              borderRadius: 7,
              border: "1px solid rgba(96, 165, 250, 0.35)",
            }}
          >
            {`${currentIdx + 1}/${totalSteps}`}
          </span>
          {beat ? (
            <span
              style={{
                padding: "5px 12px",
                background: "rgba(96, 165, 250, 0.1)",
                color: "#bfdbfe",
                fontSize: 13,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                borderRadius: 6,
                border: "1px solid rgba(96, 165, 250, 0.18)",
              }}
            >
              {BEAT_LABELS[beat]}
            </span>
          ) : null}
          <span style={{ opacity: 0.7, fontSize: 18, color: "#93c5fd" }}>
            {actionIcon(action)}
          </span>
          <span
            style={{
              fontSize: isStrong ? 26 : 20,
              fontWeight: isStrong ? 700 : 600,
              lineHeight: 1.3,
              letterSpacing: "-0.005em",
              textShadow: "0 1px 2px rgba(0, 0, 0, 0.4)",
            }}
          >
            {annotation}
          </span>
        </div>

        <div
          style={{
            width: "100%",
            height: 3,
            background: "rgba(255, 255, 255, 0.08)",
            borderRadius: 2,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${overallProgress * 100}%`,
              height: "100%",
              background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
              borderRadius: 2,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
}
