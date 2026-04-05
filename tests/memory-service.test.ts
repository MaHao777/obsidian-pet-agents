import test from "node:test";
import assert from "node:assert/strict";

import { LayeredMemoryService } from "../src/memory.ts";
import { parseMemoryNoteMarkdown } from "../src/memory-graph.ts";
import type { MemoryExtractionAtom } from "../src/memory-extraction.ts";

type MockFile = {
  path: string;
  basename: string;
  extension: string;
  stat: { mtime: number };
};

class MockVault {
  private readonly folders = new Set<string>();
  private readonly files = new Map<string, { content: string; mtime: number }>();

  constructor(seed: Array<{ path: string; content: string; mtime: number }>) {
    seed.forEach((entry) => {
      this.files.set(entry.path, { content: entry.content, mtime: entry.mtime });
      this.trackFolders(entry.path);
    });
  }

  getMarkdownFiles(): MockFile[] {
    return Array.from(this.files.entries())
      .filter(([path]) => path.endsWith(".md"))
      .map(([path, entry]) => this.toFile(path, entry.mtime));
  }

  async cachedRead(file: MockFile): Promise<string> {
    const entry = this.files.get(file.path);
    if (!entry) {
      throw new Error(`Missing file: ${file.path}`);
    }
    return entry.content;
  }

  getAbstractFileByPath(path: string): MockFile | { path: string } | null {
    const file = this.files.get(path);
    if (file) {
      return this.toFile(path, file.mtime);
    }
    if (this.folders.has(path)) {
      return { path };
    }
    return null;
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(path);
  }

  async create(path: string, content: string): Promise<MockFile> {
    const mtime = Date.now();
    this.files.set(path, { content, mtime });
    this.trackFolders(path);
    return this.toFile(path, mtime);
  }

  async modify(file: MockFile, content: string): Promise<void> {
    const existing = this.files.get(file.path);
    if (!existing) {
      throw new Error(`Missing file: ${file.path}`);
    }
    existing.content = content;
    existing.mtime += 1;
  }

  async rename(file: MockFile, nextPath: string): Promise<void> {
    const existing = this.files.get(file.path);
    if (!existing) {
      throw new Error(`Missing file: ${file.path}`);
    }
    this.files.delete(file.path);
    this.files.set(nextPath, existing);
    this.trackFolders(nextPath);
  }

  writeSource(path: string, content: string, mtime: number): void {
    this.files.set(path, { content, mtime });
    this.trackFolders(path);
  }

  deleteSource(path: string): void {
    this.files.delete(path);
  }

  read(path: string): string {
    const entry = this.files.get(path);
    if (!entry) {
      throw new Error(`Missing file: ${path}`);
    }
    return entry.content;
  }

  listPaths(prefix: string): string[] {
    return Array.from(this.files.keys()).filter((path) => path.startsWith(prefix)).sort();
  }

  private toFile(path: string, mtime: number): MockFile {
    const parts = path.split("/");
    const name = parts[parts.length - 1];
    const basename = name.replace(/\.md$/, "");
    return {
      path,
      basename,
      extension: "md",
      stat: { mtime },
    };
  }

  private trackFolders(path: string): void {
    const segments = path.split("/");
    segments.pop();
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      this.folders.add(current);
    }
  }
}

function thingAtom(overrides: Partial<MemoryExtractionAtom> = {}): MemoryExtractionAtom {
  return {
    title: overrides.title ?? "Alice",
    kind: overrides.kind ?? "thing",
    thingType: overrides.thingType ?? "person",
    summary: overrides.summary ?? "Alice is a close friend.",
    facts: overrides.facts ?? ["Lives in Shanghai.", "Studies literature."],
    aliases: overrides.aliases ?? ["艾丽丝"],
    thingTags: overrides.thingTags ?? ["friend"],
    eventDate: overrides.eventDate,
    placeTitles: overrides.placeTitles ?? [],
    feelingTags: overrides.feelingTags ?? [],
    thingTitles: overrides.thingTitles ?? [],
    relations: overrides.relations ?? [{ title: "Cafe Meetup", kind: "event", type: "related_to" }],
  };
}

function eventAtom(overrides: Partial<MemoryExtractionAtom> = {}): MemoryExtractionAtom {
  return {
    title: overrides.title ?? "Cafe Meetup",
    kind: overrides.kind ?? "event",
    thingType: overrides.thingType,
    summary: overrides.summary ?? "A memorable cafe meetup.",
    facts: overrides.facts ?? ["Alice and I discussed Project Maple."],
    aliases: overrides.aliases ?? ["咖啡见面"],
    thingTags: overrides.thingTags ?? [],
    eventDate: overrides.eventDate ?? "2026-04-01",
    placeTitles: overrides.placeTitles ?? ["West Lake Cafe"],
    feelingTags: overrides.feelingTags ?? ["optimistic"],
    thingTitles: overrides.thingTitles ?? ["Alice", "Project Maple"],
    relations: overrides.relations ?? [{ title: "Alice", kind: "thing", thingType: "person", type: "involves" }],
  };
}

