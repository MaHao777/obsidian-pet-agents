import test from "node:test";
import assert from "node:assert/strict";

import { refreshLayeredMemoryFromSlash } from "../src/slash-actions.ts";

test("refreshLayeredMemoryFromSlash forces a rescan and refreshes the view state", async () => {
  const calls: boolean[] = [];
  let refreshCount = 0;
  const host = {
    memoryService: {
      async fullScan(force: boolean): Promise<void> {
        calls.push(force);
      },
    },
    runtimeState: {
      statusText: "",
    },
    refreshViews(): void {
      refreshCount += 1;
    },
  };

  await refreshLayeredMemoryFromSlash(host);

  assert.deepEqual(calls, [true]);
  assert.match(host.runtimeState.statusText, /记忆/);
  assert.equal(refreshCount, 1);
});
