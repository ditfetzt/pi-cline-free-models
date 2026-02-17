# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [v0.2.2] - 2026-02-17

### Fixed
- Aligned Cline identity/auth headers with current VS Code extension behavior (`X-Platform`, `X-Client-Type`, version headers).
- Improved OAuth code exchange robustness by handling missing provider hints and trying common provider values.
- Fixed recurring `403 access forbidden` by shaping Cline provider user context into the envelope expected by `api.cline.bot` (`<task>`, task_progress block, and environment_details block).
- Rotated `X-Task-ID` more reliably by re-registering provider before agent start.

### Changed
- Added optional `PI_CLINE_API_BASE` environment override for controlled API/proxy debugging.
- Added optional scaffold loading from local debug capture directories for Cline context-shaping parity.

### Documentation
- Added update guidance and `403` troubleshooting steps to README.
- Updated remote/SSH auth instructions to prefer pasting full callback URL (including provider hint).

## [v0.2.1] - 2026-02-08

### Documentation
- Added remote/SSH authentication instructions to README.md.

## [v0.2.0] - 2026-02-08

### Changed
- Completely removed fallback model logic - now only uses dynamically fetched models from Cline's GitHub source.
- Changed model source from `cli/src/constants/featured-models.ts` to `webview-ui/src/components/settings/OpenRouterModelPicker.tsx` for more accurate free model list (includes `stealth/giga-potato`).
- Removed all hardcoded model-specific logic (no more special handling for "kimi", "minimax", "potato").
- Cache now stores full model objects instead of just IDs to avoid reconstruction with hardcoded assumptions.
- Removed all debug console logging for cleaner output.

### Fixed
- Fixed regex to properly parse TypeScript array syntax (no semicolon after closing bracket).
- Models are now immediately available via `/scoped-models` and `/model` commands on startup when cached.

## [v0.1.7] - 2026-02-07
### Fixed
- Fixed compatibility with Pi v0.52.7+ standards.
- Made model fetching non-blocking to prevent UI/Slash command freezes on startup.
- Added background model updates after session start.
- Ensured all models have strictly valid metadata (cost, input, contextWindow) for latest Pi versions.
- Added fetch timeouts and defensive error handling during provider registration.

## [0.1.6] - 2026-02-06

### Documentation
- Refined development instructions for clarity.

## [0.1.5] - 2026-02-06

### Documentation
- Fixed broken banner image on npm by using an absolute GitHub raw URL.

## [0.1.4] - 2026-02-06

### Documentation
- Updated README text to clarify model availability and authentication flow.

## [0.1.3] - 2026-02-06

### Documentation
- Redesigned README.md with centered banner and badges to match ecosystem standards.

## [0.1.2] - 2026-02-06

### CI/CD
- Added automated npm publishing workflow.

## [0.1.1] - 2026-02-06

### Documentation
- Improved usage instructions, authentication flow, and troubleshooting.

## [0.1.0] - 2026-02-06

### Added
- Initial release of the Cline extension.
- OAuth support for Cline.
- Dynamic model discovery.
