export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  userAgent?: string;
  isMobile?: boolean;
}

/** Logical viewport dimensions for each named quality preset.
 *  Final MP4 dimensions are width × deviceScaleFactor. */
export const QUALITY_PRESETS = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "2k": { width: 2560, height: 1440 },
  "4k": { width: 3840, height: 2160 },
} as const;

export type QualityPreset = keyof typeof QUALITY_PRESETS;

export const QUALITY_PRESET_NAMES = Object.keys(
  QUALITY_PRESETS
) as QualityPreset[];

/** Default desktop viewport when no quality preset or override is set. */
export const DEFAULT_DESKTOP_VIEWPORT: ViewportConfig = {
  name: "desktop",
  width: 1440,
  height: 900,
  deviceScaleFactor: 2,
};

export const VIEWPORTS: Record<string, ViewportConfig> = {
  desktop: DEFAULT_DESKTOP_VIEWPORT,
  mobile: {
    name: "mobile",
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    isMobile: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
};

/** Explicit viewport override on a scenario. */
export interface ScenarioViewport {
  width: number;
  height: number;
  deviceScaleFactor?: number;
}

export type ColorScheme = "light" | "dark";

export const COLOR_SCHEMES: ColorScheme[] = ["light", "dark"];

export interface Scenario {
  name: string;
  description: string;
  steps: ScenarioStep[];
  /** Quality preset — sets the desktop logical viewport for this scenario. */
  quality?: QualityPreset;
  /** Explicit desktop viewport override. Ignored if `quality` is set. */
  viewport?: ScenarioViewport;
  /** Free-form audience label (e.g. "Agency PM", "Client"). Stored on the
   *  scenario and surfaced by the Story Director (#8) and Remotion intro
   *  (#2); no direct rendering in the annotation layer yet. */
  persona?: string;
}

export type Pacing = "quick" | "normal" | "slow" | "dramatic";

export const PACING_MODES: Pacing[] = ["quick", "normal", "slow", "dramatic"];

export type Beat = "setup" | "action" | "payoff" | "close";

export const BEATS: Beat[] = ["setup", "action", "payoff", "close"];

export type Emphasis = "normal" | "strong";

export const EMPHASIS_MODES: Emphasis[] = ["normal", "strong"];

export interface ScenarioStep {
  action:
    | "navigate"
    | "click"
    | "type"
    | "wait"
    | "scroll"
    | "screenshot"
    | "highlight";
  selector?: string;
  value?: string;
  url?: string;
  duration?: number;
  caption: string;
  /** Pacing hint governing the post-action hold time.
   *  @default "normal" */
  pacing?: Pacing;
  /** Narrative beat classifying where this step sits in the story arc.
   *  Triggers beat-transition chips and enforces a per-beat minimum hold. */
  beat?: Beat;
  /** Caption emphasis. `strong` renders as a larger title-card caption.
   *  @default "normal" */
  emphasis?: Emphasis;
  /** Skip this step on the dedicated mobile composite pass. */
  mobileSkip?: boolean;
  /** Override `selector` on the mobile composite pass. */
  mobileSelector?: string;
  /** Override `url` (or its path component) on the mobile composite pass.
   *  Useful when mobile uses a different route. */
  mobilePath?: string;
}

export interface CaptionTiming {
  text: string;
  route: string;
  startMs: number;
  endMs: number;
  /** Narrative beat for this step, if set. Used by the video annotator to
   *  emit beat-transition chips. */
  beat?: Beat;
  /** Caption emphasis — governs which ASS style renders this caption. */
  emphasis?: Emphasis;
}

export interface CaptureResult {
  viewport: ViewportConfig;
  colorScheme: ColorScheme;
  screenshots: ScreenshotResult[];
  videoPath: string | null;
  captions: CaptionTiming[];
}

export interface ScreenshotResult {
  stepIndex: number;
  caption: string;
  rawPath: string;
  annotatedPath: string;
  /** Narrative beat for this step, if set. */
  beat?: Beat;
  /** Caption emphasis — controls sidebar rendering. */
  emphasis?: Emphasis;
}

export interface AnnotatedScreenshot {
  path: string;
  caption: string;
  viewport: string;
  colorScheme: ColorScheme;
}

// ---------------------------------------------------------------------------
// Runtime config (internal, assembled from project config + env + defaults)
// ---------------------------------------------------------------------------

export interface RuntimeConfig {
  /** Resolved base URL with port substituted */
  baseUrl: string;
  /** Absolute path to output directory */
  outputDir: string;
  /** Detected or overridden PR number */
  prNumber?: number;
  /** PR body text for scenario generation */
  prBody?: string;
  /** The loaded project config */
  project: ProjectConfig;
  /** Active worktree context (null when running without isolation) */
  worktree: WorktreeContext | null;
}

// ---------------------------------------------------------------------------
// Template variables — available in commands, env values, and baseUrl
// ---------------------------------------------------------------------------
//
//   {{port}}    – allocated TCP port for this run
//   {{runId}}   – unique identifier (timestamp + random hex), safe for use as
//                 Docker project name, database suffix, tmp-dir name, etc.
//   {{rootDir}} – absolute path to the working directory (worktree or repo)
//

// ---------------------------------------------------------------------------
// Project config — what consuming repos define in .pr-visual.config.ts
// ---------------------------------------------------------------------------

export interface ProjectConfig {
  /** Base URL template — use {{port}} for the allocated port.
   *  @default "http://localhost:{{port}}" */
  baseUrl?: string;

  /** Preferred port. When running in a worktree, an available port is
   *  auto-allocated starting from this value.
   *  @default 3000 */
  port?: number;

  /** Ordered setup steps executed before the dev server starts.
   *  Examples: docker compose up, database migrations, seed data.
   *  All template variables ({{port}}, {{runId}}, {{rootDir}}) are
   *  substituted in `command` and `env` values. COMPOSE_PROJECT_NAME
   *  is automatically set to {{runId}} unless you override it. */
  setup?: LifecycleStep[];

  /** Dev server configuration. */
  devServer: DevServerConfig;

  /** Readiness probe — how to tell the server is actually ready. */
  readiness?: ReadinessConfig;

  /** Ordered teardown steps executed after capture (or on failure).
   *  Examples: docker compose down, temp file cleanup.
   *  Same template substitution as setup. */
  teardown?: LifecycleStep[];

  /** Output directory relative to project root.
   *  @default ".pr-visual" */
  outputDir?: string;

  /** Whether to use a git worktree for isolation.
   *  @default true */
  isolate?: boolean;

  /** Where to create worktrees (absolute or relative to project root).
   *  Placed *outside* the repo to avoid nesting.
   *  @default "../.pr-visual-worktrees" */
  worktreeDir?: string;

  /** Dependencies to install in the worktree.
   *  @default "npm ci" */
  installCommand?: string;

  /** Routes to capture when falling back to static scenarios.
   *  Each entry is a path (e.g. "/en", "/en/about") with an optional label.
   *  @default ["/"] */
  routes?: Array<string | { path: string; label: string }>;

  /** Project-wide default quality preset for desktop capture.
   *  Overridden by `Scenario.quality`, `Scenario.viewport`, or the
   *  `PR_VISUAL_QUALITY` env var. */
  quality?: QualityPreset;

  /** Adaptive pacing configuration. */
  pacing?: PacingConfig;

  /** Optional interaction overlays injected at capture time (cursor,
   *  click ripples, highlight spotlight). All flags default to `false`
   *  so existing users see no change in behavior. */
  overlays?: OverlaysConfig;

  /** Optional video production / Remotion compositing settings. */
  video?: VideoConfig;
}

export interface VideoConfig {
  /** Compositing pipeline. `"none"` (default) uses the existing ffmpeg
   *  ASS-burn path. `"remotion"` runs the recorded clip through a Remotion
   *  composition (intro + crossfades + caption pill + outro). Requires
   *  `remotion`, `@remotion/bundler`, `@remotion/renderer`, `react`,
   *  `react-dom` to be installed; otherwise falls back to the captioned MP4
   *  with a warning.
   *  @default "none" */
  compositing?: "none" | "remotion";
  /** Brand accent color used by intro/outro/caption-pill chrome.
   *  @default "#3b82f6" */
  brandColor?: string;
  /** Optional category label rendered as a glassmorphism badge. */
  category?: string;
  /** Optional sprint / release label rendered subtly in the intro. */
  sprintLabel?: string;
  /** Optional org / team name rendered in the outro footer. */
  orgName?: string;
  /** Optional bullet list rendered as a "Key Highlights" card in the outro. */
  highlights?: string[];
  /** Mobile composite settings. When `mobile.enabled` is true the recorder
   *  runs a dedicated mobile pass after the main matrix and composites both
   *  streams into one MP4. Implies `compositing: "remotion"`. */
  mobile?: MobileVideoConfig;
}

export interface MobileVideoConfig {
  /** Master switch. When false (default), no mobile pass runs and the
   *  composite stays desktop-only. */
  enabled?: boolean;
  /** Mobile viewport in CSS pixels. Defaults to iPhone 14 Pro logical size. */
  viewport?: { width: number; height: number };
  /** Device scale factor for the mobile context.
   *  @default 3 */
  deviceScaleFactor?: number;
  /** Composition layout in the final render.
   *  - `side-by-side`: desktop 80% + phone 20% in a stylized device frame.
   *  - `pip`: phone bottom-right over fullscreen desktop.
   *  - `sequential`: desktop first half + phone second half.
   *  @default "side-by-side" */
  layout?: "side-by-side" | "pip" | "sequential";
}

export interface OverlaysConfig {
  /** Inject a custom cursor that follows the Playwright mouse with
   *  click-feedback scale-down. Visible in both video and post-navigate
   *  screenshots. */
  cursor?: boolean;
  /** Emit a ripple + center-dot at each click's coordinates. */
  clicks?: boolean;
  /** Enable the `highlight` step action (pulsing glow + dimmed backdrop). */
  highlights?: boolean;
}

export interface PacingConfig {
  /** Reading speed in words per second used for caption hold estimation.
   *  Captions of 6 words or fewer get a +0.6 w/s bonus.
   *  @default 3.2 */
  wordsPerSecond?: number;
}

export interface LifecycleStep {
  /** Human-readable label for logging */
  name: string;
  /** Shell command to execute — template variables are substituted */
  command: string;
  /** Working directory (relative to project/worktree root).
   *  @default "." */
  cwd?: string;
  /** Extra environment variables merged with the process env.
   *  Template variables are substituted in values. */
  env?: Record<string, string>;
  /** Timeout in milliseconds.
   *  @default 120_000 */
  timeout?: number;
}

export interface DevServerConfig {
  /** Shell command to start the dev server */
  command: string;
  /** Working directory (relative to project/worktree root).
   *  @default "." */
  cwd?: string;
  /** Extra environment variables — template variables are substituted in values */
  env?: Record<string, string>;
}

export interface ReadinessConfig {
  /** URL path to probe (appended to baseUrl).
   *  @default "/" */
  path?: string;
  /** Expected HTTP status code.
   *  @default 200 */
  status?: number;
  /** Maximum wait time in milliseconds.
   *  @default 45_000 */
  timeout?: number;
  /** Interval between probes in milliseconds.
   *  @default 1_000 */
  interval?: number;
}

// ---------------------------------------------------------------------------
// Run context — the resolved set of template values for a single run
// ---------------------------------------------------------------------------

export interface RunContext {
  /** Unique run identifier (e.g. "pr-visual-1713000000000-a1b2c3") */
  runId: string;
  /** Allocated TCP port */
  port: number;
  /** Absolute path to the working directory (worktree or project root) */
  rootDir: string;
}

// ---------------------------------------------------------------------------
// Worktree context — tracks an isolated run environment
// ---------------------------------------------------------------------------

export interface WorktreeContext {
  /** Absolute path to the worktree */
  rootDir: string;
  /** Branch checked out in the worktree */
  branch: string;
  /** Allocated port for this run */
  port: number;
  /** Unique run ID (used for branch names, directory names) */
  runId: string;
}
