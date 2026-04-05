import type { TFile } from "obsidian";

import {
  buildMemoryContext,
  buildMemoryGraph,
  buildMemoryNoteMarkdown,
  buildMemoryNotePath,
  normalizeMemoryIndexState,
  parseMemoryNoteMarkdown,
  type MemoryContext,
  type MemoryGraph,
  type MemoryIndexState,
  type MemoryNodeKind,
  type MemorySourceIndexEntry,
  type StoredMemoryNote,
  type ThingPrimaryType,
} from "./memory-graph.ts";
import type { MemoryExtractionAtom, MemoryExtractionRelation } from "./memory-extraction.ts";

const DEFAULT_MEMORY_FOLDER = "memory";
const NOTE_SCHEMA_VERSION = 3;

type ResolvedMemoryAtom = MemoryExtractionAtom & {
  memoryId: string;
  relatedIds: string[];
  resolvedThingIds: string[];
  resolvedPlaceIds: string[];
};

type MemoryNoteLookup = {
  allNotes: Map<string, StoredMemoryNote>;
  graph: MemoryGraph;
  hasLegacyNotes: boolean;
};

function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function slugify(text: string): string {
  const normalized = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "memory";
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableMemoryId(kind: MemoryNodeKind, title: string, thingType?: ThingPrimaryType): string {
  const slug = slugify(title);
  const suffix = hashText(`${kind}:${thingType ?? ""}:${title.trim().toLowerCase()}`).slice(0, 8);
  return `${kind}-${slug}-${suffix}`;
}

function isPathInRoots(path: string, roots: string[]): boolean {
  const normalizedPath = normalizeVaultPath(path).toLowerCase();
  return roots.some((root) => {
    const normalizedRoot = normalizeVaultPath(root).toLowerCase();
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
  });
}

function folderParts(path: string): string[] {
  const normalized = normalizeVaultPath(path);
  const segments = normalized.split("/");
  segments.pop();

  const result: string[] = [];
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    result.push(current);
  }
  return result;
}

function removeSource(note: StoredMemoryNote, sourcePath: string): StoredMemoryNote {
  const nextHashes = { ...note.sourceHashes };
  delete nextHashes[sourcePath];
  return {
    ...note,
    sourcePaths: note.sourcePaths.filter((path) => path !== sourcePath),
    sourceHashes: nextHashes,
  };
}

function buildTitleIndex(notes: Iterable<StoredMemoryNote>): Map<string, string> {
  const index = new Map<string, string>();
  for (const note of notes) {
    if (note.archived) {
      continue;
    }
    index.set(note.title.trim().toLowerCase(), note.memoryId);
    note.aliases.forEach((alias) => index.set(alias.trim().toLowerCase(), note.memoryId));
  }
  return index;
}

function resolveThingReferenceId(
  title: string,
  thingType: ThingPrimaryType,
  titleIndex: Map<string, string>,
  batchTitleIndex: Map<string, string>,
): string {
  const normalizedTitle = title.trim().toLowerCase();
  return batchTitleIndex.get(normalizedTitle) ?? titleIndex.get(normalizedTitle) ?? stableMemoryId("thing", title, thingType);
}

function resolveRelationId(
  relation: MemoryExtractionRelation,
  titleIndex: Map<string, string>,
  batchTitleIndex: Map<string, string>,
): string {
  const normalizedTitle = relation.title.trim().toLowerCase();
  if (batchTitleIndex.has(normalizedTitle)) {
    return batchTitleIndex.get(normalizedTitle)!;
  }
  if (titleIndex.has(normalizedTitle)) {
    return titleIndex.get(normalizedTitle)!;
  }
  return stableMemoryId(relation.kind ?? "thing", relation.title, relation.kind === "thing" ? relation.thingType : undefined);
}

