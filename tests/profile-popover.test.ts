import test from "node:test";
import assert from "node:assert/strict";

import { computeProfilePopoverPosition, shouldHideProfilePopover } from "../src/profile-popover.ts";

test("computeProfilePopoverPosition keeps the popover inside the viewport", () => {
  const position = computeProfilePopoverPosition({
    anchorX: 680,
    anchorY: 500,
    popoverWidth: 260,
    popoverHeight: 180,
    viewportWidth: 700,
    viewportHeight: 540,
    offset: 12,
    margin: 8,
  });

  assert.deepEqual(position, {
    left: 408,
    top: 332,
  });
});

test("shouldHideProfilePopover only hides when pointer leaves both trigger and popover", () => {
  const triggerRect = {
    left: 20,
    top: 40,
    right: 48,
    bottom: 68,
  };
  const popoverRect = {
    left: 64,
    top: 32,
    right: 264,
    bottom: 220,
  };

  assert.equal(shouldHideProfilePopover({ x: 30, y: 50 }, triggerRect, popoverRect), false);
  assert.equal(shouldHideProfilePopover({ x: 100, y: 80 }, triggerRect, popoverRect), false);
  assert.equal(shouldHideProfilePopover({ x: 320, y: 260 }, triggerRect, popoverRect), true);
});
