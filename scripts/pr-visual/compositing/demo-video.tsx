import { AbsoluteFill, Sequence } from "remotion";
import { CaptionBar } from "./caption-bar.js";
import { IntroSequence } from "./intro-sequence.js";
import { OutroSequence } from "./outro-sequence.js";
import type { CompositionInput } from "./types.js";
import { CROSSFADE_FRAMES } from "./styles.js";
import { VideoWithFade } from "./video-with-fade.js";

export function DemoVideo(props: CompositionInput) {
  const {
    title,
    description,
    videoSrc,
    width,
    height,
    introDurationFrames,
    videoDurationFrames,
    outroDurationFrames,
    brandColor,
    steps,
    category,
    sprintLabel,
    orgName,
    highlights,
    recordedDate,
    recordingDurationSec,
    stepTimestamps,
    stepAnnotations,
    stepBeats,
    stepEmphases,
    stepActions,
    useCanvasCaptions,
    captionBarHeight,
    mobileVideoSrc,
    mobileWidth,
    mobileHeight,
    mobileLayout,
    desktopVideoWidth,
    desktopVideoHeight,
  } = props;

  // Crossfade overlap: intro/video and video/outro each overlap by
  // CROSSFADE_FRAMES.
  const videoStart = introDurationFrames - CROSSFADE_FRAMES;
  const outroStart = videoStart + videoDurationFrames - CROSSFADE_FRAMES;

  const barH =
    useCanvasCaptions && captionBarHeight ? captionBarHeight : 0;
  const videoZoneHeight = height - barH;

  const hasCaptionData =
    useCanvasCaptions &&
    Array.isArray(stepTimestamps) &&
    Array.isArray(stepAnnotations) &&
    Array.isArray(stepBeats) &&
    Array.isArray(stepEmphases) &&
    Array.isArray(stepActions);

  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={introDurationFrames}>
        <IntroSequence
          title={title}
          description={description}
          brandColor={brandColor}
          category={category}
          sprintLabel={sprintLabel}
        />
      </Sequence>

      <Sequence from={videoStart} durationInFrames={videoDurationFrames}>
        <AbsoluteFill>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width,
              height: videoZoneHeight,
            }}
          >
            <VideoWithFade
              videoSrc={videoSrc}
              {...(mobileVideoSrc !== undefined ? { mobileVideoSrc } : {})}
              desktopAspect={
                desktopVideoWidth && desktopVideoHeight
                  ? { width: desktopVideoWidth, height: desktopVideoHeight }
                  : { width, height: videoZoneHeight }
              }
              {...(mobileWidth && mobileHeight
                ? { mobileAspect: { width: mobileWidth, height: mobileHeight } }
                : {})}
              {...(mobileLayout !== undefined ? { layout: mobileLayout } : {})}
            />
          </div>

          {hasCaptionData &&
          barH > 0 &&
          stepTimestamps &&
          stepAnnotations &&
          stepBeats &&
          stepEmphases &&
          stepActions ? (
            <div
              style={{
                position: "absolute",
                top: videoZoneHeight,
                left: 0,
                width,
                height: barH,
              }}
            >
              <CaptionBar
                stepTimestamps={stepTimestamps}
                stepAnnotations={stepAnnotations}
                stepBeats={stepBeats}
                stepEmphases={stepEmphases}
                stepActions={stepActions}
                height={barH}
                width={width}
              />
            </div>
          ) : null}
        </AbsoluteFill>
      </Sequence>

      <Sequence from={outroStart} durationInFrames={outroDurationFrames}>
        <OutroSequence
          title={title}
          brandColor={brandColor}
          steps={steps}
          category={category}
          orgName={orgName}
          highlights={highlights}
          recordedDate={recordedDate}
          recordingDurationSec={recordingDurationSec}
        />
      </Sequence>
    </AbsoluteFill>
  );
}
