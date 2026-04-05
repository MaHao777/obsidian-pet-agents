import type { ChatMessage } from "./types.ts";

export type MemoryNodeKind = "thing" | "event";
export type ThingPrimaryType = "person" | "animal" | "place" | "object" | "organization" | "other";
export type MemoryContextMode = "none" | "focused" | "broad";

export interface MemorySourceIndexEntry {
  contentHash: string;
  updatedAt: number;
  memoryIds: string[];
}

export interface MemoryIndexState {
  schemaVersion: number;
  lastSyncAt: number;
  lastIndexedCommit: string;
  sourceFiles: Record<string, MemorySourceIndexEntry>;
  memoryFolderPath: string;
  activeMemoryCount: number;
  archivedMemoryCount: number;
}

export interface StoredMemoryNote {
  schemaVersion: number;
  memoryId: string;
  title: string;
  kind: MemoryNodeKind;
  aliases: string[];
  summary: string;
  facts: string[];
  sourcePaths: string[];
  sourceHashes: Record<string, string>;
  relatedIds: string[];
  archived: boolean;
  generatedAt: string;
  updatedAt: string;
  filePath: string;
  thingType?: ThingPrimaryType;
  thingTags: string[];
  eventDate?: string;
  placeIds: string[];
  feelingTags: string[];
  thingIds: string[];
}

export interface MemoryContextEntry {
  id: string;
  title: string;
  path: string;
  summary: string;
  text: string;
  kind: MemoryNodeKind;
  thingType?: ThingPrimaryType;
  depth: number;
  score: number;
  sourcePaths: string[];
}

export interface MemoryContext {
  relevant: boolean;
  capsules: MemoryContextEntry[];
  details: MemoryContextEntry[];
  sessionSummary?: string;
  mode: MemoryContextMode;
}

export interface MemoryGraph {
  notesById: Map<string, StoredMemoryNote>;
  outgoing: Map<string, Set<string>>;
  incoming: Map<string, Set<string>>;
}

const MEMORY_SCHEMA_VERSION = 3;
const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const WIKI_LINK = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
const MEMORY_QUERY_PATTERNS = [
  /记得|回忆|回想|复盘|总结|根据记忆|结合记忆|从记忆里/i,
  /最近|之前|上周|这周|这个月|近况|状态|提过|说过/i,
];

function clip(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff#-]+/gu, " ")
        .split(/\s+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2),
    ),
  );
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

function basenameWithoutExtension(path: string): string {
  const fileName = path.split("/").pop() ?? path;
  return fileName.replace(/\.md$/i, "");
}

function folderOf(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function parseFrontmatterValue(rawValue: string): unknown {
  const value = rawValue.trim();
  if (!value) {
    return "";
  }

  if (value.startsWith("\"") || value.startsWith("[") || value.startsWith("{")) {
    try {
      return JSON.parse(value);
    } catch {
      return value.replace(/^"|"$/g, "");
    }
  }

  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}

function parseFrontmatter(content: string): Record<string, unknown> {
  const match = FRONTMATTER_BLOCK.exec(content);
  if (!match) {
    return {};
  }

  return match[1].split(/\r?\n/).reduce<Record<string, unknown>>((result, line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      return result;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    result[key] = parseFrontmatterValue(value);
    return result;
  }, {});
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? uniqueStrings(value.filter((item): item is string => typeof item === "string")) : [];
}

function sanitizeThingType(value: unknown): ThingPrimaryType {
  const allowed = new Set<ThingPrimaryType>(["person", "animal", "place", "object", "organization", "other"]);
  return typeof value === "string" && allowed.has(value as ThingPrimaryType) ? (value as ThingPrimaryType) : "other";
}

function mapLegacyCategoryToThingType(category: string): ThingPrimaryType {
  switch (category) {
    case "person":
      return "person";
    case "place":
      return "place";
    case "artifact":
      return "object";
    case "project":
      return "organization";
    default:
      return "other";
  }
}

function sectionBody(markdown: string, title: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^## ${escaped}\\r?\\n([\\s\\S]*?)(?=^## |\\Z)`, "m");
  const match = pattern.exec(markdown);
  return match?.[1]?.trim() ?? "";
}

function parseFactLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.replace(/^- /, "").trim())
    .filter(Boolean);
}