test("initial build writes thing and event memory notes with structured links", async () => {
  const vault = new MockVault([
    { path: "日记/2026-04-01.md", content: "# Day\nAlice and the cafe meetup.", mtime: 1 },
    { path: "文科/Project Maple.md", content: "# Maple\nWriting plan with Alice.", mtime: 2 },
  ]);

  const extractionCalls: string[] = [];
  const service = new LayeredMemoryService(
    {
      app: { vault: vault as never },
      settings: {
        memorySourcePaths: ["日记", "文科"],
        memoryFolderPath: "memory",
      },
      schedulePersist(): void {},
      async extractMemoryAtoms(input): Promise<MemoryExtractionAtom[]> {
        extractionCalls.push(input.path);
        if (input.path === "日记/2026-04-01.md") {
          return [
            thingAtom(),
            thingAtom({
              title: "West Lake Cafe",
              thingType: "place",
              summary: "A quiet cafe often used for meaningful conversations.",
              aliases: [],
              thingTags: ["cafe"],
              relations: [{ title: "Cafe Meetup", kind: "event", type: "hosts" }],
            }),
            eventAtom(),
          ];
        }

        return [
          thingAtom({
            title: "Project Maple",
            thingType: "object",
            summary: "A long-running writing collaboration.",
            facts: ["Alice is helping with the structure."],
            aliases: ["Maple"],
            thingTags: ["writing"],
            relations: [{ title: "Alice", kind: "thing", thingType: "person", type: "collaborates_with" }],
          }),
          thingAtom({
            summary: "Alice is also part of the writing collaboration.",
            facts: ["Alice is helping with the structure of Project Maple."],
            relations: [{ title: "Project Maple", kind: "thing", thingType: "object", type: "collaborates_with" }],
          }),
        ];
      },
      async getGitChanges(): Promise<null> {
        return null;
      },
    },
    undefined,
  );

  await service.initialize();

  assert.deepEqual(extractionCalls.sort(), ["文科/Project Maple.md", "日记/2026-04-01.md"]);
  const memoryPaths = vault.listPaths("memory/");
  assert.equal(memoryPaths.length, 4);

  const eventPath = memoryPaths.find((path) => path.includes("event-cafe-meetup-"));
  assert.ok(eventPath);
  const event = parseMemoryNoteMarkdown(eventPath!, vault.read(eventPath!));
  assert.ok(event);
  assert.equal(event.kind, "event");
  assert.deepEqual(event.thingIds.length >= 2, true);
  assert.deepEqual(event.placeIds.length >= 1, true);

  const alicePath = memoryPaths.find((path) => path.includes("thing-alice-"));
  assert.ok(alicePath);
  const alice = parseMemoryNoteMarkdown(alicePath!, vault.read(alicePath!));
  assert.ok(alice);
  assert.deepEqual(alice.sourcePaths.sort(), ["文科/Project Maple.md", "日记/2026-04-01.md"]);
});

test("incremental refresh keeps stable ids, archives stale events, and ignores unanchored events", async () => {
  const vault = new MockVault([{ path: "日记/2026-04-01.md", content: "# Day\nAlice and the cafe meetup.", mtime: 1 }]);
  let version = 1;
  const service = new LayeredMemoryService(
    {
      app: { vault: vault as never },
      settings: {
        memorySourcePaths: ["日记"],
        memoryFolderPath: "memory",
      },
      schedulePersist(): void {},
      async extractMemoryAtoms(): Promise<MemoryExtractionAtom[]> {
        if (version === 1) {
          return [
            thingAtom(),
            eventAtom(),
          ];
        }

        return [
          thingAtom({
            summary: "Alice is now helping with a new outline.",
            facts: ["Alice reviewed the new writing outline."],
            relations: [],
          }),
          eventAtom({
            title: "Loose Feeling",
            summary: "A vague mood with no explicit anchor.",
            thingTitles: [],
            placeTitles: [],
            feelingTags: ["uneasy"],
            relations: [],
          }),
        ];
      },
      async getGitChanges(): Promise<{ paths: string[]; headCommit: string }> {
        return { paths: ["日记/2026-04-01.md"], headCommit: version === 1 ? "commit-a" : "commit-b" };
      },
    },
    undefined,
  );

  await service.initialize();
  const initialAlicePath = vault.listPaths("memory/").find((path) => path.includes("thing-alice-"));
  assert.ok(initialAlicePath);

  version = 2;
  vault.writeSource("日记/2026-04-01.md", "# Day\nAlice reviewed the new outline.", 2);
  await service.fullScan(false);

  const currentAlicePath = vault.listPaths("memory/").find((path) => path.includes("thing-alice-"));
  assert.equal(currentAlicePath, initialAlicePath);
  const currentAlice = parseMemoryNoteMarkdown(currentAlicePath!, vault.read(currentAlicePath!));
  assert.match(currentAlice?.summary ?? "", /new outline/);

  const archivedPaths = vault.listPaths("memory/archive/");
  assert.equal(archivedPaths.some((path) => path.includes("event-cafe-meetup-")), true);
  assert.equal(vault.listPaths("memory/").some((path) => path.includes("event-loose-feeling-")), false);
});

