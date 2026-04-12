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
}

export interface ScenarioStep {
  action: "navigate" | "click" | "type" | "wait" | "scroll" | "screenshot";
  selector?: string;
  value?: string;
  url?: string;
  duration?: number;
  caption: string;
}

export interface CaptionTiming {
  text: string;
  route: string;
  startMs: number;
  endMs: number;
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
