import type { MemoryNodeKind, ThingPrimaryType } from "./memory-graph.ts";

export interface MemoryExtractionRelation {
  title: string;
  kind?: MemoryNodeKind;
  thingType?: ThingPrimaryType;
  type: string;
}

export interface MemoryExtractionAtom {
  title: string;
  kind: MemoryNodeKind;
  summary: string;
  facts: string[];
  aliases: string[];
  thingType?: ThingPrimaryType;
  thingTags: string[];
  eventDate?: string;
  placeTitles: string[];
  feelingTags: string[];
  thingTitles: string[];
  relations: MemoryExtractionRelation[];
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function sanitizeKind(value: unknown): MemoryNodeKind | null {
  return value === "thing" || value === "event" ? value : null;
}

function sanitizeThingType(value: unknown): ThingPrimaryType {
  const allowed = new Set<ThingPrimaryType>(["person", "animal", "place", "object", "organization", "other"]);
  return typeof value === "string" && allowed.has(value as ThingPrimaryType) ? (value as ThingPrimaryType) : "other";
}

function extractJson(text: string): string {
  const fenced = /```json\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("No JSON object found in memory extraction response.");
}

export function buildMemoryExtractionPrompt(input: { path: string; content: string }): string {
  return [
    "You are extracting memory graph notes from an Obsidian markdown source.",
    "Return JSON only. No prose. No markdown fences unless necessary.",
    "Only output two memory kinds: thing and event.",
    "A thing is a stable entity such as a person, animal, place, object, or organization.",
    "A thing stores durable attributes and relationships. Do not create separate preference/project/activity nodes; fold those facts into the relevant thing.",
    "An event is a memorable process or episode with long-term recall value.",
    "Only keep events that matter beyond a trivial daily fragment.",
    "Every event must include at least one explicit thingTitles item or placeTitles item. If the note is only about the user implicitly and has no other anchor, omit the event.",
    "Keep thingTags and feelingTags short and high-signal. Avoid duplicates.",
    "Use this JSON shape:",
    '{"memories":[{"title":"","kind":"thing","thingType":"person","summary":"","facts":[""],"aliases":[""],"thingTags":["friend"],"relations":[{"title":"","kind":"event","type":"related_to"}]},{"title":"","kind":"event","summary":"","facts":[""],"aliases":[""],"eventDate":"YYYY-MM-DD","placeTitles":[""],"feelingTags":[""],"thingTitles":[""],"relations":[{"title":"","kind":"thing","thingType":"person","type":"involves"}]}]}',
    `Source path: ${input.path}`,
    "Source markdown:",
    input.content,
  ].join("\n\n");
}

export function parseMemoryExtractionResponse(text: string): MemoryExtractionAtom[] {
  const payload = JSON.parse(extractJson(text)) as { memories?: unknown[] };
  if (!Array.isArray(payload.memories)) {
    return [];
  }

  return payload.memories
    .map((item) => item as Record<string, unknown>)
    .map<MemoryExtractionAtom | null>((item) => {
      const kind = sanitizeKind(item.kind);
      if (!kind || typeof item.title !== "string" || item.title.trim().length === 0) {
        return null;
      }

      const relations = Array.isArray(item.relations)
        ? item.relations
            .map((relation) => relation as Record<string, unknown>)
            .filter((relation) => typeof relation.title === "string" && relation.title.trim().length > 0)
            .map<MemoryExtractionRelation>((relation) => ({
              title: String(relation.title).trim(),
              kind: sanitizeKind(relation.kind) ?? undefined,
              thingType: relation.kind === "thing" ? sanitizeThingType(relation.thingType) : undefined,
              type: typeof relation.type === "string" && relation.type.trim().length > 0 ? relation.type.trim() : "related_to",
            }))
        : [];

      return {
        title: String(item.title).trim(),
        kind,
        thingType: kind === "thing" ? sanitizeThingType(item.thingType) : undefined,
        summary: typeof item.summary === "string" ? item.summary.trim() : "",
        facts: Array.isArray(item.facts)
          ? uniqueStrings(item.facts.filter((fact): fact is string => typeof fact === "string" && fact.trim().length > 0))
          : [],
        aliases: Array.isArray(item.aliases)
          ? uniqueStrings(item.aliases.filter((alias): alias is string => typeof alias === "string" && alias.trim().length > 0))
          : [],
        thingTags:
          kind === "thing" && Array.isArray(item.thingTags)
            ? uniqueStrings(item.thingTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)).slice(0, 6)
            : [],
        eventDate: kind === "event" && typeof item.eventDate === "string" && item.eventDate.trim().length > 0 ? item.eventDate.trim() : undefined,
        placeTitles:
          kind === "event" && Array.isArray(item.placeTitles)
            ? uniqueStrings(item.placeTitles.filter((title): title is string => typeof title === "string" && title.trim().length > 0))
            : [],
        feelingTags:
          kind === "event" && Array.isArray(item.feelingTags)
            ? uniqueStrings(item.feelingTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)).slice(0, 4)
            : [],
        thingTitles:
          kind === "event" && Array.isArray(item.thingTitles)
            ? uniqueStrings(item.thingTitles.filter((title): title is string => typeof title === "string" && title.trim().length > 0))
            : [],
        relations,
      };
    })
    .filter((item): item is MemoryExtractionAtom => item !== null);
}
