Capture visual PR documentation for the current pull request.

This generates AI-driven Playwright scenarios from the PR description or git diff, then captures annotated screenshots (desktop 2x + mobile 3x, light + dark) and walkthrough videos with burned-in captions.

Each run is isolated in a git worktree with its own port and namespaced resources (Docker containers, databases, volumes), so multiple runs can execute in parallel without collisions.

## Quick start

Scaffold a config file for a new project:

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/pr-visual/index.ts init
```

This detects the framework, package manager, Docker services, and ORM, then generates a tailored `.pr-visual.config.ts`.

## Run

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/pr-visual/index.ts
```

## Cleanup orphaned resources

```bash
npx tsx ${CLAUDE_PLUGIN_ROOT}/scripts/pr-visual/index.ts cleanup
```

Finds and removes orphaned worktrees, Docker projects, and stale directories from interrupted or crashed runs.

## Project config

Consuming repos define a `.pr-visual.config.ts` at their project root:

```typescript
import type { ProjectConfig } from "pr-visual/scripts/pr-visual/types.js";

export default {
  port: 3000,
  devServer: { command: "npm run dev" },
  setup: [
    // COMPOSE_PROJECT_NAME is auto-set to {{runId}} — each run's
    // containers, networks, and volumes are fully isolated
    { name: "Start database", command: "docker compose up -d postgres redis" },
    { name: "Run migrations", command: "npx prisma migrate deploy" },
    { name: "Seed data", command: "npx prisma db seed" },
  ],
  readiness: { path: "/api/health", timeout: 60_000 },
  teardown: [
    // Only this run's containers are torn down
    { name: "Stop database", command: "docker compose down -v" },
  ],
} satisfies ProjectConfig;
```

### Template variables

All `command` and `env` values support these placeholders:

| Variable | Description |
|----------|-------------|
| `{{port}}` | Auto-allocated TCP port for this run |
| `{{runId}}` | Unique identifier — safe for Docker project names, DB suffixes, etc. |
| `{{rootDir}}` | Absolute path to the working directory (worktree or project root) |

### Automatic resource isolation

These environment variables are injected into every lifecycle step and the dev server — you don't need to set them manually:

| Variable | Value |
|----------|-------|
| `COMPOSE_PROJECT_NAME` | `{{runId}}` — scopes all Docker Compose resources |
| `PORT` | Allocated port |
| `PR_VISUAL_RUN_ID` | Same as `{{runId}}` |
| `PR_VISUAL_PORT` | Same as `{{port}}` |
| `PR_VISUAL_ROOT_DIR` | Same as `{{rootDir}}` |

## Environment variables

- `ANTHROPIC_API_KEY` — Required for AI-generated scenarios (falls back to static routes)
- `PR_BODY` — Override PR body text for scenario generation
- `PR_VISUAL_CONFIG` — Explicit path to config file (overrides auto-discovery)
- `PR_VISUAL_NO_ISOLATE=1` — Skip worktree isolation, run in-place

## What it does

1. **Creates a worktree** — Checks out the current commit into an isolated git worktree with its own port
2. **Runs setup** — Executes setup steps with `COMPOSE_PROJECT_NAME` scoped to this run
3. **Starts dev server** — Launches the application and waits for the readiness probe
4. **Generates scenarios** — Calls Claude API with the PR description or git diff
5. **Captures** — Runs scenarios across desktop (1440x900 @2x) and mobile (390x844 @3x) in light and dark mode
6. **Annotates screenshots** — Composites a DPR-scaled SVG sidebar, outputs WebP at quality 90
7. **Burns video captions** — ASS subtitles with dual-track overlays burned into H.264 video
8. **Attaches to PR** — Patches the PR body with screenshots (idempotent) and adds video comments
9. **Cleans up** — Tears down services and Docker resources, removes the worktree
10. **Signal safety** — SIGINT/SIGTERM handlers ensure teardown runs even on Ctrl+C
