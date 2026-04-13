import { COLORS, FONTS } from "../styles.js";
import { GlassCard } from "./glass-card.js";

interface CategoryBadgeProps {
  label: string;
  size?: "normal" | "compact";
}

/** Glassmorphism pill badge for displaying a category label. */
export function CategoryBadge({ label, size = "normal" }: CategoryBadgeProps) {
  const isCompact = size === "compact";

  return (
    <GlassCard
      style={{
        padding: isCompact ? "4px 12px" : "6px 16px",
        borderRadius: isCompact ? 16 : 20,
        display: isCompact ? "inline-block" : undefined,
      }}
    >
      <span
        style={{
          fontFamily: FONTS.mono,
          fontSize: isCompact ? 10 : 11,
          fontWeight: 600,
          color: COLORS.accentLight,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </span>
    </GlassCard>
  );
}
