# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.4] - 2026-04-13

### Changed

- Release workflow is now gated on `CI` via `workflow_run`; a red CI run on `master` blocks the release instead of racing it
- Releases are now cut **only when `package.json` `version` is manually bumped above the latest `v*` tag**. Merging without a version bump produces no release. The workflow never writes to the repository. This replaces the short-lived auto-patch-bump behaviour introduced in 1.1.3
- Release workflow gains `workflow_dispatch` for manual re-runs when CI succeeded but the release did not fire

### Added

- `CLAUDE.md` at the repo root: rules for AI agents working on the codebase (release checklist, manifest-version expectations, commit-message rules)
- `Releases` section in `README.md`

### Fixed

- Document the GitHub Actions skip-ci footgun: any `[skip ci]`-style token in a commit message (subject **or** body) silently skips push-triggered workflows. Agents must paraphrase when referencing these tokens

## [1.1.3] - 2026-04-13

### Added

- Initial auto-release workflow on push to `master` (superseded in 1.1.4 by the CI-gated, manual-bump flow)

## [1.1.2] - 2026-04-13

### Fixed

- Remove `hooks` field from `plugin.json`; the default `hooks/hooks.json` is auto-loaded, so declaring it caused a duplicate-hooks load error reported by `/doctor`

### Changed

- CI runs inside `mcr.microsoft.com/playwright:v1.59.1-jammy` instead of installing Chromium + system fonts on every job, cutting roughly 4 minutes off typical runs

## [1.1.1] - 2026-04-13

### Fixed

- Conform `.claude-plugin/marketplace.json` to the Claude Code marketplace schema so `/plugin marketplace add gerokeller/pr-visual` succeeds (#25)
- Add required `type` and `title` fields to `userConfig.anthropic_api_key` in `plugin.json` so `/plugin install` passes manifest validation

## [1.1.0] - 2026-04-13

### Added

- Story Director: narrative-driven scenario planning with per-beat personas (#8)
- Voice-over TTS pipeline with caption-synced audio tracks (#9)
- POM step action for reusable page-object interactions in scenarios (#11)
- Scenario profiles and Playwright storage state loader for authenticated flows (#10)
- Narrative beats and personas in scenario generation (#7)
- Mobile composite video layouts (#6)
- Remotion-based video compositing pipeline (#2)
- Interaction overlays drawn on captured steps (#3)
- Adaptive pacing for capture timing (#4)
- Quality presets for capture resolution and encoding (#5)
- Biome lint/format and GitHub Actions CI workflow
- Dependabot configuration for security and version updates

### Fixed

- Hardened `git worktree` invocations against shell-interpretation of paths (#22)
- Explicit read-only `GITHUB_TOKEN` permissions on CI workflow (#22)
- Voice-over cache-hit test made resilient; ffmpeg installed explicitly in CI

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
