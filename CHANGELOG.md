# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
