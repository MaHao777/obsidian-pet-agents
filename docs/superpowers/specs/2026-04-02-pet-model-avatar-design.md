# OBS Pet Agents Pet Avatar And Model Settings Design

**Date:** 2026-04-02

**Goal**

Replace the three built-in pet avatars and display names with the new animal set, and add per-pet model and reasoning-effort settings that are visible in plugin settings and in the chat UI.

**Scope**

- Keep internal pet ids unchanged to preserve saved threads, command handlers, memory bias rules, and task-mode logic.
- Change visible pet names to `工程鼠`, `博士熊`, and `机灵兔`.
- Replace generated head avatars with the provided PNG assets.
- Add per-pet settings for model and reasoning effort.
- Default all pet models to `gpt-5.4`.
- Default reasoning effort to `高` for `工程鼠`, `超高` for `博士熊`, and `中等` for `机灵兔`.
- Show model and reasoning effort in both:
  - expanded status-card pet detail
  - each assistant message header

**Architecture**

The change should introduce a small pet-runtime configuration layer instead of scattering model/reasoning defaults across `main.ts`, `settings.ts`, and `view.ts`. That layer will own default per-pet runtime settings, normalization, and label formatting. The provider will accept request-level model and reasoning settings so each pet turn can override the old global-only model behavior.

Avatar loading should move from generated SVG heads to static local PNG files bundled with the plugin. Full animated sprites can remain code-generated for the status panel so the plugin keeps its existing motion behavior, while message avatars use the provided PNGs.

**Files Affected**

- `src/types.ts`
  Add per-pet runtime setting types and provider request fields.
- `src/pets.ts`
  Update visible names, aliases, and avatar sources; add runtime-setting helpers.
- `src/main.ts`
  Resolve the active pet runtime settings per turn and pass them to the provider.
- `src/provider.ts`
  Add request-level model/reasoning overrides to Codex CLI args.
- `src/settings.ts`
  Add settings UI for each pet's model and reasoning effort.
- `src/view.ts`
  Render model/reasoning labels in the status panel and assistant message headers.
- `scripts/*.mjs`
  Add lightweight regression scripts for the new pure helper behavior.

**UI Rules**

- Settings must expose editable model and reasoning controls for each pet.
- Chat UI must show the active values, not just defaults.
- Reasoning effort labels shown to users should be Chinese:
  - `low -> 低`
  - `medium -> 中等`
  - `high -> 高`
  - `xhigh -> 超高`

**Non-Goals**

- No internal pet id migration.
- No redesign of task mode beyond renamed display text.
- No replacement of the full animated pixel sprites unless needed for correctness.

**Testing**

- Add script-level regression coverage for per-pet runtime defaults and labels.
- Add script-level regression coverage for provider argument construction with per-request overrides.
- Run `npm run build` after code changes.
- Deploy built artifacts to the target Obsidian plugin directory and refresh the vault/plugin through the documented CLI sequence.
