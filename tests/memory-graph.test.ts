import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMemoryContext,
  buildMemoryGraph,
  buildMemoryNoteMarkdown,
  normalizeMemoryIndexState,
  parseMemoryNoteMarkdown,
  type StoredMemoryNote,
  type ThingPrimaryType,
} from "../src/memory-graph.ts";

function sampleThing(overrides: Partial<StoredMemoryNote> = {}): StoredMemoryNote {
  return {
    memoryId: overrides.memoryId ?? "thing-alice-1111aaaa",
    title: overrides.title ?? "Alice",
    kind: overrides.kind ?? "thing",
    aliases: overrides.aliases ?? ["艾丽丝"],
    summary: overrides.summary ?? "Alice is a close friend who studies literature in Shanghai.",
    facts: overrides.facts ?? ["Lives in Shanghai.", "Studies literature.", "Prefers quiet cafes."],
    sourcePaths: overrides.sourcePaths ?? ["日记/2026-04-01.md"],
    sourceHashes: overrides.sourceHashes ?? { "日记/2026-04-01.md": "hash-a" },
    relatedIds: overrides.relatedIds ?? ["event-cafe-meetup-2222bbbb"],
    archived: overrides.archived ?? false,
    generatedAt: overrides.generatedAt ?? "2026-04-03T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-03T10:00:00.000Z",
    filePath: overrides.filePath ?? "memory/thing-alice-1111aaaa.md",
    thingType: overrides.thingType ?? ("person" satisfies ThingPrimaryType),
    thingTags: overrides.thingTags ?? ["friend", "classmate"],
    eventDate: overrides.eventDate,
    placeIds: overrides.placeIds ?? [],
    feelingTags: overrides.feelingTags ?? [],
    thingIds: overrides.thingIds ?? [],
  };
}

function sampleEvent(overrides: Partial<StoredMemoryNote> = {}): StoredMemoryNote {
  return {
    memoryId: overrides.memoryId ?? "event-cafe-meetup-2222bbbb",
    title: overrides.title ?? "Cafe Meetup",
    kind: overrides.kind ?? "event",
    aliases: overrides.aliases ?? ["咖啡见面"],
    summary: overrides.summary ?? "A memorable cafe meetup where we discussed Project Maple.",
    facts: overrides.facts ?? ["Alice and I planned the next writing sprint.", "We left feeling optimistic."],
    sourcePaths: overrides.sourcePaths ?? ["日记/2026-04-01.md"],
    sourceHashes: overrides.sourceHashes ?? { "日记/2026-04-01.md": "hash-a" },
    relatedIds: overrides.relatedIds ?? ["thing-alice-1111aaaa", "thing-project-maple-3333cccc", "thing-west-lake-cafe-4444dddd"],
    archived: overrides.archived ?? false,
    generatedAt: overrides.generatedAt ?? "2026-04-03T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-03T10:00:00.000Z",
    filePath: overrides.filePath ?? "memory/event-cafe-meetup-2222bbbb.md",
    thingType: overrides.thingType,
    thingTags: overrides.thingTags ?? [],
    eventDate: overrides.eventDate ?? "2026-04-01",
    placeIds: overrides.placeIds ?? ["thing-west-lake-cafe-4444dddd"],
    feelingTags: overrides.feelingTags ?? ["optimistic", "focused"],
    thingIds: overrides.thingIds ?? ["thing-alice-1111aaaa", "thing-project-maple-3333cccc"],
  };
}

test("normalizeMemoryIndexState discards legacy record snapshots", () => {
  const normalized = normalizeMemoryIndexState(
    {
      schemaVersion: 1,
      lastScanAt: 1000,
      records: [{ id: "legacy" }],
      scannedFiles: { "日记/2026-04-01.md": 123 },
    },
    "memory",
  );

  assert.equal(normalized.lastSyncAt, 0);
  assert.equal(normalized.lastIndexedCommit, "");
  assert.deepEqual(normalized.sourceFiles, {});
  assert.equal(normalized.memoryFolderPath, "memory");
  assert.equal(normalized.activeMemoryCount, 0);
});