function mergeNote(
  existing: StoredMemoryNote | undefined,
  atom: ResolvedMemoryAtom,
  sourcePath: string,
  sourceHash: string,
  memoryFolderPath: string,
  nowIso: string,
): StoredMemoryNote {
  const base: StoredMemoryNote = {
    schemaVersion: NOTE_SCHEMA_VERSION,
    memoryId: atom.memoryId,
    title: atom.title,
    kind: atom.kind,
    aliases: uniqueStrings([...(existing?.aliases ?? []), ...atom.aliases]),
    summary: atom.summary || existing?.summary || atom.title,
    facts: uniqueStrings(atom.facts.length > 0 ? atom.facts : existing?.facts ?? []).slice(0, 8),
    sourcePaths: uniqueStrings([...(existing?.sourcePaths ?? []), sourcePath]),
    sourceHashes: {
      ...(existing?.sourceHashes ?? {}),
      [sourcePath]: sourceHash,
    },
    relatedIds: uniqueStrings([
      ...(existing?.relatedIds ?? []),
      ...atom.relatedIds,
      ...(atom.kind === "event" ? [...atom.resolvedThingIds, ...atom.resolvedPlaceIds] : []),
    ]).filter((id) => id !== atom.memoryId),
    archived: false,
    generatedAt: existing?.generatedAt ?? nowIso,
    updatedAt: nowIso,
    filePath: "",
    thingType: atom.kind === "thing" ? atom.thingType ?? existing?.thingType ?? "other" : undefined,
    thingTags: atom.kind === "thing" ? uniqueStrings([...(existing?.thingTags ?? []), ...atom.thingTags]).slice(0, 6) : [],
    eventDate: atom.kind === "event" ? atom.eventDate ?? existing?.eventDate : undefined,
    placeIds: atom.kind === "event" ? uniqueStrings([...(existing?.placeIds ?? []), ...atom.resolvedPlaceIds]) : [],
    feelingTags: atom.kind === "event" ? uniqueStrings([...(existing?.feelingTags ?? []), ...atom.feelingTags]).slice(0, 4) : [],
    thingIds: atom.kind === "event" ? uniqueStrings([...(existing?.thingIds ?? []), ...atom.resolvedThingIds]) : [],
  };

  base.filePath = buildMemoryNotePath(memoryFolderPath, base);
  return base;
}

export interface MemoryGitChangeSet {
  paths: string[];
  headCommit: string;
}

export interface MemoryHost {
  app: {
    vault: {
      getMarkdownFiles(): TFile[];
      cachedRead(file: TFile): Promise<string>;
      getAbstractFileByPath(path: string): TFile | { path: string } | null;
      createFolder(path: string): Promise<unknown>;
      create(path: string, content: string): Promise<TFile>;
      modify(file: TFile, content: string): Promise<unknown>;
      rename(file: TFile | { path: string }, newPath: string): Promise<unknown>;
    };
  };
  settings: {
    memorySourcePaths: string[];
    memoryFolderPath: string;
  };
  schedulePersist(): void;
  extractMemoryAtoms(input: { path: string; content: string }): Promise<MemoryExtractionAtom[]>;
  getGitChanges?(sourcePaths: string[], lastIndexedCommit: string): Promise<MemoryGitChangeSet | null>;
}

export class LayeredMemoryService {
  snapshot: MemoryIndexState;
  private readonly host: MemoryHost;
  private notes = new Map<string, StoredMemoryNote>();
  private graph = buildMemoryGraph([]);

  constructor(host: MemoryHost, snapshot?: unknown) {
    this.host = host;
    this.snapshot = normalizeMemoryIndexState(snapshot, this.memoryFolderPath);
  }

  get activeMemoryCount(): number {
    return this.snapshot.activeMemoryCount;
  }

  async initialize(): Promise<void> {
    this.snapshot = normalizeMemoryIndexState(this.snapshot, this.memoryFolderPath);
    await this.ensureMemoryFolders();
    await this.reloadGraph();
    await this.fullScan(this.snapshot.lastSyncAt === 0 || Object.keys(this.snapshot.sourceFiles).length === 0);
  }

