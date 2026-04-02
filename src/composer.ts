import { PET_PROFILES } from "./pets";
import type { AgentProfile, PetAgentId } from "./types";

export interface MentionTrigger {
  start: number;
  end: number;
  query: string;
}

const PRIMARY_PET_ORDER: PetAgentId[] = ["engineer-mole", "scholar-panda", "homie-rabbit"];

function cyclePrimaryPet(currentPetId: PetAgentId, direction: 1 | -1): PetAgentId {
  const index = PRIMARY_PET_ORDER.indexOf(currentPetId);
  const safeIndex = index >= 0 ? index : 0;
  const nextIndex = (safeIndex + direction + PRIMARY_PET_ORDER.length) % PRIMARY_PET_ORDER.length;
  return PRIMARY_PET_ORDER[nextIndex];
}

export function getNextPrimaryPet(currentPetId: PetAgentId): PetAgentId {
  return cyclePrimaryPet(currentPetId, 1);
}

export function getPreviousPrimaryPet(currentPetId: PetAgentId): PetAgentId {
  return cyclePrimaryPet(currentPetId, -1);
}

export function findMentionTrigger(text: string, caretIndex: number): MentionTrigger | null {
  const left = text.slice(0, caretIndex);
  const match = /(^|\s)@([^\s@]*)$/.exec(left);
  if (!match) {
    return null;
  }

  const query = match[2] ?? "";
  return {
    query,
    start: left.length - query.length - 1,
    end: caretIndex,
  };
}

function matchesMention(profile: AgentProfile, query: string): boolean {
  if (!query) {
    return true;
  }

  const normalized = query.trim().toLowerCase();
  const candidates = [profile.name, profile.shortName, ...profile.aliases].map((item) => item.toLowerCase());
  return candidates.some((item) => item.includes(normalized));
}

export function getMentionSuggestions(query: string): AgentProfile[] {
  return PET_PROFILES.filter((profile) => matchesMention(profile, query));
}

export function applyMentionSuggestion(
  text: string,
  trigger: MentionTrigger,
  petLabel: string,
): { text: string; caretIndex: number } {
  const before = text.slice(0, trigger.start + 1);
  const after = text.slice(trigger.end).replace(/^\s*/, "");
  const nextText = `${before}${petLabel} ${after}`;

  return {
    text: nextText,
    caretIndex: before.length + petLabel.length + 1,
  };
}
