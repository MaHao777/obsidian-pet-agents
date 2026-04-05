import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = mkdtempSync(join(tmpdir(), "obs-pet-prompt-store-"));
const outfile = join(tempDir, "prompt-store-test.mjs");

class FakeVault {
  constructor(initialFiles = {}) {
    this.files = new Map(Object.entries(initialFiles));
    this.folders = new Set();
  }

  getAbstractFileByPath(path) {
    if (this.files.has(path)) {
      return { path };
    }
    if (this.folders.has(path)) {
      return { path };
    }
    return null;
  }

  async createFolder(path) {
    this.folders.add(path);
  }

  async create(path, content) {
    this.files.set(path, content);
    return { path };
  }

  async cachedRead(file) {
    if (!this.files.has(file.path)) {
      throw new Error(`missing file: ${file.path}`);
    }
    return this.files.get(file.path);
  }
}

try {
  mkdirSync(tempDir, { recursive: true });

  await build({
    entryPoints: [resolve(projectRoot, "src", "prompt-store.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    loader: {
      ".png": "dataurl",
    },
  });

  const module = await import(pathToFileURL(outfile).href);
  assert.equal(typeof module.PetPromptStore, "function", "PetPromptStore export is missing");

  const vault = new FakeVault({
    "Pet Agents/Prompts/工程鼠.md": "# 工程鼠提示词\n\n自定义工程鼠提示词",
    "Pet Agents/Prompts/博士熊.md": "   ",
  });
  const store = new module.PetPromptStore({
    app: {
      vault,
    },
  });

  await store.initialize();

  assert.equal(Boolean(vault.getAbstractFileByPath("Pet Agents/Prompts")), true);
  assert.equal(Boolean(vault.getAbstractFileByPath("Pet Agents/Prompts/工程鼠.md")), true);
  assert.equal(Boolean(vault.getAbstractFileByPath("Pet Agents/Prompts/博士熊.md")), true);
  assert.equal(Boolean(vault.getAbstractFileByPath("Pet Agents/Prompts/机灵兔.md")), true);

  assert.equal(store.getPrompt("engineer-mole"), "# 工程鼠提示词\n\n自定义工程鼠提示词");
  assert.match(store.getPrompt("scholar-panda"), /博士熊/);
  assert.match(store.getPrompt("homie-rabbit"), /默认只回 1 到 3 句/);
  assert.match(store.getPrompt("homie-rabbit"), /先接情绪，再说一句判断，不主动上建议/);

  assert.equal(store.handlesPath("Pet Agents/Prompts/机灵兔.md"), true);
  assert.equal(store.handlesPath("Random/Other.md"), false);

  await vault.create("Pet Agents/Prompts/机灵兔.md", "# 机灵兔提示词\n\n改过的兔兔提示词");
  await store.reloadAll();
  assert.equal(store.getPrompt("homie-rabbit"), "# 机灵兔提示词\n\n改过的兔兔提示词");

  console.log("prompt-store-check: ok");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
