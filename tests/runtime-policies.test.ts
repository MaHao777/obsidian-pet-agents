import test from "node:test";
import assert from "node:assert/strict";

import { resolveExecutionPolicy } from "../src/runtime-policies.ts";

test("chat mode is always read-only", () => {
  assert.equal(resolveExecutionPolicy("chat", "danger-full-access"), "read-only");
  assert.equal(resolveExecutionPolicy("chat", "workspace-write"), "read-only");
});

test("task mode is always elevated to danger-full-access", () => {
  assert.equal(resolveExecutionPolicy("task", "read-only"), "danger-full-access");
  assert.equal(resolveExecutionPolicy("task", "workspace-write"), "danger-full-access");
  assert.equal(resolveExecutionPolicy("task", "danger-full-access"), "danger-full-access");
});