  async fullScan(force: boolean): Promise<void> {
    await this.ensureMemoryFolders();
    const noteLookup = await this.loadAllNotes();
    this.notes = noteLookup.allNotes;
    this.graph = noteLookup.graph;

    const sourceFiles = this.getSourceFiles();
    const currentSourceMap = new Map(sourceFiles.map((file) => [normalizeVaultPath(file.path), file]));
    const deletedPaths = Object.keys(this.snapshot.sourceFiles).filter((path) => !currentSourceMap.has(normalizeVaultPath(path)));
    const shouldForceRescan = force || noteLookup.hasLegacyNotes;
    const changeSet = await this.collectChangedPaths(sourceFiles, deletedPaths, shouldForceRescan);
    const changedExistingPaths = changeSet.paths.filter((path) => currentSourceMap.has(path));
    const deletedChangedPaths = changeSet.paths.filter((path) => !currentSourceMap.has(path));

    const extractions = new Map<
      string,
      {
        file: TFile;
        contentHash: string;
        atoms: ResolvedMemoryAtom[];
      }
    >();

    if (changedExistingPaths.length > 0) {
      const titleIndex = buildTitleIndex(this.notes.values());
      const rawExtractions = new Map<
        string,
        {
          file: TFile;
          contentHash: string;
          atoms: MemoryExtractionAtom[];
        }
      >();
      const batchTitleIndex = new Map<string, string>();

      for (const path of changedExistingPaths) {
        const file = currentSourceMap.get(path)!;
        const content = await this.host.app.vault.cachedRead(file);
        const contentHash = hashText(content);
        const atoms = await this.host.extractMemoryAtoms({ path, content });
        rawExtractions.set(path, {
          file,
          contentHash,
          atoms,
        });
        atoms.forEach((atom) => {
          const memoryId = stableMemoryId(atom.kind, atom.title, atom.kind === "thing" ? atom.thingType : undefined);
          batchTitleIndex.set(atom.title.trim().toLowerCase(), memoryId);
          atom.aliases.forEach((alias) => batchTitleIndex.set(alias.trim().toLowerCase(), memoryId));
        });
      }

      rawExtractions.forEach((entry, path) => {
        const atoms = entry.atoms
          .map<ResolvedMemoryAtom | null>((atom) => {
            const resolvedThingIds =
              atom.kind === "event"
                ? uniqueStrings(atom.thingTitles.map((title) => resolveThingReferenceId(title, "other", titleIndex, batchTitleIndex)))
                : [];
            const resolvedPlaceIds =
              atom.kind === "event"
                ? uniqueStrings(atom.placeTitles.map((title) => resolveThingReferenceId(title, "place", titleIndex, batchTitleIndex)))
                : [];

            if (atom.kind === "event" && resolvedThingIds.length === 0 && resolvedPlaceIds.length === 0) {
              return null;
            }

            const relatedIds = uniqueStrings(
              atom.relations.map((relation) => resolveRelationId(relation, titleIndex, batchTitleIndex)),
            );

            return {
              ...atom,
              memoryId: stableMemoryId(atom.kind, atom.title, atom.kind === "thing" ? atom.thingType : undefined),
              relatedIds,
              resolvedThingIds,
              resolvedPlaceIds,
            };
          })
          .filter((atom): atom is ResolvedMemoryAtom => atom !== null);

        extractions.set(path, {
          file: entry.file,
          contentHash: entry.contentHash,
          atoms,
        });
      });
    }

    for (const path of deletedChangedPaths) {
      await this.detachMissingSource(path);
      delete this.snapshot.sourceFiles[path];
    }

    for (const path of changedExistingPaths) {
      const extracted = extractions.get(path)!;
      const previousIds = this.snapshot.sourceFiles[path]?.memoryIds ?? [];
      const nextIds = extracted.atoms.map((atom) => atom.memoryId);
      const sourceHash = extracted.contentHash;
      const nowIso = new Date().toISOString();

      for (const staleId of previousIds.filter((id) => !nextIds.includes(id))) {
        await this.detachSourceFromMemory(staleId, path);
      }

      for (const atom of extracted.atoms) {
        const existing = this.notes.get(atom.memoryId);
        const nextNote = mergeNote(existing, atom, path, sourceHash, this.memoryFolderPath, nowIso);
        await this.writeNote(existing?.filePath, nextNote);
        this.notes.set(nextNote.memoryId, nextNote);
      }

      const updatedAt = extracted.file.stat.mtime;
      const nextSourceEntry: MemorySourceIndexEntry = {
        contentHash: sourceHash,
        updatedAt,
        memoryIds: nextIds,
      };
      this.snapshot.sourceFiles[path] = nextSourceEntry;
    }

    if (noteLookup.hasLegacyNotes) {
      await this.archiveLegacyNotes();
    }

    this.snapshot.lastSyncAt = Date.now();
    if (changeSet.headCommit) {
      this.snapshot.lastIndexedCommit = changeSet.headCommit;
    }

    await this.reloadGraph();
    this.host.schedulePersist();
  }

