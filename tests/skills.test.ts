import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";

import { discoverSkills } from "../src/skills.ts";

async function writeSkill(skillFilePath: string, name: string, description: string): Promise<void> {
  await mkdir(path.dirname(skillFilePath), { recursive: true });
  await writeFile(
    skillFilePath,
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`,
    "utf8",
  );
}

test("discoverSkills returns user and plugin skills while skipping malformed entries", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "obs-pet-agents-skills-"));
  const userSkillRoot = path.join(tempRoot, "skills");
  const pluginCacheRoot = path.join(tempRoot, "plugins", "cache");

  try {
    await writeSkill(
      path.join(userSkillRoot, "writing-plans", "SKILL.md"),
      "writing-plans",
      "Use when you have a spec or requirements for a multi-step task.",
    );
    await writeSkill(
      path.join(pluginCacheRoot, "openai-curated", "github", "hash", "skills", "gh-address-comments", "SKILL.md"),
      "gh-address-comments",
      "Address actionable GitHub pull request review feedback.",
    );
    await mkdir(path.join(userSkillRoot, "broken-skill"), { recursive: true });
    await writeFile(path.join(userSkillRoot, "broken-skill", "SKILL.md"), "# missing frontmatter\n", "utf8");

    const skills = await discoverSkills({
      userSkillRoot,
      pluginCacheRoot,
    });

    assert.equal(skills.some((skill) => skill.name === "writing-plans"), true);
    assert.equal(skills.some((skill) => skill.name === "gh-address-comments"), true);
    assert.equal(skills.some((skill) => skill.path.includes("broken-skill")), false);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