function parseRelatedIds(markdown: string, folderPath: string): string[] {
  const body = sectionBody(markdown, "Related");
  const ids = new Set<string>();

  for (const match of body.matchAll(WIKI_LINK)) {
    const rawTarget = match[1].trim().replace(/\.md$/i, "");
    const normalizedTarget = rawTarget.includes("/") ? rawTarget : `${folderPath}/${rawTarget}`;
    ids.add(basenameWithoutExtension(normalizedTarget));
  }

  return Array.from(ids);
}

function noteSortTimestamp(note: StoredMemoryNote, now: Date): number {
  const candidate = note.kind === "event" ? note.eventDate : undefined;
  if (candidate) {
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  const updated = Date.parse(note.updatedAt);
  if (!Number.isNaN(updated)) {
    return updated;
  }

  return now.getTime();
}

function recencyBoost(note: StoredMemoryNote, now: Date): number {
  const diffDays = Math.max(0, (now.getTime() - noteSortTimestamp(note, now)) / (24 * 60 * 60 * 1000));
  return Math.max(0, 1 - diffDays / 90);
}

function summarizeConversation(messages: ChatMessage[]): string | undefined {
  const summary = messages
    .filter((message) => message.role !== "status")
    .slice(-6)
    .map((message) => {
      const speaker = message.role === "user" ? "用户" : message.petId ?? "宠物";
      return `${speaker}: ${clip(message.text.replace(/\s+/g, " ").trim(), 90)}`;
    });

  return summary.length > 0 ? summary.join("\n") : undefined;
}

function isExplicitMemoryQuery(query: string): boolean {
  const normalized = query.trim();
  if (!normalized) {
    return false;
  }

  return MEMORY_QUERY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function thingTypeKeywords(type: ThingPrimaryType): string[] {
  switch (type) {
    case "person":
      return ["人", "谁", "朋友", "同学", "老师", "家人"];
    case "animal":
      return ["动物", "猫", "狗", "宠物"];
    case "place":
      return ["地方", "地点", "哪里", "在哪", "诊所", "学校", "家"];
    case "object":
      return ["东西", "对象", "项目", "计划", "作品"];
    case "organization":
      return ["组织", "团队", "机构", "项目组"];
    case "other":
      return ["其他"];
  }
}

function resolveLinkedTitles(graph: MemoryGraph, ids: string[]): string[] {
  const titles = new Set<string>();
  ids.forEach((id) => {
    const note = graph.notesById.get(id);
    if (!note) {
      return;
    }
    titles.add(note.title);
    note.aliases.forEach((alias) => titles.add(alias));
  });
  return Array.from(titles);
}

function scoreBroadDirectHit(note: StoredMemoryNote, graph: MemoryGraph, query: string, tokens: string[], now: Date): number {
  const normalizedQuery = normalizeText(query);
  const phrases = [note.title, ...note.aliases].map((item) => normalizeText(item)).filter((item) => item.length >= 2);
  let score = 0;

  phrases.forEach((phrase) => {
    if (normalizedQuery.includes(phrase)) {
      score += 8;
    }
  });

  tokens.forEach((token) => {
    if (normalizeText(note.title).includes(token)) {
      score += 2.5;
    }
    if (note.aliases.some((alias) => normalizeText(alias).includes(token))) {
      score += 2;
    }
    if (normalizeText(note.summary).includes(token)) {
      score += 1;
    }
    if (note.facts.some((fact) => normalizeText(fact).includes(token))) {
      score += 0.75;
    }
  });

  if (note.kind === "thing") {
    const tagTokens = note.thingTags.map((tag) => normalizeText(tag));
    tokens.forEach((token) => {
      if (tagTokens.includes(token.replace(/^#/, ""))) {
        score += 3;
      }
    });
    if (thingTypeKeywords(note.thingType ?? "other").some((item) => query.includes(item))) {
      score += 1.2;
    }
  } else {
    tokens.forEach((token) => {
      if (note.eventDate?.toLowerCase().includes(token)) {
        score += 1.5;
      }
      if (note.feelingTags.some((tag) => normalizeText(tag).includes(token))) {
        score += 2.25;
      }
    });

    const linkedTitles = resolveLinkedTitles(graph, [...note.thingIds, ...note.placeIds]).map((title) => normalizeText(title));
    tokens.forEach((token) => {
      if (linkedTitles.some((title) => title.includes(token))) {
        score += 2.25;
      }
    });

    if (query.includes("感受") || query.includes("心情")) {
      score += note.feelingTags.length > 0 ? 1.2 : 0;
    }
    if (query.includes("地点") || query.includes("哪里")) {
      score += note.placeIds.length > 0 ? 1.2 : 0;
    }
    if (query.includes("时间") || query.includes("哪天")) {
      score += note.eventDate ? 1.2 : 0;
    }
  }

  score += recencyBoost(note, now) * 2;
  return score;
}

function scoreFocusedDirectHit(note: StoredMemoryNote, query: string): number {
  const normalizedQuery = normalizeText(query);
  const phrases = [note.title, ...note.aliases].map((item) => normalizeText(item)).filter((item) => item.length >= 2);
  let score = 0;

  phrases.forEach((phrase) => {
    if (normalizedQuery.includes(phrase)) {
      if (note.kind === "thing") {
        score = Math.max(score, phrase === normalizeText(note.title) ? 16 : 14);
      } else {
        score = Math.max(score, phrase === normalizeText(note.title) ? 12 : 10);
      }
    }
  });

  return score;
}

function expandGraph(
  graph: MemoryGraph,
  directScores: Map<string, number>,
): Map<string, { score: number; depth: number }> {
  const results = new Map<string, { score: number; depth: number }>();
  const queue: Array<{ id: string; originScore: number; depth: number }> = [];

  directScores.forEach((score, id) => {
    results.set(id, { score, depth: 0 });
    queue.push({ id, originScore: score, depth: 0 });
  });

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= 2) {
      continue;
    }

    const decay = current.depth === 0 ? 0.5 : 0.25;
    const nextScore = current.originScore * decay;
    const neighbors = new Set<string>([
      ...(graph.outgoing.get(current.id) ?? new Set<string>()),
      ...(graph.incoming.get(current.id) ?? new Set<string>()),
    ]);

    neighbors.forEach((neighborId) => {
      const existing = results.get(neighborId);
      const nextDepth = current.depth + 1;
      if (!existing || nextScore > existing.score) {
        results.set(neighborId, { score: nextScore, depth: nextDepth });
        queue.push({ id: neighborId, originScore: current.originScore, depth: nextDepth });
      }
    });
  }

  return results;
}

function thingTypeLabel(type: ThingPrimaryType | undefined): string {
  switch (type) {
    case "person":
      return "人";
    case "animal":
      return "动物";
    case "place":
      return "地点";
    case "object":
      return "对象";
    case "organization":
      return "组织";
    default:
      return "事物";
  }
}

function formatCapsule(note: StoredMemoryNote, graph: MemoryGraph): string {
  if (note.kind === "thing") {
    const relationTitles = resolveLinkedTitles(graph, note.relatedIds).slice(0, 2);
    const relationText = relationTitles.length > 0 ? `；关联 ${relationTitles.join("、")}` : "";
    return `[事物/${thingTypeLabel(note.thingType)}] ${note.title}: ${clip(note.summary, 90)}${relationText}`;
  }

  const parts: string[] = [];
  if (note.eventDate) {
    parts.push(note.eventDate);
  }
  const places = resolveLinkedTitles(graph, note.placeIds).slice(0, 2);
  if (places.length > 0) {
    parts.push(`地点 ${places.join("、")}`);
  }
  if (note.feelingTags.length > 0) {
    parts.push(`感受 ${note.feelingTags.join("、")}`);
  }
  const things = resolveLinkedTitles(graph, note.thingIds).slice(0, 3);
  if (things.length > 0) {
    parts.push(`关联 ${things.join("、")}`);
  }
  return `[事情] ${note.title}: ${parts.join("；") || clip(note.summary, 90)}`;
}

function formatDetail(note: StoredMemoryNote, graph: MemoryGraph, includeFacts: boolean): string {
  const lines = [note.summary];
  if (note.kind === "thing") {
    if (note.thingTags.length > 0) {
      lines.push(`标签: ${note.thingTags.join("、")}`);
    }
    const relations = resolveLinkedTitles(graph, note.relatedIds).slice(0, 4);
    if (relations.length > 0) {
      lines.push(`关联: ${relations.join("、")}`);
    }
  } else {
    if (note.eventDate) {
      lines.push(`时间: ${note.eventDate}`);
    }
    const places = resolveLinkedTitles(graph, note.placeIds);
    if (places.length > 0) {
      lines.push(`地点: ${places.join("、")}`);
    }
    if (note.feelingTags.length > 0) {
      lines.push(`感受: ${note.feelingTags.join("、")}`);
    }
    const things = resolveLinkedTitles(graph, note.thingIds);
    if (things.length > 0) {
      lines.push(`关联事物: ${things.join("、")}`);
    }
  }
  if (includeFacts) {
    note.facts.slice(0, 4).forEach((fact) => lines.push(`- ${fact}`));
  }
  if (note.sourcePaths.length > 0) {
    lines.push(`Sources: ${note.sourcePaths.join(", ")}`);
  }
  return lines.join("\n");
}

export function normalizeMemoryIndexState(value: unknown, memoryFolderPath: string): MemoryIndexState {
  const candidate = value as Partial<MemoryIndexState> & { records?: unknown; scannedFiles?: unknown; lastScanAt?: number };
  const isLegacy =
    Array.isArray(candidate?.records) ||
    typeof candidate?.lastScanAt === "number" ||
    candidate?.scannedFiles !== undefined ||
    candidate?.schemaVersion !== MEMORY_SCHEMA_VERSION;
  if (isLegacy) {
    return {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      lastSyncAt: 0,
      lastIndexedCommit: "",
      sourceFiles: {},
      memoryFolderPath,
      activeMemoryCount: 0,
      archivedMemoryCount: 0,
    };
  }

  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    lastSyncAt: typeof candidate?.lastSyncAt === "number" ? candidate.lastSyncAt : 0,
    lastIndexedCommit: typeof candidate?.lastIndexedCommit === "string" ? candidate.lastIndexedCommit : "",
    sourceFiles: candidate?.sourceFiles ?? {},
    memoryFolderPath: typeof candidate?.memoryFolderPath === "string" ? candidate.memoryFolderPath : memoryFolderPath,
    activeMemoryCount: typeof candidate?.activeMemoryCount === "number" ? candidate.activeMemoryCount : 0,
    archivedMemoryCount: typeof candidate?.archivedMemoryCount === "number" ? candidate.archivedMemoryCount : 0,
  };
}

export function buildMemoryNotePath(memoryFolderPath: string, note: Pick<StoredMemoryNote, "kind" | "title" | "memoryId" | "archived">): string {
  const folder = note.archived ? `${memoryFolderPath}/archive` : memoryFolderPath;
  return `${folder}/${note.kind}-${slugify(note.title)}-${note.memoryId.slice(-8)}.md`;
}

export function buildMemoryNoteMarkdown(note: StoredMemoryNote): string {
  const folderPath = note.archived ? folderOf(folderOf(note.filePath)) || "memory" : folderOf(note.filePath) || "memory";
  const relatedLines = note.relatedIds.length > 0
    ? note.relatedIds.map((id) => `- [[${folderPath}/${id}|${id}]]`).join("\n")
    : "- None";
  const sourceLines = note.sourcePaths.length > 0
    ? note.sourcePaths.map((path) => `- [[${path.replace(/\.md$/i, "")}]]`).join("\n")
    : "- None";

  return [
    "---",
    `memory_id: ${JSON.stringify(note.memoryId)}`,
    `kind: ${JSON.stringify(note.kind)}`,
    `title: ${JSON.stringify(note.title)}`,
    `aliases: ${JSON.stringify(note.aliases)}`,
    `thing_type: ${JSON.stringify(note.thingType ?? "")}`,
    `thing_tags: ${JSON.stringify(note.thingTags)}`,
    `event_date: ${JSON.stringify(note.eventDate ?? "")}`,
    `place_ids: ${JSON.stringify(note.placeIds)}`,
    `feeling_tags: ${JSON.stringify(note.feelingTags)}`,
    `thing_ids: ${JSON.stringify(note.thingIds)}`,
    `source_paths: ${JSON.stringify(note.sourcePaths)}`,
    `source_hashes: ${JSON.stringify(note.sourceHashes)}`,
    `related_ids: ${JSON.stringify(note.relatedIds)}`,
    `archived: ${note.archived ? "true" : "false"}`,
    `generated_at: ${JSON.stringify(note.generatedAt)}`,
    `updated_at: ${JSON.stringify(note.updatedAt)}`,
    "---",
    `# ${note.title}`,
    "",
    note.summary,
    "",
    "## Facts",
    ...(note.facts.length > 0 ? note.facts.map((fact) => `- ${fact}`) : ["- None"]),
    "",
    "## Related",
    relatedLines,
    "",
    "## Sources",
    sourceLines,
    "",
  ].join("\n");
}

export function parseMemoryNoteMarkdown(filePath: string, markdown: string): StoredMemoryNote | null {
  const frontmatter = parseFrontmatter(markdown);
  const kind = typeof frontmatter.kind === "string" && (frontmatter.kind === "thing" || frontmatter.kind === "event") ? frontmatter.kind : undefined;
  const legacyCategory = typeof frontmatter.category === "string" ? frontmatter.category : undefined;
  const parsedKind: MemoryNodeKind | undefined = kind ?? (legacyCategory === "event" || legacyCategory === "activity" ? "event" : legacyCategory ? "thing" : undefined);
  if (!parsedKind) {
    return null;
  }

  const memoryId = typeof frontmatter.memory_id === "string" ? frontmatter.memory_id : basenameWithoutExtension(filePath);
  const title = typeof frontmatter.title === "string" ? frontmatter.title : basenameWithoutExtension(filePath);
  const aliases = parseStringArray(frontmatter.aliases);
  const sourcePaths = parseStringArray(frontmatter.source_paths);
  const sourceHashes =
    frontmatter.source_hashes && typeof frontmatter.source_hashes === "object" && !Array.isArray(frontmatter.source_hashes)
      ? Object.fromEntries(
          Object.entries(frontmatter.source_hashes).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
      : {};
  const relatedFromFrontmatter = parseStringArray(frontmatter.related_ids);
  const relatedIds = Array.from(
    new Set<string>([
      ...relatedFromFrontmatter,
      ...parseRelatedIds(markdown, folderOf(filePath) || "memory"),
    ]),
  );

  return {
    schemaVersion: kind ? MEMORY_SCHEMA_VERSION : MEMORY_SCHEMA_VERSION - 1,
    memoryId,
    title,
    kind: parsedKind,
    aliases,
    summary: FRONTMATTER_BLOCK.test(markdown)
      ? markdown.replace(FRONTMATTER_BLOCK, "").split(/\r?\n## /)[0].replace(/^# [^\r\n]+\r?\n?/, "").trim()
      : "",
    facts: parseFactLines(sectionBody(markdown, "Facts")),
    sourcePaths,
    sourceHashes,
    relatedIds,
    archived: Boolean(frontmatter.archived) || filePath.includes("/archive/"),
    generatedAt: typeof frontmatter.generated_at === "string" ? frontmatter.generated_at : new Date(0).toISOString(),
    updatedAt: typeof frontmatter.updated_at === "string" ? frontmatter.updated_at : new Date(0).toISOString(),
    filePath,
    thingType:
      parsedKind === "thing"
        ? kind
          ? sanitizeThingType(frontmatter.thing_type)
          : mapLegacyCategoryToThingType(legacyCategory ?? "other")
        : undefined,
    thingTags: kind ? parseStringArray(frontmatter.thing_tags) : parseStringArray(frontmatter.tags),
    eventDate:
      parsedKind === "event"
        ? kind
          ? typeof frontmatter.event_date === "string" && frontmatter.event_date ? frontmatter.event_date : undefined
          : typeof frontmatter.memory_date === "string" && frontmatter.memory_date ? frontmatter.memory_date : undefined
        : undefined,
    placeIds: kind ? parseStringArray(frontmatter.place_ids) : [],
    feelingTags: kind ? parseStringArray(frontmatter.feeling_tags) : [],
    thingIds: kind ? parseStringArray(frontmatter.thing_ids) : [],
  };
}

export function buildMemoryGraph(notes: StoredMemoryNote[]): MemoryGraph {
  const activeNotes = notes.filter((note) => !note.archived);
  const notesById = new Map(activeNotes.map((note) => [note.memoryId, note]));
  const pathIndex = new Map(activeNotes.map((note) => [basenameWithoutExtension(note.filePath), note.memoryId]));
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();

  activeNotes.forEach((note) => {
    const neighbors = new Set<string>();
    [...note.relatedIds, ...(note.kind === "event" ? [...note.thingIds, ...note.placeIds] : [])].forEach((id) => {
      const resolved = notesById.has(id) ? id : pathIndex.get(id);
      if (resolved && resolved !== note.memoryId) {
        neighbors.add(resolved);
      }
    });
    outgoing.set(note.memoryId, neighbors);
  });

  outgoing.forEach((neighbors, noteId) => {
    neighbors.forEach((neighborId) => {
      if (!incoming.has(neighborId)) {
        incoming.set(neighborId, new Set<string>());
      }
      incoming.get(neighborId)!.add(noteId);
    });
  });

  return {
    notesById,
    outgoing,
    incoming,
  };
}

export function buildMemoryContext(options: {
  graph: MemoryGraph;
  query: string;
  conversation: ChatMessage[];
  now?: Date;
}): MemoryContext {
  const now = options.now ?? new Date();
  const sessionSummary = summarizeConversation(options.conversation);
  const notes = Array.from(options.graph.notesById.values());
  const explicit = isExplicitMemoryQuery(options.query);
  const tokens = tokenize(options.query);
  const directScores = new Map<string, number>();

  notes.forEach((note) => {
    const score = explicit
      ? scoreBroadDirectHit(note, options.graph, options.query, tokens, now)
      : scoreFocusedDirectHit(note, options.query);
    if (score > 0) {
      directScores.set(note.memoryId, score);
    }
  });

  if (directScores.size === 0) {
    return {
      relevant: false,
      capsules: [],
      details: [],
      sessionSummary,
      mode: "none",
    };
  }

  const expanded = expandGraph(options.graph, directScores);
  const sorted = Array.from(expanded.entries())
    .map(([id, rank]) => ({ note: options.graph.notesById.get(id)!, ...rank }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return noteSortTimestamp(right.note, now) - noteSortTimestamp(left.note, now);
    });

  const selected: typeof sorted = [];
  let depthTwoCount = 0;
  for (const item of sorted) {
    if (selected.length >= 6) {
      break;
    }
    if (item.depth >= 2) {
      if (depthTwoCount >= 2) {
        continue;
      }
      depthTwoCount += 1;
    }
    selected.push(item);
  }

  const capsules = selected.map<MemoryContextEntry>((item) => ({
    id: item.note.memoryId,
    title: item.note.title,
    path: item.note.filePath,
    summary: item.note.summary,
    text: formatCapsule(item.note, options.graph),
    kind: item.note.kind,
    thingType: item.note.thingType,
    depth: item.depth,
    score: item.score,
    sourcePaths: item.note.sourcePaths,
  }));

  const sortedDirectHits = Array.from(directScores.entries())
    .map(([id, score]) => ({ note: options.graph.notesById.get(id)!, score }))
    .sort((left, right) => right.score - left.score);
  const directHits =
    explicit
      ? (() => {
          const selected: typeof sortedDirectHits = [];
          const topThing = sortedDirectHits.find((item) => item.note.kind === "thing");
          const topEvent = sortedDirectHits.find((item) => item.note.kind === "event");
          if (topThing) {
            selected.push(topThing);
          }
          if (topEvent && !selected.some((item) => item.note.memoryId === topEvent.note.memoryId)) {
            selected.push(topEvent);
          }
          for (const item of sortedDirectHits) {
            if (selected.length >= 2) {
              break;
            }
            if (!selected.some((existing) => existing.note.memoryId === item.note.memoryId)) {
              selected.push(item);
            }
          }
          return selected.slice(0, 2);
        })()
      : sortedDirectHits.slice(0, 2);

  const details = directHits.map<MemoryContextEntry>((item) => ({
    id: item.note.memoryId,
    title: item.note.title,
    path: item.note.filePath,
    summary: item.note.summary,
    text: formatDetail(item.note, options.graph, explicit),
    kind: item.note.kind,
    thingType: item.note.thingType,
    depth: 0,
    score: item.score,
    sourcePaths: item.note.sourcePaths,
  }));

  return {
    relevant: true,
    capsules,
    details,
    sessionSummary,
    mode: explicit ? "broad" : "focused",
  };
}
