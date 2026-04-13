import { Composition, registerRoot } from "remotion";
import { DemoVideo } from "./demo-video.js";
import { CROSSFADE_FRAMES, FPS } from "./styles.js";
import type { CompositionInput } from "./types.js";

/** Remotion entry point. Composition duration and dimensions are derived
 *  from inputProps at render time via `calculateMetadata`. */
function RemotionRoot() {
  const defaults: CompositionInput = {
    title: "Demo",
    description: "",
    videoSrc: "recorded.webm",
    videoDurationFrames: 300,
    fps: FPS,
    width: 1920,
    height: 1080,
    introDurationFrames: 120,
    outroDurationFrames: 180,
    brandColor: "#3b82f6",
    steps: [],
  };

  return (
    <Composition
      id="demo-video"
      component={DemoVideo}
      calculateMetadata={async ({ props }) => ({
        durationInFrames:
          (props.introDurationFrames ?? 0) +
          (props.videoDurationFrames ?? 0) +
          (props.outroDurationFrames ?? 0) -
          2 * CROSSFADE_FRAMES,
        fps: props.fps ?? FPS,
        width: props.width ?? 1920,
        height: props.height ?? 1080,
      })}
      defaultProps={defaults}
    />
  );
}

registerRoot(RemotionRoot);
