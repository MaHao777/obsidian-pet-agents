import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDisplayUserInput,
  buildPromptUserInput,
  createFileAttachmentSnapshot,
  upsertComposerAttachment,
} from "../src/composer-attachments.ts";
import type { ComposerAttachment, SkillAttachment } from "../src/types.ts";

test("prompt formatter expands selected context, files, skills, and raw input in fixed order", () => {
  const fileAttachment = createFileAttachmentSnapshot({
    path: "Projects/Alpha.md",
    source: "current-file",
    content: "# Alpha\n\nCurrent project notes.",
  });
  const skillAttachment: SkillAttachment = {
    kind: "skill",
    name: "writing-plans",
    description: "Use when you have a spec or requirements for a multi-step task.",
    path: "C:\\Users\\20309\\.codex\\skills\\writing-plans\\SKILL.md",
  };

  const formatted = buildPromptUserInput({
    selectedContext: {
      text: "把这里的函数拆出来",
      sourceLabel: "Projects/Alpha.md",
    },
    attachments: [fileAttachment, skillAttachment],
    rawInput: "请先规划，再实现。",
  });

  const selectedIndex = formatted.indexOf("[当前选中文本]");
  const fileIndex = formatted.indexOf("[文件附件 1]");
  const skillIndex = formatted.indexOf("[Skill 指令 1]");
  const rawInputIndex = formatted.indexOf("[用户原始输入]");

  assert.notEqual(selectedIndex, -1);
  assert.notEqual(fileIndex, -1);
  assert.notEqual(skillIndex, -1);
  assert.notEqual(rawInputIndex, -1);
  assert.equal(selectedIndex < fileIndex && fileIndex < skillIndex && skillIndex < rawInputIndex, true);
  assert.match(formatted, /来源类型: 当前文件/);
  assert.match(formatted, /Vault 路径: Projects\/Alpha\.md/);
  assert.match(formatted, /本轮请先使用该 skill/);
});

test("upsertComposerAttachment replaces a file attachment with the same path", () => {
  const first = createFileAttachmentSnapshot({
    path: "Projects/Alpha.md",
    source: "file",
    content: "old snapshot",
  });
  const second = createFileAttachmentSnapshot({
    path: "Projects/Alpha.md",
    source: "file",
    content: "new snapshot",
  });

  const attachments = upsertComposerAttachment([first], second);

  assert.equal(attachments.length, 1);
  assert.equal((attachments[0] as Extract<ComposerAttachment, { kind: "file" }>).content.includes("new snapshot"), true);
});

test("createFileAttachmentSnapshot marks oversized file content as truncated", () => {
  const attachment = createFileAttachmentSnapshot({
    path: "Projects/Large.md",
    source: "file",
    content: "a".repeat(8000),
  });

  assert.equal(attachment.truncated, true);
  assert.match(attachment.content, /\[内容已截断，原文更长\]/);
});

test("display formatter summarizes attachments without inlining full file contents", () => {
  const fileAttachment = createFileAttachmentSnapshot({
    path: "Projects/Alpha.md",
    source: "file",
    content: "secret body",
  });
  const skillAttachment: SkillAttachment = {
    kind: "skill",
    name: "writing-plans",
    description: "Use when you have a spec or requirements for a multi-step task.",
    path: "C:\\Users\\20309\\.codex\\skills\\writing-plans\\SKILL.md",
  };

  const display = buildDisplayUserInput({
    selectedContext: {
      text: "这里要保留",
      sourceLabel: "Projects/Alpha.md",
    },
    attachments: [fileAttachment, skillAttachment],
    rawInput: "请处理。",
  });

  assert.match(display, /\[指定文件\] Projects\/Alpha\.md/);
  assert.match(display, /\[Skill\] writing-plans/);
  assert.doesNotMatch(display, /secret body/);
});
