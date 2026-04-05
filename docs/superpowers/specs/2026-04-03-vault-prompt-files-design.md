# OBS Pet Agents Vault Prompt Files Design

**Date:** 2026-04-03

**Goal**

Move the three pet system prompts out of hardcoded source and into visible, editable Markdown files inside the Obsidian vault, then load those files at runtime as the pet role prompts.

**Why This Approach**

The user wants prompt text to be visible and editable in Obsidian, not buried in TypeScript or stuffed into long plugin setting textareas. Fixed vault Markdown files are the most robust option for this plugin:

- easy to inspect and edit in Obsidian
- easy to back up and version with the vault
- no large-text editing inside settings UI
- avoids path-entry errors from freeform configuration

**Chosen Storage Model**

- Fixed directory: `Pet Agents/Prompts/`
- Fixed files:
  - `Pet Agents/Prompts/工程鼠.md`
  - `Pet Agents/Prompts/博士熊.md`
  - `Pet Agents/Prompts/机灵兔.md`
- Plugin startup ensures these files exist, creating defaults when missing.
- Runtime prompt loading reads from these files every startup and on relevant vault file changes.
- If a file is blank or unreadable, the plugin falls back to the built-in default prompt content for that pet.

**Machine Behavior**

- Current `systemPrompt` strings in source remain as fallback defaults.
- A new prompt-store module owns:
  - fixed prompt paths
  - default Markdown content generation
  - file existence bootstrapping
  - prompt cache reloads
  - path matching for vault change events
- Chat prompt construction uses the vault-loaded prompt text instead of the hardcoded `profile.systemPrompt`.

**Settings UX**

Settings should add a `宠物提示词文件` section that:

- shows the three fixed file paths
- provides an `打开` button for each pet prompt file
- provides a `重新加载提示词` button

This keeps settings lightweight while still giving the user a direct entry point to the editable files.

**Rabbit Prompt Change**

The default `机灵兔` prompt file must include the new calibration rules from the user request. The important defaults are:

- 默认只回 1 到 3 句
- 先接情绪，再说一句判断，不主动上建议
- 用户没继续展开，就别分析太多
- 少复读，少总结，少“我会陪你怎么样”

This should be written directly into the default Markdown template for the rabbit prompt file.

**Non-Goals**

- No custom per-user arbitrary prompt file path configuration in this iteration
- No prompt editing directly inside plugin settings
- No change to model/reasoning settings behavior

**Testing**

- Add a prompt-store regression script with a fake vault adapter to verify:
  - default files are created
  - rabbit default content includes the new rules
  - existing edited content is preserved and read back
  - path matching and blank-file fallback work
- Run `npm run check`
- Run `npm run build`
- Deploy plugin artifacts and refresh Obsidian per `AGENTS.md`
