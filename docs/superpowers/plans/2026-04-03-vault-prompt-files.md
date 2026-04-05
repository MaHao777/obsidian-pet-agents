# Vault Prompt Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move pet system prompts into fixed Markdown files inside the Obsidian vault and load those files at runtime, including the new 机灵兔 tone rules.

**Architecture:** Add a focused prompt-store module that owns fixed prompt file paths, default file templates, vault bootstrapping, reload logic, and cached prompt lookup. Keep built-in prompt strings as fallbacks, but switch runtime prompt assembly to use vault-loaded prompt text. The settings tab only surfaces file paths plus open/reload controls.

**Tech Stack:** TypeScript, Obsidian plugin API, Node `assert`, esbuild

---

### Task 1: Add red tests for prompt store behavior

**Files:**
- Create: `D:\VS_project\OBS_PetAgents\scripts\prompt-store-check.mjs`
- Create: `D:\VS_project\OBS_PetAgents\src\prompt-store.ts`

- [ ] **Step 1: Write the failing test**

```js
const store = new PetPromptStore(fakeHost);
await store.initialize();
assert.equal(await adapter.exists("Pet Agents/Prompts/机灵兔.md"), true);
assert.match(store.getPrompt("homie-rabbit"), /默认只回 1 到 3 句/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/prompt-store-check.mjs`
Expected: FAIL because the prompt store module does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export class PetPromptStore {
  async initialize() { ... }
  getPrompt(petId) { ... }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/prompt-store-check.mjs`
Expected: PASS with `prompt-store-check: ok`

### Task 2: Integrate prompt store into plugin runtime

**Files:**
- Modify: `D:\VS_project\OBS_PetAgents\src\main.ts`
- Modify: `D:\VS_project\OBS_PetAgents\src\types.ts`
- Modify: `D:\VS_project\OBS_PetAgents\src\pets.ts`

- [ ] **Step 1: Instantiate and initialize the prompt store on plugin load**

```ts
this.promptStore = new PetPromptStore(this);
await this.promptStore.initialize();
```

- [ ] **Step 2: Use vault-loaded prompt text in chat prompt assembly**

```ts
const systemPrompt = this.promptStore.getPrompt(options.petId);
`角色设定：${systemPrompt}`
```

- [ ] **Step 3: Reload prompt cache on prompt-file vault changes**

```ts
if (this.promptStore.handlesPath(file.path)) {
  await this.promptStore.reloadAll();
}
```

### Task 3: Add settings affordances for prompt files

**Files:**
- Modify: `D:\VS_project\OBS_PetAgents\src\settings.ts`
- Modify: `D:\VS_project\OBS_PetAgents\src\main.ts`

- [ ] **Step 1: Add a `宠物提示词文件` section**

```ts
containerEl.createEl("h3", { text: "宠物提示词文件" });
```

- [ ] **Step 2: Show each fixed file path with an open button**

```ts
new Setting(containerEl)
  .setName("机灵兔提示词")
  .setDesc("Pet Agents/Prompts/机灵兔.md")
  .addButton((button) => button.setButtonText("打开").onClick(...));
```

- [ ] **Step 3: Add a reload button**

```ts
new Setting(containerEl)
  .setName("重新加载提示词")
  .addButton((button) => button.setButtonText("重新加载").onClick(...));
```

### Task 4: Verify, build, deploy, and refresh Obsidian

**Files:**
- Modify: `D:\VS_project\OBS_PetAgents\main.js`
- Modify: `D:\VS_project\OBS_PetAgents\styles.css`
- Modify: `D:\VS_project\OBS_PetAgents\manifest.json`
- Modify: `D:\VS_project\OBS_PetAgents\versions.json`

- [ ] **Step 1: Run regression checks**

Run: `node scripts/prompt-store-check.mjs`
Expected: PASS

Run: `npm run check`
Expected: PASS

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Deploy plugin artifacts**

Run:
`Copy-Item -LiteralPath 'D:\VS_project\OBS_PetAgents\manifest.json' -Destination 'D:\ObsidianData\Note\.obsidian\plugins\obs-pet-agents\manifest.json' -Force`

Run:
`Copy-Item -LiteralPath 'D:\VS_project\OBS_PetAgents\main.js' -Destination 'D:\ObsidianData\Note\.obsidian\plugins\obs-pet-agents\main.js' -Force`

Run:
`Copy-Item -LiteralPath 'D:\VS_project\OBS_PetAgents\styles.css' -Destination 'D:\ObsidianData\Note\.obsidian\plugins\obs-pet-agents\styles.css' -Force`

Run:
`Copy-Item -LiteralPath 'D:\VS_project\OBS_PetAgents\versions.json' -Destination 'D:\ObsidianData\Note\.obsidian\plugins\obs-pet-agents\versions.json' -Force`

- [ ] **Step 4: Refresh Obsidian and verify state**

Run: `obsidian reload vault=Note`
Expected: vault reload succeeds

Run: `obsidian plugin:reload id=obs-pet-agents vault=Note`
Expected: plugin reload succeeds

Run: `obsidian plugin id=obs-pet-agents vault=Note`
Expected: `enabled=true`