  async refreshFile(): Promise<void> {
    await this.fullScan(false);
  }

  async removePath(): Promise<void> {
    await this.fullScan(false);
  }

  isManagedMemoryPath(path: string): boolean {
    const normalizedPath = normalizeVaultPath(path);
    const folder = this.memoryFolderPath.toLowerCase();
    return normalizedPath.toLowerCase() === folder || normalizedPath.toLowerCase().startsWith(`${folder}/`);
  }

  isSourcePath(path: string): boolean {
    return isPathInRoots(path, this.sourcePaths);
  }

  buildContext(query: { petId: string; query: string; conversation: import("./types").ChatMessage[] }): MemoryContext {
    return buildMemoryContext({
      graph: this.graph,
      query: query.query,
      conversation: query.conversation,
    });
  }

  private get sourcePaths(): string[] {
    return uniqueStrings(this.host.settings.memorySourcePaths.map((path) => normalizeVaultPath(path))).filter(Boolean);
  }

  private get memoryFolderPath(): string {
    return normalizeVaultPath(this.host.settings.memoryFolderPath || DEFAULT_MEMORY_FOLDER) || DEFAULT_MEMORY_FOLDER;
  }

  private getSourceFiles(): TFile[] {
    if (this.sourcePaths.length === 0) {
      return [];
    }

    return this.host.app.vault
      .getMarkdownFiles()
      .filter((file) => {
        const path = normalizeVaultPath(file.path);
        if (this.isManagedMemoryPath(path)) {
          return false;
        }
        return isPathInRoots(path, this.sourcePaths);
      })
      .sort((left, right) => normalizeVaultPath(left.path).localeCompare(normalizeVaultPath(right.path), "zh-CN"));
  }

  private async collectChangedPaths(sourceFiles: TFile[], deletedPaths: string[], force: boolean): Promise<{ paths: string[]; headCommit: string }> {
    const normalizedDeletedPaths = deletedPaths.map((path) => normalizeVaultPath(path));
    if (force) {
      return {
        paths: uniqueStrings(sourceFiles.map((file) => normalizeVaultPath(file.path)).concat(normalizedDeletedPaths)),
        headCommit: this.snapshot.lastIndexedCommit,
      };
    }

    if (this.host.getGitChanges) {
      try {
        const gitChanges = await this.host.getGitChanges(this.sourcePaths, this.snapshot.lastIndexedCommit);
        if (gitChanges) {
          const paths = uniqueStrings(
            gitChanges.paths
              .map((path) => normalizeVaultPath(path))
              .filter((path) => this.isSourcePath(path) || this.snapshot.sourceFiles[path] !== undefined)
              .concat(normalizedDeletedPaths),
          );
          return {
            paths,
            headCommit: gitChanges.headCommit,
          };
        }
      } catch {
        // Fallback below.
      }
    }

    const changedPaths = [...normalizedDeletedPaths];
    for (const file of sourceFiles) {
      const path = normalizeVaultPath(file.path);
      const previous = this.snapshot.sourceFiles[path];
      if (!previous) {
        changedPaths.push(path);
        continue;
      }
      if (previous.updatedAt !== file.stat.mtime) {
        const content = await this.host.app.vault.cachedRead(file);
        if (previous.contentHash !== hashText(content)) {
          changedPaths.push(path);
        }
      }
    }

    return {
      paths: uniqueStrings(changedPaths),
      headCommit: this.snapshot.lastIndexedCommit,
    };
  }

