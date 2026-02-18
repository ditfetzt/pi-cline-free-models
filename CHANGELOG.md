# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [v0.3.0] - 2026-02-18

### Fixed
- **Fixed model amnesia / infinite inspection loops**: Assistant reasoning text from tool-call turns was being completely stripped from the collapsed Cline transcript, causing the model to lose all memory of its prior decisions and restart from scratch every turn. Now the assistant's reasoning text (e.g. "I'll create tsconfig.json next") is preserved in the transcript as `[assistant]` blocks while still stripping raw tool-call metadata for Anthropic compatibility.
- Restored OAuth callback server cleanup helper to correctly close and null the active server instance (prevents auth port leaks and follow-up login issues).
- Added de-duplication for repeated identical non-empty tool results in collapsed Cline transcripts, with a guidance system note to avoid read/review loops.
- Added task-scope anchoring from the latest explicit `<skill ...>` request and avoided wrapped-history reuse on fresh session/model switches to prevent cross-task drift.
- Normalized inspection-command family keys for `ls`, `cat`, and `git` variants so flag/argument variations (e.g. `ls` vs `ls -la` vs `ls -la && cat file`) collapse into the same loop-detection family, preventing the model from evading per-family thresholds.
- Added `cat` and `tree` to the set of recognized inspection commands for loop detection.
- Added a global inspection-loop counter (`totalInspectionCallsSinceMutation`) that tracks ALL inspection calls since the last edit/write, with a threshold of 8. This catches loops where the model varies commands across different families to stay under the per-family limit of 4.
- Compound bash commands (using `&&`, `||`, `;`) are now classified by their leading segment for family normalization, preventing `ls -la && cat package.json` from being treated as a separate family from `ls -la`.
- Added inspection-loop suppression for repeated read-only command families (for example repeated `git diff`/`read` cycles), with loop-state reconstruction from prior collapsed transcript so detection persists across turns.
- Refined loop detection to treat distinct command arguments as separate families (preventing false positives when inspecting multiple files with `git diff` or `ls`).
- Added loop-counter reset on `edit` or `write` operations to allow re-inspection of modified state without suppression.
- Strengthened loop suppression by replacing repeated tool outputs with explicit "Loop detected" error messages in the transcript, forcing the model to acknowledge the failure and change strategy.
- Fixed race condition in task-scope anchoring by replacing module-level state with session-specific context flags.
- Fixed potential logic error where stale inspection counts could trigger incorrect suppression after a mutating operation.
- Removed misleading "Plan Mode" vs "Act Mode" toggle instructions from the fallback environment details, as Pi operates in a single execution mode.
- Improved loop feedback messages to distinguish between `read` and `bash` operations, providing clearer guidance on how to resolve the loop.
- Relaxed inspection-loop threshold from 2 to 4 to allow reasonable command retries (like `pnpm create` failures) before triggering suppression.
- Corrected the detection of `task_progress` blocks in message history to handle the removal of "Plan Mode" text from the template.
- Implemented robust `extractTaskBodyFromWrappedContent` logic using index finding instead of regex to prevent history truncation on nested XML-like tags.
- Improved `sessionId` safety by adding optional chaining accessors to `ctx` object to prevent potential crashes on older runtimes.

## [v0.2.3] - 2026-02-18

### Fixed
- Sanitized Cline request message content before sending to `/chat/completions` to prevent empty content blocks that can cause `400` errors on Anthropic-backed models (e.g. Claude Sonnet 4.6).
- Normalized Cline message history to text-first blocks for Anthropic compatibility (dropping non-text assistant/tool-call parts and injecting fallback text when needed) to avoid `messages.N content is empty` failures.
- Hardened Cline context hook activation by inferring active provider from session `model_change` entries when `ctx.model` is unavailable.
- Coerced unknown message content shapes to safe fallback text to prevent downstream empty-content serialization.
- Collapsed per-turn Cline context into `system + wrapped user transcript` to avoid Anthropic tool-protocol/empty-content failures on follow-up turns.
- Made Cline transcript collapsing idempotent by reusing existing `<task>` content and appending only new turns, preventing recursive self-review loops on follow-up tool calls.
- Preserved tool-call intent in collapsed transcripts by attaching concise tool command summaries (e.g. bash command/path) to `<tool_result>` blocks.
- Reduced assistant self-repetition by excluding assistant orchestration-only tool-call turns from collapsed history while keeping actual tool outputs.
- De-duplicated repeated identical no-output tool results and injected a system note when the same command returns no output multiple times (including guidance for common `git diff main...origin/main` misuse).

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
