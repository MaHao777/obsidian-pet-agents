import type { ComposerAttachment, FileAttachment, SkillAttachment } from "./types.ts";

const MAX_FILE_ATTACHMENT_CHARS = 6000;

const TEXT_FILE_EXTENSIONS = new Set([
  "md",
  "markdown",
  "mdx",
  "txt",
  "json",
  "js",
  "cjs",
  "mjs",
  "ts",
  "tsx",
  "jsx",
  "css",
  "scss",
  "sass",
  "less",
  "html",
  "htm",
  "xml",
  "yaml",
  "yml",
  "toml",
  "ini",
  "csv",
  "log",
  "py",
  "rb",
  "java",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "rs",
  "go",
  "sh",
  "ps1",
  "sql",
  "lua",
  "php",
  "swift",
  "kt",
  "kts",
  "dart",
  "vue",
  "svelte",
]);

export interface ComposerSelectedContext {
  text: string;
  sourceLabel?: string;
}

export interface ComposerInputBuildOptions {
  selectedContext?: ComposerSelectedContext | null;
  attachments: ComposerAttachment[];
  rawInput: string;
}

export interface FileAttachmentSnapshotOptions {
  path: string;
  source: FileAttachment["source"];
  content: string;
}

function clip(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeTextSnapshot(content: string): string {
  return content.replace(/\r/g, "").trim();
}

function truncateFileAttachmentContent(content: string): { content: string; truncated: boolean } {
  const normalized = normalizeTextSnapshot(content);
  if (normalized.length <= MAX_FILE_ATTACHMENT_CHARS) {
    return {
      content: normalized,
      truncated: false,
    };
  }

  return {
    content: `${normalized.slice(0, MAX_FILE_ATTACHMENT_CHARS).trimEnd()}\n\n[内容已截断，原文更长]`,
    truncated: true,
  };
}

function fileSourceLabel(source: FileAttachment["source"]): string {
  return source === "current-file" ? "当前文件" : "指定文件";
}

function formatSelectedContextPrompt(context: ComposerSelectedContext): string {
  return [
    "[当前选中文本]",
    `来源: ${context.sourceLabel ?? "当前页面"}`,
    context.text.trim(),
  ].join("\n");
}

function formatFileAttachmentPrompt(attachment: FileAttachment, index: number): string {
  return [
    `[文件附件 ${index}]`,
    `来源类型: ${fileSourceLabel(attachment.source)}`,
    `Vault 路径: ${attachment.path}`,
    "内容:",
    attachment.content,
  ].join("\n");
}

function formatSkillAttachmentPrompt(attachment: SkillAttachment, index: number): string {
  return [
    `[Skill 指令 ${index}]`,
    "本轮请先使用该 skill，再继续完成用户请求。",
    `Skill: ${attachment.name}`,
    `描述: ${attachment.description}`,
    `SKILL.md: ${attachment.path}`,
  ].join("\n");
}

function formatSelectedContextDisplay(context: ComposerSelectedContext): string {
  return `[当前选中] ${context.sourceLabel ?? "当前页面"}`;
}

function formatAttachmentDisplay(attachment: ComposerAttachment): string {
  if (attachment.kind === "file") {
    return `[${fileSourceLabel(attachment.source)}] ${attachment.path}`;
  }

  return `[Skill] ${attachment.name}`;
}

function sameAttachment(left: ComposerAttachment, right: ComposerAttachment): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  if (left.kind === "file" && right.kind === "file") {
    return left.path === right.path;
  }

  return left.path === right.path;
}

export function isTextLikeExtension(extension: string): boolean {
  return TEXT_FILE_EXTENSIONS.has(extension.trim().toLowerCase());
}

export function createFileAttachmentSnapshot(options: FileAttachmentSnapshotOptions): FileAttachment {
  const snapshot = truncateFileAttachmentContent(options.content);
  return {
    kind: "file",
    source: options.source,
    path: options.path,
    content: snapshot.content,
    truncated: snapshot.truncated,
  };
}

export function upsertComposerAttachment(
  attachments: ComposerAttachment[],
  nextAttachment: ComposerAttachment,
): ComposerAttachment[] {
  const nextAttachments = attachments.slice();
  const existingIndex = nextAttachments.findIndex((attachment) => sameAttachment(attachment, nextAttachment));
  if (existingIndex >= 0) {
    nextAttachments.splice(existingIndex, 1, nextAttachment);
    return nextAttachments;
  }

  nextAttachments.push(nextAttachment);
  return nextAttachments;
}

export function buildPromptUserInput(options: ComposerInputBuildOptions): string {
  const blocks: string[] = [];

  if (options.selectedContext) {
    blocks.push(formatSelectedContextPrompt(options.selectedContext));
  }

  const fileAttachments = options.attachments.filter((attachment): attachment is FileAttachment => attachment.kind === "file");
  fileAttachments.forEach((attachment, index) => {
    blocks.push(formatFileAttachmentPrompt(attachment, index + 1));
  });

  const skillAttachments = options.attachments.filter(
    (attachment): attachment is SkillAttachment => attachment.kind === "skill",
  );
  skillAttachments.forEach((attachment, index) => {
    blocks.push(formatSkillAttachmentPrompt(attachment, index + 1));
  });

  blocks.push(["[用户原始输入]", options.rawInput.trim()].join("\n"));
  return blocks.filter(Boolean).join("\n\n");
}

export function buildDisplayUserInput(options: ComposerInputBuildOptions): string {
  const lines: string[] = [];

  if (options.selectedContext) {
    lines.push(formatSelectedContextDisplay(options.selectedContext));
  }

  options.attachments.forEach((attachment) => {
    lines.push(formatAttachmentDisplay(attachment));
  });

  const rawInput = options.rawInput.trim();
  if (rawInput) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(rawInput);
  }

  return lines.map((line) => clip(line, 240)).join("\n");
}