test("thing memory markdown round-trips frontmatter, facts, and wiki links", () => {
  const note = sampleThing();
  const markdown = buildMemoryNoteMarkdown(note);
  const parsed = parseMemoryNoteMarkdown(note.filePath, markdown);

  assert.ok(parsed);
  assert.equal(parsed.memoryId, note.memoryId);
  assert.equal(parsed.kind, "thing");
  assert.equal(parsed.thingType, "person");
  assert.deepEqual(parsed.thingTags, note.thingTags);
  assert.deepEqual(parsed.facts, note.facts);
  assert.deepEqual(parsed.relatedIds, note.relatedIds);
  assert.deepEqual(parsed.sourcePaths, note.sourcePaths);
  assert.match(markdown, /thing_type: "person"/);
  assert.match(markdown, /thing_tags: \["friend","classmate"\]/);
  assert.match(markdown, /\[\[memory\/event-cafe-meetup-2222bbbb\|/);
});

test("event memory markdown round-trips structured fields", () => {
  const note = sampleEvent();
  const markdown = buildMemoryNoteMarkdown(note);
  const parsed = parseMemoryNoteMarkdown(note.filePath, markdown);

  assert.ok(parsed);
  assert.equal(parsed.kind, "event");
  assert.equal(parsed.eventDate, note.eventDate);
  assert.deepEqual(parsed.placeIds, note.placeIds);
  assert.deepEqual(parsed.feelingTags, note.feelingTags);
  assert.deepEqual(parsed.thingIds, note.thingIds);
  assert.match(markdown, /event_date: "2026-04-01"/);
  assert.match(markdown, /place_ids: \["thing-west-lake-cafe-4444dddd"\]/);
  assert.match(markdown, /feeling_tags: \["optimistic","focused"\]/);
  assert.match(markdown, /thing_ids: \["thing-alice-1111aaaa","thing-project-maple-3333cccc"\]/);
});

test("focused graph recall prioritizes thing hits, expands to linked events, and excludes archived notes", () => {
  const alice = sampleThing();
  const cafe = sampleEvent();
  const maple = sampleThing({
    memoryId: "thing-project-maple-3333cccc",
    title: "Project Maple",
    summary: "A long-running writing collaboration involving Alice.",
    facts: ["The project started after the cafe meetup."],
    thingType: "object",
    thingTags: ["writing", "collaboration"],
    relatedIds: ["event-cafe-meetup-2222bbbb", "event-library-revision-5555eeee"],
    filePath: "memory/thing-project-maple-3333cccc.md",
  });
  const libraryRevision = sampleEvent({
    memoryId: "event-library-revision-5555eeee",
    title: "Library Revision",
    summary: "A later revision session at the library.",
    relatedIds: ["thing-project-maple-3333cccc", "thing-city-library-6666ffff"],
    thingIds: ["thing-project-maple-3333cccc"],
    placeIds: ["thing-city-library-6666ffff"],
    filePath: "memory/event-library-revision-5555eeee.md",
  });
  const library = sampleThing({
    memoryId: "thing-city-library-6666ffff",
    title: "City Library",
    summary: "A depth-3 place that should not be injected for an Alice query.",
    thingType: "place",
    thingTags: ["study"],
    relatedIds: ["event-library-revision-5555eeee"],
    filePath: "memory/thing-city-library-6666ffff.md",
  });
  const archived = sampleThing({
    memoryId: "thing-old-friend-7777ffff",
    title: "Old Friend",
    summary: "Archived memories must stay out of retrieval.",
    archived: true,
    relatedIds: ["thing-alice-1111aaaa"],
    filePath: "memory/archive/thing-old-friend-7777ffff.md",
  });

  const graph = buildMemoryGraph([alice, cafe, maple, libraryRevision, library, archived]);
  const context = buildMemoryContext({
    graph,
    query: "Alice 这个人靠谱吗？",
    conversation: [],
    now: new Date("2026-04-03T09:00:00.000Z"),
  });

  assert.equal(context.relevant, true);
  assert.equal(context.mode, "focused");
  assert.deepEqual(
    context.capsules.map((item) => item.title),
    ["Alice", "Cafe Meetup", "Project Maple"],
  );
  assert.equal(context.capsules.some((item) => item.title === "City Library"), false);
  assert.equal(context.capsules.some((item) => item.title === "Old Friend"), false);
});

test("broad memory recall uses thing tags plus event date, place, and feeling fields", () => {
  const alice = sampleThing({
    thingTags: ["friend", "health"],
    relatedIds: ["event-clinic-visit-8888aaaa"],
  });
  const clinic = sampleThing({
    memoryId: "thing-east-clinic-9999bbbb",
    title: "East Clinic",
    summary: "A clinic near the apartment.",
    thingType: "place",
    thingTags: ["clinic"],
    relatedIds: ["event-clinic-visit-8888aaaa"],
    filePath: "memory/thing-east-clinic-9999bbbb.md",
  });
  const visit = sampleEvent({
    memoryId: "event-clinic-visit-8888aaaa",
    title: "Clinic Visit",
    summary: "A clinic visit that clarified the recent health issue.",
    facts: ["The diagnosis was minor.", "The conversation ended with relief."],
    eventDate: "2026-04-02",
    placeIds: ["thing-east-clinic-9999bbbb"],
    feelingTags: ["relieved"],
    thingIds: ["thing-alice-1111aaaa"],
    relatedIds: ["thing-alice-1111aaaa", "thing-east-clinic-9999bbbb"],
    filePath: "memory/event-clinic-visit-8888aaaa.md",
  });

  const graph = buildMemoryGraph([alice, clinic, visit]);
  const context = buildMemoryContext({
    graph,
    query: "结合最近记忆和 #health 标签，回忆一下 Alice 在 East Clinic 那件事的感受",
    conversation: [],
    now: new Date("2026-04-03T09:00:00.000Z"),
  });

  assert.equal(context.relevant, true);
  assert.equal(context.mode, "broad");
  assert.deepEqual(context.capsules.slice(0, 3).map((item) => item.title).sort(), ["Alice", "Clinic Visit", "East Clinic"].sort());
  const clinicDetail = context.details.find((item) => item.title === "Clinic Visit");
  assert.match(clinicDetail?.text ?? "", /感受/);
  assert.match(clinicDetail?.text ?? "", /relieved/);
});
