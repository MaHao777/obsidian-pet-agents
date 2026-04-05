# Chat Memory Task Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix engineer task mode reliability, redesign memory injection around diary cadence, and upgrade the chat UI to support Markdown, images, selection context, and avatar-driven controls.

**Architecture:** Keep the plugin single-bundle structure, but pull behavior into small pure helpers where possible so the new logic is testable outside Obsidian. Replace heuristic memory retrieval with rule-based time-window bundles gated by query intent, then render messages through Obsidian Markdown so text and images behave like native notes.

**Tech Stack:** TypeScript, Obsidian plugin API, esbuild, Node built-in assertions or lightweight test runner for pure helpers

---

### Task 1: Lock engineer task mode to direct execution

**Files:**
- Modify: `src/main.ts`
- Modify: `src/settings.ts`
- Modify: `src/provider.ts`

- [ ] Remove the blocking confirmation path from engineer task mode toggling and make the status text reflect immediate mode switching.
- [ ] Default engineer execution policy to `danger-full-access` and disable task confirmation in settings defaults/migration so existing data gets corrected on load.
- [ ] Ensure provider requests for engineer task mode resolve to the highest execution policy even if stale settings survive in stored data.
- [ ] Keep chat mode read-only so non-task conversations never execute commands.

### Task 2: Replace generic memory retrieval with diary cadence bundles

**Files:**
- Modify: `src/memory.ts`
- Modify: `src/main.ts`
- Modify: `src/types.ts`

- [ ] Add pure helpers to classify diary, weekly report, and monthly report files from the `日记` folder naming scheme.
- [ ] Add a memory relevance gate so unrelated questions inject no memory at all.
- [ ] When memory is relevant, inject:
- [ ] all daily diaries from the current week,
- [ ] all weekly reports from the current month,
- [ ] all monthly reports before the current month when present.
- [ ] Preserve compact summaries plus expandable detail sections so prompts stay bounded.
- [ ] Record source paths/titles in message metadata for UI inspection.

### Task 3: Rebuild composer and chat rendering

**Files:**
- Modify: `src/view.ts`
- Modify: `styles.css`

- [ ] Replace plain-text bubble rendering with Obsidian Markdown rendering for both user and assistant messages.
- [ ] Make message content explicitly selectable and preserve copy behavior.
- [ ] Remove the prominent composer settings button and replace it with a current-pet avatar trigger that opens a compact info/control popover.
- [ ] Surface pet basic info in that popover and keep existing actions reachable there.
- [ ] Add a selected-text context chip sourced from the active editor or current DOM selection, with insert/send behavior that does not break normal typing.

### Task 4: Add image-aware composer flows and regression tests

**Files:**
- Modify: `src/view.ts`
- Modify: `styles.css`
- Modify: `package.json`
- Create: `tests/memory.test.mjs`
- Create: `tests/provider.test.mjs`

- [ ] Allow paste/drop image flows in the composer by saving image files into the vault and inserting Markdown embeds into the outgoing message.
- [ ] Ensure Markdown-rendered chat messages can display inline images returned by agents or inserted by the user.
- [ ] Add test coverage for diary-window memory selection and provider execution-policy behavior.
- [ ] Run the targeted tests, then `npm run build`, then deploy and reload the Obsidian plugin in the `Note` vault.
