# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-12

### Added

- AI-generated Playwright scenarios from PR descriptions and git diffs (Claude API)
- Multi-viewport screenshot capture: desktop 1440x900 @2x, mobile 390x844 @3x
- Light and dark color scheme capture for all viewports
- SVG sidebar annotation with viewport badge, accent bar, and caption text
- Walkthrough video recording with ASS subtitle burning (ffmpeg)
- Git worktree isolation for parallel runs without collisions
- Auto-allocated ports with collision avoidance (scans 100 ports)
- Docker resource scoping via `COMPOSE_PROJECT_NAME={{runId}}`
- Template variables (`{{port}}`, `{{runId}}`, `{{rootDir}}`) in all config values
- Project config (`.pr-visual.config.ts`) with lifecycle steps: setup, dev server, readiness, teardown
- `init` command for auto-detecting project setup and scaffolding config
- `cleanup` command for removing orphaned worktrees and Docker resources
- Signal handlers (SIGINT/SIGTERM) for guaranteed cleanup on interrupts
- Idempotent PR body patching via HTML comment markers
- PostToolUse hook that reminds you to run `/pr-visual` after `gh pr create`
- Plugin marketplace for Claude Code distribution
- Route-aware static scenario fallback using config `routes` or `readiness.path`
- ffmpeg filter fallback chain (`ass` → `subtitles` → graceful skip)
