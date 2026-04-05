import os from "os";
import path from "path";
import { promises as fs } from "fs";

export interface DiscoveredSkill {
  name: string;
  description: string;
  path: string;
}

export interface DiscoverSkillsOptions {
  userSkillRoot?: string;
  pluginCacheRoot?: string;
}

type SkillMetadata = {
  name: string;
  description: string;
};

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    return (await fs.stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function walkForSkillFiles(rootPath: string): Promise<string[]> {
  const results: string[] = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name === "SKILL.md") {
        results.push(entryPath);
      }
    }
  }

  return results;
}

async function walkForSkillRoots(rootPath: string): Promise<string[]> {
  const roots: string[] = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const entryPath = path.join(current, entry.name);
      if (entry.name === "skills") {
        roots.push(entryPath);
        continue;
      }

      stack.push(entryPath);
    }
  }

  return roots;
}

function parseSkillMetadata(markdown: string): SkillMetadata | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) {
    return null;
  }

  const fields = new Map<string, string>();
  match[1]
    .split(/\r?\n/)
    .map((line) => /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(line.trim()))
    .filter((line): line is RegExpExecArray => line !== null)
    .forEach(([, key, value]) => {
      fields.set(key, value.trim());
    });

  const name = fields.get("name");
  const description = fields.get("description");
  if (!name || !description) {
    return null;
  }

  return { name, description };
}

async function readDiscoveredSkill(skillPath: string): Promise<DiscoveredSkill | null> {
  try {
    const content = await fs.readFile(skillPath, "utf8");
    const metadata = parseSkillMetadata(content);
    if (!metadata) {
      return null;
    }

    return {
      name: metadata.name,
      description: metadata.description,
      path: skillPath,
    };
  } catch {
    return null;
  }
}

export async function discoverSkills(options: DiscoverSkillsOptions = {}): Promise<DiscoveredSkill[]> {
  const userSkillRoot = options.userSkillRoot ?? path.join(os.homedir(), ".codex", "skills");
  const pluginCacheRoot = options.pluginCacheRoot ?? path.join(os.homedir(), ".codex", "plugins", "cache");
  const skillFiles = new Set<string>();

  if (await directoryExists(userSkillRoot)) {
    (await walkForSkillFiles(userSkillRoot)).forEach((skillPath) => skillFiles.add(skillPath));
  }

  if (await directoryExists(pluginCacheRoot)) {
    const pluginSkillRoots = await walkForSkillRoots(pluginCacheRoot);
    for (const pluginSkillRoot of pluginSkillRoots) {
      (await walkForSkillFiles(pluginSkillRoot)).forEach((skillPath) => skillFiles.add(skillPath));
    }
  }

  const discovered: DiscoveredSkill[] = [];
  for (const skillPath of skillFiles) {
    const skill = await readDiscoveredSkill(skillPath);
    if (skill) {
      discovered.push(skill);
    }
  }

  return discovered.sort((left, right) => {
    const nameOrder = left.name.localeCompare(right.name, "en");
    if (nameOrder !== 0) {
      return nameOrder;
    }
    return left.path.localeCompare(right.path, "en");
  });
}
