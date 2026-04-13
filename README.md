# pr-visual

A Claude Code plugin that captures visual PR documentation: AI-generated Playwright scenarios from the PR description or git diff, annotated screenshots (desktop 2x + mobile 3x, light + dark), and walkthrough videos with burned-in captions.

Each run is isolated in a **git worktree** with its own port and **namespaced resources** (Docker containers, networks, volumes), so multiple runs can execute in parallel without collisions.

## Prerequisites

- Node.js 18+
- [ffmpeg](https://ffmpeg.org/) — `brew install ffmpeg` (optional — needed for video captions)
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

## CLI commands

```bash
npx pr-visual [command]
```

| Command | Description |
|---------|-------------|
| `run` (default) | Execute the full capture pipeline |
| `init` | Detect project setup and generate `.pr-visual.config.ts` |
| `cleanup` | Remove orphaned worktrees, Docker projects, and stale directories |

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

## License

MIT — see [LICENSE](LICENSE) for details.
