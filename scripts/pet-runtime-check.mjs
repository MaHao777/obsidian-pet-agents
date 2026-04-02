import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = mkdtempSync(join(tmpdir(), "obs-pet-runtime-"));
const outfile = join(tempDir, "pet-runtime-test.mjs");

try {
  mkdirSync(tempDir, { recursive: true });

  await build({
    entryPoints: [resolve(projectRoot, "src", "pets.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    loader: {
      ".png": "dataurl",
    },
  });

  const module = await import(pathToFileURL(outfile).href);

  assert.equal(module.getPetProfile("engineer-mole").name, "工程鼠");
  assert.equal(module.getPetProfile("scholar-panda").name, "博士熊");
  assert.equal(module.getPetProfile("homie-rabbit").name, "机灵兔");

  assert.equal(typeof module.getPetRuntimeSettings, "function", "getPetRuntimeSettings export is missing");
  assert.equal(typeof module.reasoningEffortLabel, "function", "reasoningEffortLabel export is missing");

  const defaultSettings = module.createDefaultPetRuntimeSettings();
  assert.equal(defaultSettings["engineer-mole"].model, "gpt-5.4");
  assert.equal(defaultSettings["scholar-panda"].model, "gpt-5.4");
  assert.equal(defaultSettings["homie-rabbit"].model, "gpt-5.4");
  assert.equal(module.getPetRuntimeSettings("engineer-mole", defaultSettings).reasoningEffort, "high");
  assert.equal(module.getPetRuntimeSettings("scholar-panda", defaultSettings).reasoningEffort, "xhigh");
  assert.equal(module.getPetRuntimeSettings("homie-rabbit", defaultSettings).reasoningEffort, "medium");

  const normalized = module.normalizePetRuntimeSettings(
    {
      "engineer-mole": { model: "gpt-5.3-codex" },
      "scholar-panda": { reasoningEffort: "medium" },
    },
    "gpt-5.4",
  );
  assert.equal(normalized["engineer-mole"].model, "gpt-5.3-codex");
  assert.equal(normalized["engineer-mole"].reasoningEffort, "high");
  assert.equal(normalized["scholar-panda"].model, "gpt-5.4");
  assert.equal(normalized["scholar-panda"].reasoningEffort, "medium");
  assert.equal(normalized["homie-rabbit"].reasoningEffort, "medium");

  assert.equal(module.reasoningEffortLabel("low"), "低");
  assert.equal(module.reasoningEffortLabel("medium"), "中等");
  assert.equal(module.reasoningEffortLabel("high"), "高");
  assert.equal(module.reasoningEffortLabel("xhigh"), "超高");

  const avatar = module.getPetAvatar("engineer-mole");
  assert.ok(avatar.startsWith("data:image/"), "pet avatar should be bundled as a data URL");

  console.log("pet-runtime-check: ok");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
