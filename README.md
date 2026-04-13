# pr-visual

A Claude Code plugin that captures visual PR documentation: AI-generated Playwright scenarios from the PR description or git diff, annotated screenshots (desktop 2x + mobile 3x, light + dark), and walkthrough videos with burned-in captions.

Each run is isolated in a **git worktree** with its own port and **namespaced resources** (Docker containers, networks, volumes), so multiple runs can execute in parallel without collisions.

## Prerequisites

- Node.js 20+
- [ffmpeg](https://ffmpeg.org/) — `brew install ffmpeg` (optional — needed for video captions and voice-over transcoding)
- [GitHub CLI](https://cli.github.com/) — `brew install gh`
- Chromium (installed automatically via Playwright on `postinstall`)

## Installation

### From Claude Code marketplace (recommended)

```bash
/plugin marketplace add gerokeller/pr-visual
```

Then install the plugin:

```bash
/plugin install pr-visual
```

To share with your team, add this to your project's `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "pr-visual": {
      "source": {
        "source": "github",
        "repo": "gerokeller/pr-visual"
      }
    }
  },
  "enabledPlugins": {
    "pr-visual@pr-visual": true
  }
}
```

### Via npm

```bash
npm install -D pr-visual
```

Claude Code automatically discovers the plugin via `.claude-plugin/plugin.json` inside `node_modules/pr-visual/`. This gives you:

- `/pr-visual` slash command
- PostToolUse hook that reminds you to run it after `gh pr create`

## Quick start

### 1. Scaffold the config

```
/pr-visual init
```

Or via CLI:

```bash
npx pr-visual init
```

This detects your project setup and generates a tailored `.pr-visual.config.ts`:

```
pr-visual init: Detecting project setup...
  Framework:       Next.js
  Package manager: pnpm
  Docker:          yes (postgres, redis)
  ORM:             prisma
  Health endpoint: /api/health
  Default port:    3000

  Created: .pr-visual.config.ts
```

### 2. Review and commit the config

The generated config is ready to use but worth reviewing. Commit it so every team member gets the same behavior.

### 3. Run it

```
/pr-visual
```

Or manually:

```bash
npx pr-visual
```

## Configuration

### Plugin settings

The plugin accepts the following user configuration (set during plugin install or in settings):

| Setting | Description |
|---------|-------------|
| `anthropic_api_key` | API key for AI-generated scenarios (stored in system keychain). Falls back to `ANTHROPIC_API_KEY` env var, then to static route capture. |

### Project config

`.pr-visual.config.ts` is the contract between your project and the recorder. It declares everything needed to bring up the application from a cold worktree:

```typescript
import type { ProjectConfig } from "pr-visual/scripts/pr-visual/types.js";

