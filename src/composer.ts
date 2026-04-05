import type { PetAgentId, SlashCommandId } from "./types.ts";

export interface MentionTrigger {
  start: number;
  end: number;
  query: string;
}

export interface MentionSuggestion {
  id: PetAgentId;
  name: string;
  shortName: string;
  aliases: string[];
  title: string;
}

export interface SlashTrigger {
  start: number;
  end: number;
  query: string;
}

export interface SlashCommandDefinition {
  id: SlashCommandId;
  label: string;
  description: string;
  searchTerms: string[];
}

const PRIMARY_PET_ORDER: PetAgentId[] = ["engineer-mole", "scholar-panda", "homie-rabbit"];

const MENTION_SUGGESTIONS: MentionSuggestion[] = [
  {
    id: "engineer-mole",
    name: "工程鼠",
    shortName: "鼠",
    aliases: ["工程鼠", "mole", "engineer", "mouse", "coder"],
    title: "工程搭子",
  },
  {
    id: "scholar-panda",
    name: "博士熊",
    shortName: "熊",
    aliases: ["博士熊", "panda", "scholar", "research"],
    title: "研究顾问",
  },
  {
    id: "homie-rabbit",
    name: "机灵兔",
    shortName: "兔",
    aliases: ["机灵兔", "rabbit", "homie", "buddy"],
    title: "情绪支援",
  },
];

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  {
    id: "current-file",
    label: "/current-file",
    description: "添加当前活动文件到本轮上下文",
    searchTerms: ["current", "current-file", "active", "当前文件"],
  },
  {
    id: "file",
    label: "/file",
    description: "从 vault 里选择一个文件加入本轮上下文",
    searchTerms: ["file", "path", "指定文件"],
  },
  {
    id: "skill",
    label: "/skill",
    description: "选择一个本机 skill，并作为本轮指令附加",
    searchTerms: ["skill", "skills", "技能"],
  },
  {
    id: "refresh-memory",
    label: "/refresh-memory",
    description: "立即重扫 layered memory，不会直接发送消息",
    searchTerms: ["refresh", "memory", "rescan", "刷新记忆"],
  },
];

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

export function findSlashTrigger(text: string, caretIndex: number): SlashTrigger | null {
  const left = text.slice(0, caretIndex);
  const match = /(^|\s)\/([^\s/]*)$/.exec(left);
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

function matchesMention(profile: MentionSuggestion, query: string): boolean {
  if (!query) {
    return true;
  }

  const normalized = query.trim().toLowerCase();
  const candidates = [profile.name, profile.shortName, ...profile.aliases].map((item) => item.toLowerCase());
  return candidates.some((item) => item.includes(normalized));
}

export function getMentionSuggestions(query: string): MentionSuggestion[] {
  return MENTION_SUGGESTIONS.filter((profile) => matchesMention(profile, query));
}

function matchesSlashCommand(command: SlashCommandDefinition, query: string): boolean {
  if (!query) {
    return true;
  }

  const normalized = query.trim().toLowerCase().replace(/^\//, "");
  const candidates = [command.id, command.label, ...command.searchTerms].map((item) => item.toLowerCase());
  return candidates.some((item) => item.includes(normalized));
}

export function getSlashSuggestions(query: string): SlashCommandDefinition[] {
  return SLASH_COMMANDS.filter((command) => matchesSlashCommand(command, query));
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

export function applySlashSuggestion(
  text: string,
  trigger: SlashTrigger,
): { text: string; caretIndex: number } {
  const before = text.slice(0, trigger.start);
  const after = text.slice(trigger.end);
  const nextText =
    before && after && !/\s$/.test(before) && !/^\s/.test(after) ? `${before} ${after}` : `${before}${after}`;

  return {
    text: nextText,
    caretIndex: before.length,
  };
}
