import test from "node:test";
import assert from "node:assert/strict";

import {
  applySlashSuggestion,
  findMentionTrigger,
  findSlashTrigger,
  getSlashSuggestions,
} from "../src/composer.ts";

test("findSlashTrigger matches a bare slash command trigger", () => {
  assert.deepEqual(findSlashTrigger("/", 1), {
    start: 0,
    end: 1,
    query: "",
  });
});

test("slash suggestions match commands embedded after normal text", () => {
  const text = "请先看 /fi";
  const trigger = findSlashTrigger(text, text.length);

  assert.deepEqual(trigger, {
    start: 4,
    end: text.length,
    query: "fi",
  });
  assert.equal(getSlashSuggestions(trigger?.query ?? "").some((item) => item.id === "file"), true);
});

test("slash and mention triggers do not interfere with each other", () => {
  assert.equal(findMentionTrigger("请先 /file", "请先 /file".length), null);
  assert.equal(findSlashTrigger("请先 @熊猫", "请先 @熊猫".length), null);
});

test("applySlashSuggestion removes the command token from the composer text", () => {
  const text = "分析一下 /current-file";
  const trigger = findSlashTrigger(text, text.length);
  assert.ok(trigger);

  const next = applySlashSuggestion(text, trigger);
  assert.equal(next.text, "分析一下 ");
  assert.equal(next.caretIndex, next.text.length);
});
