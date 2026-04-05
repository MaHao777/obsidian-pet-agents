import test from "node:test";
import assert from "node:assert/strict";

import { isMemoryRelevant, selectDiaryWindow } from "../src/memory-rules.ts";

test("memory is not injected for unrelated task queries", () => {
  assert.equal(isMemoryRelevant("帮我解释一下这个 TypeScript 类型错误"), false);
});

test("memory is injected for diary and recollection queries", () => {
  assert.equal(isMemoryRelevant("结合这周日记和之前周报，帮我看看最近状态"), true);
  assert.equal(isMemoryRelevant("你还记得我上周是怎么想的吗"), true);
});

test("selectDiaryWindow returns current-week dailies, current-month weeklies, and prior monthly reports", () => {
  const selection = selectDiaryWindow(
    [
      "日记/2026-03-28.md",
      "日记/2026-03-30.md",
      "日记/2026-03-31.md",
      "日记/2026-04-01.md",
      "日记/2026-04-02.md",
      "日记/2026-W13.md",
      "日记/2026-W14.md",
      "日记/2026-01月报.md",
      "日记/2026-02月报.md",
      "日记/2026-04月报.md",
    ],
    new Date("2026-04-03T10:00:00+08:00"),
  );

  assert.deepEqual(selection.currentWeekDailyPaths, [
    "日记/2026-03-30.md",
    "日记/2026-03-31.md",
    "日记/2026-04-01.md",
    "日记/2026-04-02.md",
  ]);
  assert.deepEqual(selection.currentMonthWeeklyPaths, ["日记/2026-W14.md"]);
  assert.deepEqual(selection.previousMonthlyPaths, ["日记/2026-02月报.md", "日记/2026-01月报.md"]);
});
