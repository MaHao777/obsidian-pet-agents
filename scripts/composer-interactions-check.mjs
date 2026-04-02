import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = mkdtempSync(join(tmpdir(), "obs-pet-composer-"));
const outfile = join(tempDir, "composer-test.mjs");

try {
  mkdirSync(tempDir, { recursive: true });

  await build({
    entryPoints: [resolve(projectRoot, "src", "composer.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    loader: {
      ".png": "dataurl",
    },
  });

  const module = await import(pathToFileURL(outfile).href);

  assert.equal(module.getNextPrimaryPet("engineer-mole"), "scholar-panda");
  assert.equal(module.getNextPrimaryPet("scholar-panda"), "homie-rabbit");
  assert.equal(module.getNextPrimaryPet("homie-rabbit"), "engineer-mole");

  assert.equal(module.getPreviousPrimaryPet("engineer-mole"), "homie-rabbit");
  assert.equal(module.getPreviousPrimaryPet("homie-rabbit"), "scholar-panda");

  const trigger = module.findMentionTrigger("先问一下 @博", "先问一下 @博".length);
  assert.deepEqual(trigger, {
    query: "博",
    start: 5,
    end: 7,
  });

  const allAgents = module.getMentionSuggestions("");
  assert.equal(allAgents.length, 3);
  assert.equal(allAgents[0].id, "engineer-mole");
  assert.equal(allAgents[1].id, "scholar-panda");
  assert.equal(allAgents[2].id, "homie-rabbit");

  const bearOnly = module.getMentionSuggestions("博");
  assert.equal(bearOnly.length, 1);
  assert.equal(bearOnly[0].id, "scholar-panda");

  const inserted = module.applyMentionSuggestion("先问一下 @博", trigger, "博士熊");
  assert.equal(inserted.text, "先问一下 @博士熊 ");
  assert.equal(inserted.caretIndex, "先问一下 @博士熊 ".length);

  assert.equal(module.findMentionTrigger("普通文本", 4), null);

  console.log("composer-interactions-check: ok");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
