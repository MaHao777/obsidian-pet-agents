# Pet Avatar And Model Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three pet avatars and visible names, then add per-pet model and reasoning-effort settings that are visible in settings and chat UI.

**Architecture:** Keep the existing internal pet ids and thread storage stable. Add a focused runtime-settings layer that owns per-pet defaults, label formatting, and normalization, then feed those values into provider request construction and UI rendering. Use bundled local PNG files for message avatars while preserving the existing full-sprite animation path.

**Tech Stack:** TypeScript, Obsidian plugin API, Codex CLI, esbuild, Node `assert`

---

### Task 1: Add red tests for runtime defaults and labels

**Files:**
- Create: `D:\VS_project\OBS_PetAgents\scripts\pet-runtime-check.mjs`
- Modify: `D:\VS_project\OBS_PetAgents\src\pets.ts`
- Modify: `D:\VS_project\OBS_PetAgents\src\types.ts`

- [ ] **Step 1: Write the failing test**

```js
assert.equal(module.getPetProfile("engineer-mole").name, "工程鼠");
assert.equal(module.getPetProfile("scholar-panda").name, "博士熊");
assert.equal(module.getPetProfile("homie-rabbit").name, "机灵兔");
assert.equal(module.getPetRuntimeSettings("engineer-mole", defaults).reasoningEffort, "high");
assert.equal(module.getPetRuntimeSettings("scholar-panda", defaults).reasoningEffort, "xhigh");
assert.equal(module.getPetRuntimeSettings("homie-rabbit", defaults).reasoningEffort, "medium");
assert.equal(module.reasoningEffortLabel("xhigh"), "超高");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/pet-runtime-check.mjs`
Expected: FAIL because the helper exports or new values do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function getPetRuntimeSettings(...) { ... }
export function reasoningEffortLabel(...) { ... }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/pet-runtime-check.mjs`
Expected: PASS with `pet-runtime-check: ok`

### Task 2: Extend provider args for per-turn model and reasoning

**Files:**
- Create: `D:\VS_project\OBS_PetAgents\scripts\provider-pet-runtime-check.mjs`
- Modify: `D:\VS_project\OBS_PetAgents\src\provider.ts`
- Modify: `D:\VS_project\OBS_PetAgents\src\types.ts`

- [ ] **Step 1: Write the failing test**

```js
const args = module.buildCodexTurnArgs(options, {
  ...baseRequest,
  model: "gpt-5.4",
  reasoningEffort: "high",
});
assert.ok(args.includes("--model"));
assert.ok(args.includes("gpt-5.4"));
assert.ok(args.includes("-c"));
assert.ok(args.includes('reasoning_effort="high"'));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/provider-pet-runtime-check.mjs`
Expected: FAIL because request-level runtime overrides are not wired into the argument builder.

- [ ] **Step 3: Write minimal implementation**

```ts
if (request.model?.trim()) args.push("--model", request.model.trim());
if (request.reasoningEffort) args.push("-c", `reasoning_effort="${request.reasoningEffort}"`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/provider-pet-runtime-check.mjs`
Expected: PASS with `provider-pet-runtime-check: ok`

### Task 3: Wire pet runtime settings into plugin state and settings UI

**Files:**
- Modify: `D:\VS_project\OBS_PetAgents\src\types.ts`
- Modify: `D:\VS_project\OBS_PetAgents\src\settings.ts`
- Modify: `D:\VS_project\OBS_PetAgents\src\main.ts`

- [ ] **Step 1: Add persisted settings shape**

```ts
petRuntimeSettings: {
  "engineer-mole": { model: "gpt-5.4", reasoningEffort: "high" },
  "scholar-panda": { model: "gpt-5.4", reasoningEffort: "xhigh" },
  "homie-rabbit": { model: "gpt-5.4", reasoningEffort: "medium" },
}
```

- [ ] **Step 2: Add settings controls for each pet**

```ts
new Setting(containerEl).setName("工程鼠模型").addText(...)
new Setting(containerEl).setName("工程鼠思考强度").addDropdown(...)
```

- [ ] **Step 3: Resolve active pet runtime settings in `main.ts`**

```ts
const runtimeSettings = getPetRuntimeSettings(options.petId, this.settings.petRuntimeSettings);
```

- [ ] **Step 4: Pass them into provider requests**

```ts
model: runtimeSettings.model,
reasoningEffort: runtimeSettings.reasoningEffort,
```

### Task 4: Update chat and status UI

**Files:**
- Modify: `D:\VS_project\OBS_PetAgents\src\view.ts`
- Modify: `D:\VS_project\OBS_PetAgents\styles.css`

- [ ] **Step 1: Add helper-backed labels in the status detail**

```ts
detailCopy.createDiv({ text: `模型：${runtimeSettings.model}` });
detailCopy.createDiv({ text: `思考强度：${reasoningEffortLabel(runtimeSettings.reasoningEffort)}` });
```

- [ ] **Step 2: Add message-header tags**

```ts
title.createSpan({ cls: "pet-agents-inline-tag", text: runtimeSettings.model });
title.createSpan({ cls: "pet-agents-inline-tag", text: reasoningEffortLabel(runtimeSettings.reasoningEffort) });
```

- [ ] **Step 3: Add any CSS needed for tag spacing/wrapping**

```css
.pet-agents-message-title {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
```

### Task 5: Swap visible names and bundle local PNG avatars

**Files:**
- Create: `D:\VS_project\OBS_PetAgents\src\assets.d.ts`
- Modify: `D:\VS_project\OBS_PetAgents\esbuild.config.mjs`
- Modify: `D:\VS_project\OBS_PetAgents\src\pets.ts`

- [ ] **Step 1: Import the provided PNGs into the bundle**

```ts
import rabbitAvatar from "../assets/ji-ling-tu.png";
```

- [ ] **Step 2: Update display names, aliases, and avatar mapping**

```ts
name: "工程鼠"
name: "博士熊"
name: "机灵兔"
```

- [ ] **Step 3: Keep task-mode gate on `engineer-mole` but update display text everywhere user-facing**

```ts
new Notice("只有工程鼠可以进入任务模式。");
```

### Task 6: Verify, build, deploy, and refresh Obsidian

**Files:**
- Modify: `D:\VS_project\OBS_PetAgents\main.js`
- Modify: `D:\VS_project\OBS_PetAgents\styles.css`
- Modify: `D:\VS_project\OBS_PetAgents\manifest.json`
- Modify: `D:\VS_project\OBS_PetAgents\versions.json`

- [ ] **Step 1: Run regression scripts**

Run: `node scripts/pet-runtime-check.mjs`
Expected: PASS

Run: `node scripts/provider-pet-runtime-check.mjs`
Expected: PASS

- [ ] **Step 2: Run project build**

Run: `npm run build`
Expected: esbuild completes with exit code 0

- [ ] **Step 3: Deploy build artifacts**

Run:
`Copy-Item -LiteralPath 'D:\VS_project\OBS_PetAgents\manifest.json' -Destination 'D:\ObsidianData\Note\.obsidian\plugins\obs-pet-agents\manifest.json' -Force`

Run:
`Copy-Item -LiteralPath 'D:\VS_project\OBS_PetAgents\main.js' -Destination 'D:\ObsidianData\Note\.obsidian\plugins\obs-pet-agents\main.js' -Force`

Run:
`Copy-Item -LiteralPath 'D:\VS_project\OBS_PetAgents\styles.css' -Destination 'D:\ObsidianData\Note\.obsidian\plugins\obs-pet-agents\styles.css' -Force`

Run:
`Copy-Item -LiteralPath 'D:\VS_project\OBS_PetAgents\versions.json' -Destination 'D:\ObsidianData\Note\.obsidian\plugins\obs-pet-agents\versions.json' -Force`

- [ ] **Step 4: Refresh Obsidian**

Run: `obsidian reload vault=Note`
Expected: vault reload succeeds

Run: `obsidian plugin:enable id=obs-pet-agents filter=community vault=Note`
Expected: plugin is enabled if it was disabled

Run: `obsidian plugin:reload id=obs-pet-agents vault=Note`
Expected: plugin reload succeeds

- [ ] **Step 5: Verify final plugin state**

Run: `obsidian plugin id=obs-pet-agents vault=Note`
Expected: `enabled=true`

Run: `obsidian plugins:enabled filter=community format=json vault=Note`
Expected: returned JSON includes `obs-pet-agents`
