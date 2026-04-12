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
