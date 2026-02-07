# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