  private async loadAllNotes(): Promise<MemoryNoteLookup> {
    const notes: StoredMemoryNote[] = [];
    const folder = this.memoryFolderPath.toLowerCase();

    for (const file of this.host.app.vault.getMarkdownFiles()) {
      const path = normalizeVaultPath(file.path);
      if (path.toLowerCase() !== folder && !path.toLowerCase().startsWith(`${folder}/`)) {
        continue;
      }
      const content = await this.host.app.vault.cachedRead(file);
      const parsed = parseMemoryNoteMarkdown(path, content);
      if (parsed) {
        notes.push(parsed);
      }
    }

    return {
      allNotes: new Map(notes.map((note) => [note.memoryId, note])),
      graph: buildMemoryGraph(notes),
      hasLegacyNotes: notes.some((note) => note.schemaVersion < NOTE_SCHEMA_VERSION),
    };
  }

  private async reloadGraph(): Promise<void> {
    const loaded = await this.loadAllNotes();
    this.notes = loaded.allNotes;
    this.graph = loaded.graph;
    this.snapshot.memoryFolderPath = this.memoryFolderPath;
    this.snapshot.activeMemoryCount = Array.from(this.notes.values()).filter((note) => !note.archived).length;
    this.snapshot.archivedMemoryCount = Array.from(this.notes.values()).filter((note) => note.archived).length;
  }

  private async ensureMemoryFolders(): Promise<void> {
    for (const path of [this.memoryFolderPath, `${this.memoryFolderPath}/archive`]) {
      for (const folderPath of folderParts(path)) {
        if (!this.host.app.vault.getAbstractFileByPath(folderPath)) {
          await this.host.app.vault.createFolder(folderPath);
        }
      }
      if (!this.host.app.vault.getAbstractFileByPath(path)) {
        await this.host.app.vault.createFolder(path);
      }
    }
  }

  private async writeNote(currentPath: string | undefined, note: StoredMemoryNote): Promise<void> {
    const targetPath = buildMemoryNotePath(this.memoryFolderPath, note);
    note.filePath = targetPath;
    const markdown = buildMemoryNoteMarkdown(note);
    const currentFile = currentPath ? (this.host.app.vault.getAbstractFileByPath(currentPath) as TFile | null) : null;
    const targetFile = this.host.app.vault.getAbstractFileByPath(targetPath) as TFile | null;

    if (currentFile && currentPath !== targetPath && !targetFile) {
      await this.host.app.vault.rename(currentFile, targetPath);
    }

    const file = (this.host.app.vault.getAbstractFileByPath(targetPath) as TFile | null) ?? null;
    if (file) {
      await this.host.app.vault.modify(file, markdown);
      return;
    }

    await this.host.app.vault.create(targetPath, markdown);
  }

  private async archiveLegacyNotes(): Promise<void> {
    for (const note of Array.from(this.notes.values())) {
      if (note.schemaVersion >= NOTE_SCHEMA_VERSION || note.archived) {
        continue;
      }
      const nextNote: StoredMemoryNote = {
        ...note,
        schemaVersion: NOTE_SCHEMA_VERSION,
        archived: true,
        updatedAt: new Date().toISOString(),
      };
      await this.writeNote(note.filePath, nextNote);
      this.notes.set(nextNote.memoryId, nextNote);
    }
  }

  private async detachMissingSource(sourcePath: string): Promise<void> {
    const previousIds = this.snapshot.sourceFiles[sourcePath]?.memoryIds ?? [];
    for (const memoryId of previousIds) {
      await this.detachSourceFromMemory(memoryId, sourcePath);
    }
  }

  private async detachSourceFromMemory(memoryId: string, sourcePath: string): Promise<void> {
    const existing = this.notes.get(memoryId);
    if (!existing) {
      return;
    }

    const nextNote = removeSource(existing, sourcePath);
    nextNote.updatedAt = new Date().toISOString();
    if (nextNote.sourcePaths.length === 0) {
      nextNote.archived = true;
    }
    nextNote.filePath = buildMemoryNotePath(this.memoryFolderPath, nextNote);

    await this.writeNote(existing.filePath, nextNote);
    this.notes.set(memoryId, nextNote);
  }
}
