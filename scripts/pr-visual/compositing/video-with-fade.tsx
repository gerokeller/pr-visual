import {
  AbsoluteFill,
  interpolate,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CROSSFADE_FRAMES } from "./styles.js";

interface VideoWithFadeProps {
  videoSrc: string;
}

/** Wraps OffthreadVideo with fade-in at the start and fade-out at the end so
 *  the recording cross-fades smoothly into the surrounding intro and outro
 *  sequences. */
export function VideoWithFade({ videoSrc }: VideoWithFadeProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, CROSSFADE_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const fadeOut = interpolate(
    frame,
    [durationInFrames - CROSSFADE_FRAMES, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ opacity: fadeIn * fadeOut }}>
      <OffthreadVideo src={staticFile(videoSrc)} />
    </AbsoluteFill>
  );
}
