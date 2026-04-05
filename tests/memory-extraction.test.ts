import test from "node:test";
import assert from "node:assert/strict";

import { parseMemoryExtractionResponse } from "../src/memory-extraction.ts";

test("parseMemoryExtractionResponse keeps only the two supported memory kinds", () => {
  const parsed = parseMemoryExtractionResponse(
    JSON.stringify({
      memories: [
        {
          title: "Alice",
          kind: "thing",
          thingType: "person",
          summary: "A close friend.",
          facts: ["Lives in Shanghai."],
          aliases: ["艾丽丝"],
          thingTags: ["friend"],
          relations: [{ title: "Cafe Meetup", kind: "event", type: "related_to" }],
        },
        {
          title: "Cafe Meetup",
          kind: "event",
          summary: "A meaningful meetup.",
          facts: ["We discussed Project Maple."],
          aliases: ["咖啡见面"],
          eventDate: "2026-04-01",
          placeTitles: ["West Lake Cafe"],
          feelingTags: ["optimistic"],
          thingTitles: ["Alice"],
          relations: [{ title: "Alice", kind: "thing", thingType: "person", type: "involves" }],
        },
        {
          title: "Old Preference",
          category: "preference",
          summary: "Legacy shape should be ignored.",
        },
      ],
    }),
  );

  assert.deepEqual(
    parsed.map((item) => item.kind),
    ["thing", "event"],
  );
  assert.equal(parsed[0]?.thingType, "person");
  assert.deepEqual(parsed[1]?.thingTitles, ["Alice"]);
});
