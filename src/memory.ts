import { normalizePath, TFile } from "obsidian";

import type {
  ChatMessage,
  MemoryContext,
  MemoryQuery,
  MemoryRecord,
  MemorySnapshot,
  PetAgentId,
} from "./types";

const MEMORY_SCHEMA_VERSION = 1;
const DETAIL_HINT = /细节|详细|原文|原话|哪天|当时|时间线|具体|展开|怎么写|发生了什么|回忆/i;
const DIARY_FILE_HINT = /daily|journal|diary|log|日记|日志|daily notes/i;
const DATE_BASENAME = /\d{4}[-_./]\d{1,2}[-_./]\d{1,2}/;

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff]+/gu, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  );
}

function clip(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function fileLooksLikeDiary(path: string, hints: string[]): boolean {
  const lowerPath = path.toLowerCase();
  return hints.some((hint) => lowerPath.includes(hint.toLowerCase())) || DIARY_FILE_HINT.test(path) || DATE_BASENAME.test(path);
}

function derivePetBias(path: string, text: string, isDiary: boolean): PetAgentId[] {
  const lower = `${path}\n${text}`.toLowerCase();
  const hits = new Set<PetAgentId>();

  if (isDiary || /心情|感受|关系|朋友|焦虑|开心|难过|烦|共鸣|情绪/i.test(lower)) {
    hits.add("homie-rabbit");
  }
  if (/论文|研究|概念|理论|实验|课程|学习|学术|读书|知识/i.test(lower)) {
    hits.add("scholar-panda");
  }
  if (/项目|插件|代码|系统|架构|bug|任务|实现|obsidian|仓库|api|发布/i.test(lower)) {
    hits.add("engineer-mole");
  }

  if (hits.size === 0) {
    hits.add(isDiary ? "homie-rabbit" : "engineer-mole");
  }

  return Array.from(hits);
}

function importanceScore(path: string, text: string, isDiary: boolean): number {
  let score = Math.min(1, text.length / 260);
  if (isDiary) {
    score += 0.3;
  }
  if (/喜欢|讨厌|决定|计划|目标|必须|约定|提醒|重要|失败|完成/i.test(text)) {
    score += 0.25;
  }
  if (/项目|代码|论文|研究|任务|想法|感受/i.test(`${path}\n${text}`)) {
    score += 0.2;
  }
  return Math.min(1.5, score);
}

function extractTitle(content: string, fallback: string): string {
  const heading = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("# "));
  return heading ? heading.slice(2).trim() : fallback;
}

function splitSegments(content: string): string[] {
  return content
    .split(/\n{2,}/)
    .map((segment) => segment.replace(/\r/g, "").trim())
    .filter((segment) => segment.length >= 20)
    .slice(0, 14);
}

function summarizeSegment(text: string): string {
  return clip(text.replace(/\s+/g, " ").trim(), 120);
}

function semanticLine(title: string, segment: string): string {
  return `${title}: ${clip(segment.replace(/\s+/g, " ").trim(), 96)}`;
}

function shouldIncludeFile(path: string, whitelist: string[], hints: string[]): boolean {
  const normalized = normalizePath(path).toLowerCase();
  if (whitelist.length > 0 && whitelist.some((root) => normalized.startsWith(normalizePath(root).toLowerCase()))) {
    return true;
  }
  return fileLooksLikeDiary(path, hints);
}

export interface MemoryHost {
  app: {
    vault: {
      getMarkdownFiles(): TFile[];
      cachedRead(file: TFile): Promise<string>;
    };
  };
  settings: {
    memoryWhitelistPaths: string[];
    diaryFolderHints: string[];
    memoryCapsuleLimit: number;
    memoryDetailLimit: number;
  };
  schedulePersist(): void;
}

export class LayeredMemoryService {
  snapshot: MemorySnapshot;

  constructor(private readonly host: MemoryHost, snapshot?: MemorySnapshot) {
    this.snapshot = snapshot ?? {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      lastScanAt: 0,
      records: [],
      scannedFiles: {},
    };
  }

  async initialize(): Promise<void> {
    if (this.snapshot.schemaVersion !== MEMORY_SCHEMA_VERSION) {
      this.snapshot = {
        schemaVersion: MEMORY_SCHEMA_VERSION,
        lastScanAt: 0,
        records: [],
        scannedFiles: {},
      };
    }
    await this.fullScan(false);
  }

  async fullScan(force: boolean): Promise<void> {
    const files = this.host.app.vault.getMarkdownFiles();
    const whitelist = this.host.settings.memoryWhitelistPaths;
    const hints = this.host.settings.diaryFolderHints;
    const nextRecords: MemoryRecord[] = [];
    const nextScannedFiles: Record<string, number> = {};

    for (const file of files) {
      if (!shouldIncludeFile(file.path, whitelist, hints)) {
        continue;
      }

      if (!force && this.snapshot.scannedFiles[file.path] === file.stat.mtime) {
        nextRecords.push(...this.snapshot.records.filter((record) => record.path === file.path));
        nextScannedFiles[file.path] = file.stat.mtime;
        continue;
      }

      const content = await this.host.app.vault.cachedRead(file);
      nextRecords.push(...this.buildRecords(file, content));
      nextScannedFiles[file.path] = file.stat.mtime;
    }

    this.snapshot = {
      schemaVersion: MEMORY_SCHEMA_VERSION,
      lastScanAt: Date.now(),
      records: nextRecords,
      scannedFiles: nextScannedFiles,
    };
    this.host.schedulePersist();
  }