export default {
  port: 3000,

  devServer: {
    command: "npm run dev",
    env: { PORT: "{{port}}" },
  },

  // Setup steps — Docker resources are auto-scoped via COMPOSE_PROJECT_NAME
  setup: [
    { name: "Start database", command: "docker compose up -d postgres redis" },
    { name: "Run migrations", command: "npx prisma migrate deploy" },
    { name: "Seed data", command: "npx prisma db seed" },
  ],

  readiness: {
    path: "/api/health",
    status: 200,
    timeout: 60_000,
  },

  // Teardown — only this run's containers are removed
  teardown: [
    { name: "Stop database", command: "docker compose down -v" },
  ],

  isolate: true,
  installCommand: "npm ci",
} satisfies ProjectConfig;
```

### Template variables

All `command` strings and `env` values support these placeholders:

| Variable | Description |
|----------|-------------|
| `{{port}}` | Auto-allocated TCP port for this run |
| `{{runId}}` | Unique run identifier — safe as Docker project name, DB suffix, directory name |
| `{{rootDir}}` | Absolute path to the working directory (worktree or project root) |

### Automatic resource isolation

Every lifecycle step and the dev server receive these environment variables automatically — no manual setup needed:

| Variable | Value | Purpose |
|----------|-------|---------|
| `COMPOSE_PROJECT_NAME` | `{{runId}}` | Scopes all Docker Compose containers, networks, and volumes to this run |
| `PORT` | Allocated port | Standard port variable |
| `PR_VISUAL_RUN_ID` | `{{runId}}` | Available for custom scripts |
| `PR_VISUAL_PORT` | Allocated port | Available for custom scripts |
| `PR_VISUAL_ROOT_DIR` | `{{rootDir}}` | Available for custom scripts |

This means `docker compose up -d postgres` in two parallel runs creates two independent Postgres containers, and each run's `docker compose down -v` only removes its own.

### Config reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | `number` | `3000` | Preferred port (auto-incremented if busy) |
| `baseUrl` | `string` | `http://localhost:{{port}}` | URL template |
| `devServer.command` | `string` | `npm run dev` | Dev server command |
| `devServer.env` | `Record` | — | Extra env vars (template substitution) |
| `setup` | `LifecycleStep[]` | — | Pre-server steps (Docker, migrations, seeds) |
| `readiness.path` | `string` | `/` | Readiness probe endpoint |
| `readiness.status` | `number` | `200` | Expected HTTP status |
| `readiness.timeout` | `number` | `45000` | Max wait time in ms |
| `readiness.interval` | `number` | `1000` | Probe interval in ms |
| `teardown` | `LifecycleStep[]` | — | Post-capture cleanup steps |
| `isolate` | `boolean` | `true` | Use git worktree for isolation |
| `worktreeDir` | `string` | `../.pr-visual-worktrees` | Where to create worktrees |
| `installCommand` | `string` | `npm ci` | Install command for worktrees |
| `outputDir` | `string` | `.pr-visual` | Output directory (relative to root) |
| `routes` | `Array<string \| { path, label }>` | `["/"]` | Routes for static fallback capture |
| `quality` | `"720p" \| "1080p" \| "2k" \| "4k"` | — | Desktop quality preset (see [Quality presets](#quality-presets)) |
| `pacing.wordsPerSecond` | `number` | `3.2` | Reading speed used by [adaptive pacing](#adaptive-pacing) |
| `overlays.cursor` | `boolean` | `false` | Inject a visible custom cursor during capture (see [Interaction overlays](#interaction-overlays)) |
| `overlays.clicks` | `boolean` | `false` | Emit a ripple + center dot at each click's coordinates |
| `overlays.highlights` | `boolean` | `false` | Enable the `highlight` scenario step action (pulsing glow + dimmed backdrop) |
| `video.compositing` | `"none" \| "remotion"` | `"none"` | Run the recorded clip through a Remotion composition (see [Video production](#video-production)) |
| `video.brandColor` | `string` | `"#3b82f6"` | Brand accent color for intro/outro/caption-pill chrome |
| `video.category` | `string` | — | Optional category label rendered as a glassmorphism badge |
| `video.sprintLabel` | `string` | — | Optional sprint / release label rendered subtly in the intro |
| `video.orgName` | `string` | — | Optional org name rendered in the outro footer |
| `video.highlights` | `string[]` | — | Optional bullets rendered as a "Key Highlights" card in the outro |
| `video.mobile.enabled` | `boolean` | `false` | Run a dedicated mobile composite pass after the main matrix and composite both streams (see [Mobile composite layouts](#mobile-composite-layouts)). Implies `compositing: "remotion"`. |
| `video.mobile.viewport` | `{ width, height }` | `{ 390, 844 }` | Mobile pass viewport |
| `video.mobile.deviceScaleFactor` | `number` | `3` | Mobile pass DPR |
| `video.mobile.layout` | `"side-by-side" \| "pip" \| "sequential"` | `"side-by-side"` | Composition layout |
| `auth.storageStateDir` | `string` | `".pr-visual/auth"` | Directory holding Playwright storage state files (see [Authenticated demos](#authenticated-demos)) |
| `auth.profiles` | `Record<string, string>` | — | Named profiles → relative storage state file paths |
| `auth.tokenGenerator` | `LifecycleStep` | — | Optional command run after `setup` and before `devServer` to refresh storage state |
| `poms` | `Record<string, string>` | — | Page Object Model registry. Keys are referenced from `pom` scenario steps (see [Page Object Models](#page-object-models)). Values are module paths relative to the project root. |
| `voiceover.enabled` | `boolean` | `false` | Synthesize per-step audio and mix it into the composited MP4 (see [Voice-over](#voice-over)). Implies `compositing: "remotion"`. |
| `voiceover.provider` | `"piper" \| "google" \| "openai" \| "say"` | — | Explicit provider. Defaults to the first available in detection order. |
| `voiceover.voice` | `string` | (per-provider) | Provider-specific voice name (e.g. `en-US-Neural2-F`, `alloy`, `Samantha`). |
| `voiceover.cacheDir` | `string` | `".pr-visual/tts"` | Audio cache directory (relative to project root). Content-hash keyed; re-runs with unchanged captions skip synthesis. |

### Minimal config examples

**Next.js** (zero-setup):
```typescript
export default { devServer: { command: "npm run dev" } };
```

**Vite + Docker Postgres**:
```typescript
export default {
  port: 5173,
  devServer: { command: "npx vite --port {{port}}" },
  setup: [
    { name: "DB", command: "docker compose up -d db", timeout: 30_000 },
    { name: "Migrate", command: "npx prisma migrate deploy" },
  ],
  teardown: [
    { name: "DB down", command: "docker compose down -v" },
  ],
  readiness: { path: "/api/health" },
};
```

**i18n site** (content at `/en`):
```typescript
export default {
  devServer: { command: "npx next dev --port {{port}}" },
  readiness: { path: "/en" },
  routes: [
    { path: "/en", label: "Homepage" },
    { path: "/en/about", label: "About" },
  ],
};
```

**Monorepo** (custom cwd):
```typescript
export default {
  devServer: { command: "turbo dev --filter=web", cwd: "apps/web" },
  setup: [
    { name: "Build packages", command: "turbo build --filter=web^..." },
  ],
};
```

## Quality presets

By default the desktop capture runs at 1440×900 @2x. You can bump this to a named preset to get higher-resolution video and screenshots. The preset sets the **logical viewport** (CSS pixels); final output dimensions are `viewport × deviceScaleFactor` (DSF stays at 2 by default).

| Preset | Viewport | Output (DSF=2) |
|--------|----------|----------------|
| `720p` | 1280×720 | 2560×1440 |
| `1080p` | 1920×1080 | 3840×2160 |
| `2k` | 2560×1440 | 5120×2880 |
| `4k` | 3840×2160 | 7680×4320 |

Mobile capture is not affected by quality presets.

**Project-wide default** in `.pr-visual.config.ts`:

```typescript
export default {
  devServer: { command: "npm run dev" },
  quality: "1080p",
} satisfies ProjectConfig;
```

**Per-scenario override** (AI-generated or hand-authored scenarios):

```ts
{
  name: "Checkout flow",
  description: "...",
  quality: "2k",       // preset wins over viewport
  steps: [ /* ... */ ],
}
```

**Explicit viewport override** (when a preset doesn't fit):

```ts
{
  name: "Tablet layout",
  description: "...",
  viewport: { width: 1024, height: 768, deviceScaleFactor: 2 },
  steps: [ /* ... */ ],
}
```

**One-off env override** — useful in CI or for spot checks:

```bash
PR_VISUAL_QUALITY=4k npx pr-visual
```

**Precedence** (highest wins):

1. `PR_VISUAL_QUALITY` env var
2. `scenario.quality`
3. `scenario.viewport`
4. `projectConfig.quality`
5. Built-in default (1440×900 @2x)

An unknown preset value (env, scenario, or project) fails hard with a clear error.

## Adaptive pacing

Each step holds on-screen long enough for viewers to read the caption and absorb the change, scaled by an explicit `pacing` hint. The hold is computed from the caption's reading time, the action type (first-navigation gets extra breathing room; `type` scales with value length), a transition cushion when the action changes, and the pacing mode.

**Modes** (multiplier / floor / cap in ms):

| Mode | Multiplier | Floor | Cap |
|------|-----------|-------|-----|
| `quick` | 0.6× | 900 | 4000 |
| `normal` *(default)* | 1.0× | 1700 | 8000 |
| `slow` | 1.5× | 2200 | 10000 |
| `dramatic` | 2.0× | 3200 | 12000 |

`dramatic` also inserts an 800ms pre-action settle before the step fires, to build anticipation.

**Per-step**:

```ts
{
  action: "click",
  selector: "#checkout",
  caption: "Confirm the order",
  pacing: "dramatic",   // the final beat — let it land
}
```

**Project-level reading speed** in `.pr-visual.config.ts`:

```typescript
export default {
  devServer: { command: "npm run dev" },
  pacing: { wordsPerSecond: 2.8 },   // slower — for non-native audiences
} satisfies ProjectConfig;
```

Captions of six words or fewer are read proportionally faster (+0.6 w/s) so short beats don't linger.

## Narrative beats

Scenarios can tag each step with a **beat** — `setup`, `action`, `payoff`, or `close` — to mark where the step sits in the story arc. The annotation layer picks these up:

- **Video**: a brief 700ms title-card chip fades in whenever the beat changes between two consecutive steps (so three distinct beats produce two chips).
- **Screenshots**: the sidebar shows the beat label under the viewport badge.

Beats also enforce a minimum hold in the [pacing formula](#adaptive-pacing) (`setup` 1200ms, `action` 1800ms, `payoff` 2800ms, `close` 2200ms), so a `payoff` step earns scene-length breathing room even under `quick` pacing.

### Emphasis

Each step can also carry `emphasis: "strong"` to render as a larger title-card caption (1.5× the base caption font, bolder weight). Use it on the key moments you want viewers to remember — usually a `payoff` beat.

```ts
{
  action: "screenshot",
  caption: "The deal is closed",
  beat: "payoff",
  emphasis: "strong",
  pacing: "dramatic",
}
```

### Persona

Scenarios can carry an audience label via `persona: "Agency PM"` (any free-form string). This is stored on the scenario for later use by the Remotion intro composer and the Story Director. It does not render directly in the current annotation layer.

```ts
{
  name: "New client onboarding",
  description: "...",
  persona: "Agency PM",
  steps: [ /* ... */ ],
}
```

Invalid beat, emphasis, or pacing values fail the run with a clear error before capture starts.

## Interaction overlays

By default, pr-visual captures clean recordings with no cursor or click indicators. If you want your videos to look human-driven, opt into one or more overlays in `.pr-visual.config.ts`:

```typescript
export default {
  devServer: { command: "npm run dev" },
  overlays: {
    cursor: true,      // visible custom cursor tracking the mouse
    clicks: true,      // ripple + center dot at each click
    highlights: true,  // enables the `highlight` scenario step
  },
} satisfies ProjectConfig;
```

Each flag is independent; all default to `false` so existing users see no change.

### `highlight` step

When `overlays.highlights: true`, scenarios can use a new step action that pulses a glow ring around a selector while dimming the rest of the viewport:

```ts
{
  action: "highlight",
  selector: "#primary-cta",
  duration: 1500,  // ms; defaults to 1500 when omitted
  caption: "The primary call to action",
  beat: "payoff",
}
```

The highlight runs for `duration` ms; the scenario's pacing hold starts after cleanup.

### Capture-time DOM injection

Overlays are injected into the page during capture (unlike the post-capture sidebar and ASS caption layers), so they appear in the recorded video at the right moment. The trade-off: an active cursor or highlight will be visible in screenshots taken right after a `navigate`. If you want clean screenshots alongside an overlay-rich video, leave `overlays.cursor` off.

Mobile viewports automatically use a touch-style cursor and tap-ring animations.

## Video production

By default the captioned MP4 is the final video artifact. Opt in to a polished
Remotion composition (animated intro, crossfades, glassmorphism caption pill,
outro with step summary) per scenario or project-wide:

```typescript
export default {
  devServer: { command: "npm run dev" },
  video: {
    compositing: "remotion",
    brandColor: "#3b82f6",
    category: "Checkout",
    sprintLabel: "Sprint 12",
    orgName: "Acme Co",
    highlights: ["Faster checkout", "Cleaner cart"],
  },
} satisfies ProjectConfig;
```

### Optional peer dependencies

The Remotion stack is intentionally **not** a baseline dependency — `npm i pr-visual`
stays small for users who only need captioned recordings. Install the peer deps
when you want compositing:

```bash
npm i -D remotion @remotion/bundler @remotion/renderer react react-dom
```

If `video.compositing: "remotion"` is set but the peer deps aren't installed,
pr-visual prints a clear warning and falls back to the captioned MP4. The run
still succeeds.

### What gets composited

- Compositing runs on the **desktop + light** variant only. Mobile composite
  layouts arrive in [#6](https://github.com/gerokeller/pr-visual/issues/6); the
  other three variants stay raw.
- Output is written next to the captioned MP4 as `<scenario>-composited.mp4`
  (H.264, CRF 16).
- When a composited video exists, the PR comment uses it for the
  desktop+light slot; other variants keep the captioned MP4.

### Adaptive intro/outro length

Intro and outro durations scale with the title + description word count and
the number of annotated steps (reading speed 3 w/s), clamped to sensible
bounds (intro 3-8s, outro 4-12s).

### Mobile composite layouts

Set `video.mobile.enabled: true` to run a dedicated mobile pass after the main
matrix and composite both streams into one MP4. Setting `mobile.enabled` also
implies `compositing: "remotion"` so a single flag covers the common case.

```typescript
export default {
  devServer: { command: "npm run dev" },
  video: {
    mobile: { enabled: true, layout: "side-by-side" },
  },
} satisfies ProjectConfig;
```

**Layouts**

- `side-by-side` (default): desktop 80% + phone 20% in a stylized device frame. The canvas widens by 25% to fit both columns at near-native size.
- `pip`: phone bottom-right over fullscreen desktop. Canvas dimensions unchanged.
- `sequential`: desktop for the first half of the recording, phone for the second. Canvas dimensions unchanged.

**Per-step mobile overrides**

Scenarios can tweak the mobile pass without forking the script:

```ts
{ action: "navigate", url: "/", mobilePath: "/m", caption: "Open" }
{ action: "click", selector: "#desktop-cta", mobileSelector: "#mobile-cta", caption: "Tap CTA" }
{ action: "highlight", selector: "#desktop-only", mobileSkip: true, caption: "Hover hint" }
```

- `mobilePath`: rewrites the navigate URL on mobile.
- `mobileSelector`: swaps the selector on mobile.
- `mobileSkip`: omits the step from the mobile pass entirely.

**Wall-clock cost**

The mobile pass is sequential (separate browser context, fresh navigation), so
runs with mobile compositing take **~1.8x** the wall-clock of desktop-only
runs. The pipeline prints a heads-up when mobile compositing fires.

If the mobile pass throws (selector missing, navigation fails), the
compositing step aborts and the captioned MP4 stays as the final artifact —
the run otherwise succeeds.

## Authenticated demos

pr-visual is framework-agnostic about auth: you supply Playwright **storage
state JSON files**, name them as profiles in `.pr-visual.config.ts`, and
scenarios opt in via `scenario.profile`. The captured matrix variants and the
mobile composite pass all load the same storage state.

```typescript
export default {
  devServer: { command: "npm run dev" },
  auth: {
    storageStateDir: ".pr-visual/auth",  // default
    profiles: {
      admin: "admin.json",
      viewer: "viewer.json",
    },
    // Optional — runs after `setup` and before `devServer`. Use it to
    // refresh storage state per run; pr-visual just calls the command.
    tokenGenerator: {
      name: "Refresh storage state",
      command: "node scripts/refresh-auth.mjs",
    },
  },
} satisfies ProjectConfig;
```

```ts
// In your scenario:
{
  name: "Admin dashboard tour",
  description: "...",
  profile: "admin",
  steps: [ /* ... */ ],
}
```

`npx pr-visual init` adds `.pr-visual/auth/` to `.gitignore` automatically —
storage state files contain session tokens.

### Generating storage state

How you produce the JSON files is up to you. Two common patterns:

**Pattern 1: Playwright login script**

Run a one-off Playwright script that drives the login UI and saves the
context state:

```ts
// scripts/refresh-auth.mjs
import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto("http://localhost:3000/login");
await page.getByLabel("Email").fill("admin@example.com");
await page.getByLabel("Password").fill(process.env.ADMIN_PASSWORD);
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL("**/dashboard");
await ctx.storageState({ path: ".pr-visual/auth/admin.json" });
await browser.close();
```

**Pattern 2: Supabase admin API (no browser needed)**

```ts
// scripts/refresh-auth.mjs
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const { data, error } = await supabase.auth.admin.generateLink({
  type: "magiclink",
  email: "admin@example.com",
});
if (error) throw error;
// Build a Playwright storage-state JSON with the supabase localStorage entry,
// keyed `sb-<project-ref>-auth-token`. Shape per Supabase JS docs.
const session = { access_token: data.properties.action_link, /* ... */ };
const projectRef = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
fs.writeFileSync(
  ".pr-visual/auth/admin.json",
  JSON.stringify({
    cookies: [],
    origins: [{
      origin: "http://localhost:3000",
      localStorage: [{
        name: `sb-${projectRef}-auth-token`,
        value: JSON.stringify({ currentSession: session }),
      }],
    }],
  }),
);
```

Anything that writes a Playwright storage-state JSON works. The
`tokenGenerator` step is templated with `{{runId}}`, `{{port}}`, `{{rootDir}}`
like other lifecycle steps.

### Validation

After the generator runs, pr-visual verifies every configured profile points
at a readable JSON file. A missing or malformed file fails the run before
capture starts, so a silently-broken generator surfaces immediately.

The `PR_VISUAL_AUTH_DIR` env var overrides `storageStateDir` — useful when
storage state is generated outside the repo.

## Page Object Models

Non-trivial real-world demos often need multi-step orchestration (dismiss a
modal, wait for data, assert an intermediate state). Rather than duplicating
that logic in every scenario, point pr-visual at your existing E2E Page
Object Model modules:

```typescript
// .pr-visual.config.ts
export default {
  devServer: { command: "npm run dev" },
  poms: {
    dashboard: "./e2e/pages/dashboard.ts",
    checkout: "./e2e/pages/checkout.ts",
  },
} satisfies ProjectConfig;
```

```ts
// ./e2e/pages/dashboard.ts — pr-visual expects plain functions.
// Each function receives the Playwright `Page` as the first argument
// plus any user arguments defined on the scenario step.
import type { Page } from "playwright";

export async function login(page: Page, email: string): Promise<void> {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(process.env.DEMO_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

export async function openInbox(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Inbox" }).click();
  await page.waitForSelector("[data-testid=inbox-list]");
}
```

Then use them in scenarios:

```ts
{
  name: "Inbox tour",
  description: "...",
  steps: [
    { action: "navigate", url: "/", caption: "Open the app" },
    {
      action: "pom",
      page: "dashboard",
      method: "login",
      args: ["demo@example.com"],
      caption: "Sign in",
    },
    {
      action: "pom",
      page: "dashboard",
      method: "openInbox",
      caption: "Open the inbox",
    },
    { action: "screenshot", caption: "Inbox view" },
  ],
}
```

### Contract

- Each registered module exports **named functions** shaped as
  `(page: Page, ...args: unknown[]) => void | Promise<void>`.
- Classes are not supported directly (predictable stateless lifecycle). Wrap
  them with a thin factory if you need class-based POMs.
- `args` on the scenario step is an array forwarded positionally after
  `page`. Omitted `args` means the function is called with just `(page)`.

### Validation

pr-visual loads POM modules eagerly at scenario-validation time, so unknown
`page` names, unknown method names, and import failures surface as
pre-capture errors instead of runtime crashes deep in the capture loop.

### Overlay interaction

- Custom cursor tracking (when `overlays.cursor: true`) works inside POM
  methods automatically — the mousemove listener follows any
  Playwright-driven movement.
- Click ripples and highlight spotlights do **not** fire inside POM methods.
  Those overlays are injected at the call site in pr-visual's step
  executor, not globally. If you want a ripple on a POM-internal click,
  add an explicit `click` step for that interaction instead.

## Voice-over

Step captions become narration in the composited MP4. Each caption is
synthesized to an MP3 and mixed into the Remotion composition, anchored to
the start of that step on the video timeline. Setting `voiceover.enabled:
true` also implies `compositing: "remotion"`.

```typescript
export default {
  devServer: { command: "npm run dev" },
  voiceover: {
    enabled: true,
    // Leave `provider` / `voice` out to auto-detect the first available.
  },
} satisfies ProjectConfig;
```

### Provider chain

Detection order (first available wins — the MP4 uses one provider throughout):

1. **Piper** — local neural TTS, offline, no account. Requires `piper` on
   `PATH` and a voice model. Point `PIPER_MODEL` at an `.onnx` file, or
   drop one into `~/.cache/piper/voices/`.
2. **Google Cloud TTS** — OAuth via `gcloud`. Requires `gcloud auth
   application-default login`. Default voice `en-US-Neural2-F`.
3. **OpenAI TTS** — `OPENAI_API_KEY` env var. Default voice `alloy`.
4. **macOS `say`** — always available on macOS. Default voice `Samantha`.

Override via `voiceover.provider`; that provider is then used regardless of
detection order. Per-clip synthesis failures log a warning and skip that
step — the rest of the MP4 still narrates.

If *no* provider is available, the run fails with an explicit error listing
the install options.

### Caching

Clips are cached at `.pr-visual/tts/step-NN-<hash>.mp3`, keyed by
`sha256(provider + caption text)`. Re-running a scenario with unchanged
captions is essentially free. Switching provider invalidates the cache for
that step (the hash changes).

`npx pr-visual init` adds `.pr-visual/tts/` to `.gitignore` automatically.

### ffmpeg

Piper and `say` emit WAV/AIFF and use `ffmpeg` / `ffprobe` to transcode to
MP3 and measure duration. pr-visual already expects ffmpeg for subtitle
burning, so there's no new prerequisite.

## Story Director

When `ANTHROPIC_API_KEY` (or `CLAUDE_PLUGIN_OPTION_ANTHROPIC_API_KEY`) is
set, AI scenario generation runs through the **Story Director** instead of
emitting flat step lists. The director picks one of four personas (`End
User`, `Admin`, `New User`, `Stakeholder`) based on the PR content and
drafts a three-act narrative arc:

```
Persona:   End User
Setup:     A user opens the dashboard expecting today's metrics.
Inciting:  They notice a new tile they have never seen before.
Payoff:    Clicking the tile reveals a clearer breakdown of the data.
Closing:   Users now answer the question without leaving the dashboard.
```

Each generated scenario carries the matching `persona` and every step
arrives pre-populated with the right `beat` (`setup` / `action` / `payoff`
/ `close`) and `emphasis`. The annotation layers from
[Narrative beats](#narrative-beats) and [Adaptive pacing](#adaptive-pacing)
then take over.

When no API key is set, the run falls back to the static-routes scenarios
(unchanged from before).

### Brief cache

The director caches each brief by `sha256(prDescription + diff)` to
`.pr-visual/story/<hash>.json`. Re-running on an unchanged PR is free.
`init` adds `.pr-visual/story/` to `.gitignore`.

### `story` subcommand

Inspect the brief without recording, or scaffold it to disk:

```bash
# Print the human-readable arc for the current branch's PR.
npx pr-visual story

# Same, against an explicit PR number.
npx pr-visual story --pr 42

# Machine-readable JSON to stdout.
npx pr-visual story --pr 42 --json

# Write the full {narrative, scenarios} brief to disk for editing.
# Output: .pr-visual/story-scaffold.json
npx pr-visual story --scaffold
```

The scaffold path is convenient for tweaking the arc by hand before
re-running `pr-visual` — load the JSON yourself and pass it as a
hand-authored scenario set.

## CLI commands

```bash
npx pr-visual [command]
```

| Command | Description |
|---------|-------------|
| `run` (default) | Execute the full capture pipeline |
| `init` | Detect project setup and generate `.pr-visual.config.ts` |
| `cleanup` | Remove orphaned worktrees, Docker projects, and stale directories |
| `story` | Print or scaffold the [Story Director's](#story-director) brief without recording. Flags: `--pr <n>`, `--scaffold`, `--json`. |

## Cleanup

If a run is interrupted (Ctrl+C, crash, killed terminal), resources may be left behind. The `cleanup` command finds and removes them:

```bash
npx pr-visual cleanup
```

This removes:
- Orphaned git worktrees (`pr-visual-*` branches and directories)
- Orphaned Docker Compose projects (containers, networks, volumes named `pr-visual-*`)
- Stale worktree parent directories

The recorder also registers signal handlers for SIGINT and SIGTERM, so a normal Ctrl+C during a run will attempt to tear down services and remove the worktree before exiting.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Enables AI-generated scenarios (falls back to static) |
| `PR_BODY` | — | Override PR body text for scenario generation |
| `PR_VISUAL_CONFIG` | — | Explicit path to config file |
| `PR_VISUAL_NO_ISOLATE` | — | Set to `1` to skip worktree isolation |
| `PR_VISUAL_QUALITY` | — | Desktop quality preset override: `720p`, `1080p`, `2k`, `4k`. Takes precedence over scenario and project config. |
| `PR_VISUAL_AUTH_DIR` | — | Override `auth.storageStateDir`. Useful when storage state is generated outside the repo. |

## How it works

### Pipeline

```
┌─────────────┐    ┌──────────┐    ┌───────────┐    ┌──────────────┐
│  Worktree   │───▶│  Setup   │───▶│ Dev Server │───▶│  Readiness   │
│  + install  │    │  steps   │    │  start     │    │  probe       │
└─────────────┘    └──────────┘    └───────────┘    └──────┬───────┘
                                                          │
┌─────────────┐    ┌──────────┐    ┌───────────┐    ┌─────▼────────┐
│  PR attach  │◀───│ Annotate │◀───│  Capture  │◀───│  Scenarios   │
│  + cleanup  │    │  + video │    │  all vars │    │  (AI / diff) │
└─────────────┘    └──────────┘    └───────────┘    └──────────────┘
```

### Isolation model

Each run creates a git worktree at the current commit:
- **Directory**: `../.pr-visual-worktrees/pr-visual-<timestamp>-<hex>` (outside repo)
- **Branch**: `pr-visual/pr-visual-<timestamp>-<hex>` (temporary)
- **Port**: auto-allocated from preferred port upward (scans 100 ports)
- **Docker**: `COMPOSE_PROJECT_NAME=pr-visual-<timestamp>-<hex>` namespaces all resources
- **Dependencies**: full install from lockfile in the worktree

Multiple parallel runs get different worktrees, ports, and Docker project names — complete isolation.

### Lifecycle

1. **Setup steps** — sequential shell commands with per-step timeouts
2. **Dev server** — spawned as a detached process group
3. **Readiness probe** — polls endpoint until expected status or timeout
4. **Teardown** — runs cleanup commands; errors are logged but don't abort

### Cleanup guarantees

- Signal handlers (SIGINT/SIGTERM) run teardown and worktree removal on interrupt
- Explicit cleanup in `finally` block for normal completion or exceptions
- `npx pr-visual cleanup` as a manual recovery for hard crashes

## Troubleshooting

### Skills not appearing after install

Run `/reload-plugins` to refresh the plugin list.

### ffmpeg captioning fails

The video captioning feature requires ffmpeg with either `libass` or `subtitles` filter support. If neither is available, the plugin gracefully skips captioning and returns the raw video.

To get full captioning support:
```bash
brew install ffmpeg
```

### Screenshots show wrong page (i18n sites)

If your site redirects `/` to a locale path (e.g. `/en`), configure the `routes` field in your `.pr-visual.config.ts`:

```typescript
export default {
  readiness: { path: "/en" },
  routes: [{ path: "/en", label: "Homepage" }],
};
```

### `next: command not found` in worktree

Use `npx` in your dev server command to resolve binaries from `node_modules`:

```typescript
export default {
  devServer: { command: "npx next dev --port {{port}}" },
};
```

## Project structure

```
.claude-plugin/
  plugin.json             # Plugin manifest
  marketplace.json        # Plugin marketplace definition
skills/pr-visual/
  SKILL.md                # Slash command definition
hooks/
  hooks.json              # PostToolUse hook for gh pr create
bin/
  pr-visual               # CLI entrypoint
scripts/pr-visual/
  index.ts                # CLI routing (run | init | cleanup)
  types.ts                # Shared types (ViewportConfig, ProjectConfig, RunContext, etc.)
  config.ts               # Config discovery, loading, template substitution
  worktree.ts             # Git worktree creation, port allocation, cleanup
  lifecycle.ts            # Setup/teardown steps, dev server, readiness, signal handlers
  init.ts                 # Project detection and config scaffolding
  cleanup.ts              # Orphaned resource discovery and removal
  scenario-generator.ts   # Claude API integration for scenario generation
  capture.ts              # Playwright capture across viewports and color schemes
  pr-attach.ts            # GitHub PR body patching and comment posting
  annotate/
    screenshots.ts        # sharp + SVG sidebar compositing → WebP
    video.ts              # ffmpeg ASS caption burning → H.264 MP4
```

## Development

```bash
npm ci                  # install deps + Playwright chromium
npm run typecheck       # tsc --noEmit
npm run lint            # Biome (lint + format check, fails on warnings)
npm run lint:fix        # Biome auto-fix (safe rules) + write
npm run format          # Biome format only — write
npm test                # vitest run (unit + integration + e2e)
```

CI runs `typecheck`, `lint`, and the full `test` suite on every PR and on push to `master` (Node 20). All warnings are treated as errors.

## Releases

Releases are created automatically by `.github/workflows/release.yml` on every push to `master`.

- **Patch bumps are automatic.** Merge a PR; the workflow reads the latest `v*` tag, increments the patch segment, tags the commit, and publishes a GitHub Release with auto-generated notes. No code change required.
- **Minor and major bumps are manual.** Before merging, bump `version` in `package.json` to the target `MAJOR.MINOR.0` (e.g., `1.1.3` → `1.2.0`). The workflow detects that `package.json` is ahead of the latest tag and uses that version instead of auto-incrementing. Optionally update `CHANGELOG.md` in the same PR.
- **Source of truth for the released version is the latest `v*` git tag**, not `package.json`. `package.json` only needs to move when you want a minor or major bump.
- Release notes come from GitHub's auto-generated changelog (merged PRs and commits since the previous tag). `CHANGELOG.md` is maintained by hand for the human-readable history; keep it in sync when you make a minor/major bump.

## License

MIT — see [LICENSE](LICENSE) for details.