test("fallback fingerprint sync detects changed and deleted source files without git", async () => {
  const vault = new MockVault([
    { path: "文科/A.md", content: "# A\nAlice", mtime: 1 },
    { path: "文科/B.md", content: "# B\nBob", mtime: 1 },
  ]);
  const calls: string[] = [];
  const service = new LayeredMemoryService(
    {
      app: { vault: vault as never },
      settings: {
        memorySourcePaths: ["文科"],
        memoryFolderPath: "memory",
      },
      schedulePersist(): void {},
      async extractMemoryAtoms(input): Promise<MemoryExtractionAtom[]> {
        calls.push(input.path);
        return [
          thingAtom({
            title: input.path === "文科/A.md" ? "Alice" : "Bob",
            summary: `${input.path} summary`,
            facts: [`${input.path} fact`],
            aliases: [],
            thingTags: [],
            relations: [],
          }),
        ];
      },
      async getGitChanges(): Promise<null> {
        return null;
      },
    },
    undefined,
  );

  await service.initialize();
  calls.length = 0;

  vault.writeSource("文科/A.md", "# A\nAlice updated", 2);
  vault.deleteSource("文科/B.md");
  await service.fullScan(false);

  assert.deepEqual(calls, ["文科/A.md"]);
  const archivedPaths = vault.listPaths("memory/archive/");
  assert.equal(archivedPaths.some((path) => path.includes("thing-bob-")), true);
});

test("legacy multi-category notes are replaced by the two-type schema on rebuild", async () => {
  const legacyNote = [
    "---",
    'memory_id: "project-maple-3333cccc"',
    'title: "Project Maple"',
    'category: "project"',
    'aliases: ["Maple"]',
    'tags: ["writing"]',
    'memory_date: ""',
    'source_paths: ["文科/Project Maple.md"]',
    'source_hashes: {"文科/Project Maple.md":"hash-old"}',
    'related_ids: []',
    "archived: false",
    'generated_at: "2026-04-03T10:00:00.000Z"',
    'updated_at: "2026-04-03T10:00:00.000Z"',
    "---",
    "# Project Maple",
    "",
    "Legacy project note.",
    "",
    "## Facts",
    "- Legacy",
    "",
    "## Related",
    "- None",
    "",
    "## Sources",
    "- [[文科/Project Maple]]",
    "",
  ].join("\n");

  const vault = new MockVault([
    { path: "文科/Project Maple.md", content: "# Maple\nWriting plan with Alice.", mtime: 2 },
    { path: "memory/project-maple-3333cccc.md", content: legacyNote, mtime: 1 },
  ]);

  const service = new LayeredMemoryService(
    {
      app: { vault: vault as never },
      settings: {
        memorySourcePaths: ["文科"],
        memoryFolderPath: "memory",
      },
      schedulePersist(): void {},
      async extractMemoryAtoms(): Promise<MemoryExtractionAtom[]> {
        return [
          thingAtom({
            title: "Project Maple",
            thingType: "object",
            summary: "A long-running writing collaboration.",
            facts: ["Alice is helping with the structure."],
            aliases: ["Maple"],
            thingTags: ["writing"],
            relations: [],
          }),
        ];
      },
      async getGitChanges(): Promise<{ paths: string[]; headCommit: string }> {
        return { paths: ["文科/Project Maple.md"], headCommit: "commit-a" };
      },
    },
    undefined,
  );

  await service.initialize();

  const activeThingPath = vault.listPaths("memory/").find((path) => path.includes("thing-project-maple-") && !path.includes("/archive/"));
  assert.ok(activeThingPath);
  const activeThing = parseMemoryNoteMarkdown(activeThingPath!, vault.read(activeThingPath!));
  assert.equal(activeThing?.kind, "thing");
  assert.equal(activeThing?.thingType, "object");

  const archivedLegacyPath = vault.listPaths("memory/archive/").find((path) => path.includes("project-maple-3333cccc"));
  assert.ok(archivedLegacyPath);
});