  async refreshFile(file: TFile): Promise<void> {
    if (!shouldIncludeFile(file.path, this.host.settings.memoryWhitelistPaths, this.host.settings.diaryFolderHints)) {
      return;
    }

    const content = await this.host.app.vault.cachedRead(file);
    this.snapshot.records = this.snapshot.records.filter((record) => record.path !== file.path).concat(this.buildRecords(file, content));
    this.snapshot.scannedFiles[file.path] = file.stat.mtime;
    this.snapshot.lastScanAt = Date.now();
    this.host.schedulePersist();
  }

  removePath(path: string): void {
    this.snapshot.records = this.snapshot.records.filter((record) => record.path !== path);
    delete this.snapshot.scannedFiles[path];
    this.snapshot.lastScanAt = Date.now();
    this.host.schedulePersist();
  }

  buildContext(query: MemoryQuery): MemoryContext {
    const queryTokens = tokenize(query.query);
    const detailRequested = DETAIL_HINT.test(query.query);
    const semanticMatches = this.snapshot.records
      .filter((record) => record.tier === "semantic")
      .map((record) => ({
        record,
        score: this.scoreRecord(record, queryTokens, query.petId),
      }))
      .filter((item) => item.score > 0.15)
      .sort((left, right) => right.score - left.score)
      .slice(0, this.host.settings.memoryCapsuleLimit);

    const detailIds = new Set(semanticMatches.map((item) => item.record.sourceId).filter(Boolean));
    const details = detailRequested
      ? this.snapshot.records
          .filter((record) => record.tier === "episodic" && detailIds.has(record.id))
          .sort((left, right) => right.importance - left.importance)
          .slice(0, this.host.settings.memoryDetailLimit)
      : [];

    return {
      capsules: semanticMatches.map((item) => item.record),
      details,
      sessionSummary: this.summarizeConversation(query.conversation),
    };
  }

  private buildRecords(file: TFile, content: string): MemoryRecord[] {
    const isDiary = fileLooksLikeDiary(file.path, this.host.settings.diaryFolderHints);
    const title = extractTitle(content, file.basename);
    const segments = splitSegments(content);
    const records: MemoryRecord[] = [];

    segments.forEach((segment, index) => {
      const id = `${file.path}#${index}`;
      const updatedAt = file.stat.mtime;
      const summary = summarizeSegment(segment);
      const keywords = tokenize(`${title}\n${segment}`);
      const tags = Array.from(new Set((segment.match(/#[\p{Letter}\p{Number}_/-]+/gu) ?? []).map((tag) => tag.slice(1))));
      const petBias = derivePetBias(file.path, segment, isDiary);
      const importance = importanceScore(file.path, segment, isDiary);
      const dateHint = DATE_BASENAME.exec(file.path)?.[0];

      records.push({
        id,
        tier: "episodic",
        path: file.path,
        title,
        text: segment,
        summary,
        keywords,
        tags,
        petBias,
        createdAt: updatedAt,
        updatedAt,
        importance,
        dateHint,
      });

      records.push({
        id: `${id}:semantic`,
        tier: "semantic",
        path: file.path,
        title,
        text: semanticLine(title, segment),
        summary,
        keywords,
        tags,
        petBias,
        createdAt: updatedAt,
        updatedAt,
        importance: Math.min(1.2, importance + 0.2),
        sourceId: id,
        dateHint,
      });
    });

    return records;
  }

  private scoreRecord(record: MemoryRecord, queryTokens: string[], petId: PetAgentId): number {
    const overlap = queryTokens.filter((token) => record.keywords.includes(token)).length;
    const overlapScore = queryTokens.length > 0 ? overlap / queryTokens.length : 0;
    const biasScore = record.petBias.includes(petId) ? 0.35 : 0;
    const recencyDays = Math.max(1, (Date.now() - record.updatedAt) / (1000 * 60 * 60 * 24));
    const recencyScore = 0.25 / Math.log2(recencyDays + 2);
    return overlapScore + biasScore + recencyScore + record.importance * 0.2;
  }

  private summarizeConversation(messages: ChatMessage[]): string | undefined {
    const summary = messages
      .filter((message) => message.role !== "status")
      .slice(-6)
      .map((message) => {
        const speaker = message.role === "user" ? "用户" : message.petId ? this.displayPetName(message.petId) : "宠物";
        return `${speaker}: ${clip(message.text.replace(/\s+/g, " ").trim(), 90)}`;
      });

    return summary.length > 0 ? summary.join("\n") : undefined;
  }

  private displayPetName(petId: PetAgentId): string {
    if (petId === "engineer-mole") {
      return "工程鼠";
    }
    if (petId === "scholar-panda") {
      return "博士熊";
    }
    return "机灵兔";
  }
}
