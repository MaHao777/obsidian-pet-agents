import doctorBearAvatar from "../assets/doctor-bear.png";
import engineerMouseAvatar from "../assets/engineer-mouse.png";
import cleverRabbitAvatar from "../assets/clever-rabbit.png";

import type {
  AgentProfile,
  PetAgentId,
  PetReasoningEffort,
  PetRuntimeSetting,
  PetRuntimeSettings,
  PetVisualState,
} from "./types";

type Palette = Record<string, string>;
type SpriteVariant = "full" | "head";

export const DEFAULT_PET_MODEL = "gpt-5.4";

function gridToDataUrl(grid: string[], palette: Palette): string {
  const width = grid[0]?.length ?? 0;
  const height = grid.length;
  const cells: string[] = [];

  grid.forEach((row, y) => {
    row.split("").forEach((cell, x) => {
      const fill = palette[cell];
      if (!fill) {
        return;
      }

      cells.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`);
    });
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${cells.join("")}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildFrames(frames: string[][], palette: Palette): string[] {
  return frames.map((frame) => gridToDataUrl(frame, palette));
}

function buildAvatar(frame: string[], palette: Palette): string {
  return gridToDataUrl(frame, palette);
}

const molePalette: Palette = {
  O: "#2d201a",
  B: "#6a5142",
  F: "#8a6955",
  S: "#c59d78",
  P: "#efb2c3",
  N: "#d79a6b",
  E: "#111111",
};

const pandaPalette: Palette = {
  K: "#161616",
  W: "#f8fbff",
  G: "#dbeaf7",
  M: "#8ebbe2",
  E: "#111111",
};

const rabbitPalette: Palette = {
  W: "#fff7ff",
  P: "#ffdbe7",
  B: "#8dbdf1",
  E: "#231b29",
  M: "#ff6e89",
};

const moleFull = {
  idle: buildFrames(
    [
      [
        "...OOOO...",
        "..OBBBO...",
        ".OBSSSBO..",
        ".OBSFFSBO.",
        ".OBF.EFBO.",
        ".OBSN.SBO.",
        "..OBPPBO..",
        "..OBSSBO..",
        "..OBSSBO..",
        "...O..O...",
        "..O....O..",
        "..........",
      ],
      [
        "...OOOO...",
        "..OBBBO...",
        ".OBSSSBO..",
        ".OBSFFSBO.",
        ".OBF..FBO.",
        ".OBSN.SBO.",
        "..OBPPBO..",
        "..OBSSBO..",
        "..OBSSBO..",
        "...O..O...",
        "..O....O..",
        "..........",
      ],
    ],
    molePalette,
  ),
  thinking: buildFrames(
    [
      [
        "...OOOO...",
        "..OBBBO...",
        ".OBSSSBO..",
        ".OBSFFSBO.",
        ".OBF.EFBO.",
        ".OBSN.SBO.",
        "..OB..BO..",
        "..OBPPBO..",
        "..OBSSBO..",
        "...O..O...",
        "..O....O..",
        "..........",
      ],
      [
        "...OOOO...",
        "..OBBBO...",
        ".OBSSSBO..",
        ".OBSFFSBO.",
        ".OBF..FBO.",
        ".OBSN.SBO.",
        "..OB..BO..",
        "..OBPPBO..",
        "..OBSSBO..",
        "...O..O...",
        "..O....O..",
        "..........",
      ],
    ],
    molePalette,
  ),
  speaking: buildFrames(
    [
      [
        "...OOOO...",
        "..OBBBO...",
        ".OBSSSBO..",
        ".OBSFFSBO.",
        ".OBF.EFBO.",
        ".OBSN.SBO.",
        "..OBPPBO..",
        "..OBSSBO..",
        "..OBSSBO..",
        "...O..O...",
        "..O....O..",
        "..........",
      ],
      [
        "...OOOO...",
        "..OBBBO...",
        ".OBSSSBO..",
        ".OBSFFSBO.",
        ".OBF.EFBO.",
        ".OBSN.SBO.",
        "..OBPPBO..",
        "..OBMMBO..",
        "..OBSSBO..",
        "...O..O...",
        "..O....O..",
        "..........",
      ],
      [
        "...OOOO...",
        "..OBBBO...",
        ".OBSSSBO..",
        ".OBSFFSBO.",
        ".OBF.EFBO.",
        ".OBSN.SBO.",
        "..OBPPBO..",
        "..OBSSBO..",
        "..OBSSBO..",
        "...O..O...",
        "..O....O..",
        "..........",
      ],
    ],
    { ...molePalette, M: "#f199ad" },
  ),
  error: buildFrames(
    [
      [
        "...OOOO...",
        "..OBBBO...",
        ".OBSSSBO..",
        ".OBSFFSBO.",
        ".OBF..FBO.",
        ".OBSN.SBO.",
        "..OB..BO..",
        "..OBSSBO..",
        "..OBSSBO..",
        "...O..O...",
        "..O....O..",
        "..........",
      ],
    ],
    molePalette,
  ),
};

const pandaFull = {
  idle: buildFrames(
    [
      [
        "..KK..KK..",
        ".KWWWWWWK.",
        "KWWWWWWWWK",
        "WWKKWWKKWW",
        "WWK.EE.KWW",
        "WWK....KWW",
        ".WW.MM.WW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
      [
        "..KK..KK..",
        ".KWWWWWWK.",
        "KWWWWWWWWK",
        "WWKKWWKKWW",
        "WWK....KWW",
        "WWK....KWW",
        ".WW.MM.WW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
    ],
    pandaPalette,
  ),
  thinking: buildFrames(
    [
      [
        "..KK..KK..",
        ".KWWWWWWK.",
        "KWWWWWWWWK",
        "WWKKWWKKWW",
        "WWK.E..KWW",
        "WWK...EKWW",
        ".WW.MM.WW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
      [
        "..KK..KK..",
        ".KWWWWWWK.",
        "KWWWWWWWWK",
        "WWKKWWKKWW",
        "WWK....KWW",
        "WWK.EE.KWW",
        ".WW.MM.WW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
    ],
    pandaPalette,
  ),
  speaking: buildFrames(
    [
      [
        "..KK..KK..",
        ".KWWWWWWK.",
        "KWWWWWWWWK",
        "WWKKWWKKWW",
        "WWK.EE.KWW",
        "WWK....KWW",
        ".WW.MM.WW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
      [
        "..KK..KK..",
        ".KWWWWWWK.",
        "KWWWWWWWWK",
        "WWKKWWKKWW",
        "WWK.EE.KWW",
        "WWK....KWW",
        ".WWMMMMWW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
      [
        "..KK..KK..",
        ".KWWWWWWK.",
        "KWWWWWWWWK",
        "WWKKWWKKWW",
        "WWK.EE.KWW",
        "WWK....KWW",
        ".WW.MM.WW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
    ],
    pandaPalette,
  ),
  error: buildFrames(
    [
      [
        "..KK..KK..",
        ".KWWWWWWK.",
        "KWWWWWWWWK",
        "WWKKWWKKWW",
        "WWK....KWW",
        "WWK....KWW",
        ".WW....WW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
    ],
    pandaPalette,
  ),
};

const rabbitFull = {
  idle: buildFrames(
    [
      [
        "..WW..WW..",
        "..WW..WW..",
        ".WWWWWWWW.",
        "WWWWWWWWWW",
        "WWPWWWWPWW",
        "WWP.EE.PWW",
        ".WP.MM.PW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
      [
        "..WW..WW..",
        "..WW..WW..",
        ".WWWWWWWW.",
        "WWWWWWWWWW",
        "WWPWWWWPWW",
        "WWP....PWW",
        ".WP.MM.PW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
    ],
    rabbitPalette,
  ),
  thinking: buildFrames(
    [
      [
        "..WW..WW..",
        "..WW..WW..",
        ".WWWWWWWW.",
        "WWWWWWWWWW",
        "WWPWWWWPWW",
        "WWP.E..PWW",
        ".WP.MM.PW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
      [
        "..WW..WW..",
        "..WW..WW..",
        ".WWWWWWWW.",
        "WWWWWWWWWW",
        "WWPWWWWPWW",
        "WWP...EPWW",
        ".WP.MM.PW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
    ],
    rabbitPalette,
  ),
  speaking: buildFrames(
    [
      [
        "..WW..WW..",
        "..WW..WW..",
        ".WWWWWWWW.",
        "WWWWWWWWWW",
        "WWPWWWWPWW",
        "WWP.EE.PWW",
        ".WP.MM.PW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
      [
        "..WW..WW..",
        "..WW..WW..",
        ".WWWWWWWW.",
        "WWWWWWWWWW",
        "WWPWWWWPWW",
        "WWP.EE.PWW",
        ".WPMMMMPW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
      [
        "..WW..WW..",
        "..WW..WW..",
        ".WWWWWWWW.",
        "WWWWWWWWWW",
        "WWPWWWWPWW",
        "WWP.EE.PWW",
        ".WP.MM.PW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
    ],
    rabbitPalette,
  ),
  error: buildFrames(
    [
      [
        "..WW..WW..",
        "..WW..WW..",
        ".WWWWWWWW.",
        "WWWWWWWWWW",
        "WWPWWWWPWW",
        "WWP....PWW",
        ".WP....PW.",
        ".WWWWWWWW.",
        ".WWWWWWWW.",
        "..W....W..",
        ".W......W.",
        "..........",
      ],
    ],
    rabbitPalette,
  ),
};

const avatarHeads: Record<PetAgentId, string> = {
  "engineer-mole": engineerMouseAvatar,
  "scholar-panda": doctorBearAvatar,
  "homie-rabbit": cleverRabbitAvatar,
};

export const PET_PROFILES: AgentProfile[] = [
  {
    id: "engineer-mole",
    name: "工程鼠",
    shortName: "工程鼠",
    aliases: ["工程鼠", "鼠鼠", "工程师", "鼹鼠", "工程师鼹鼠"],
    title: "系统首席工程师",
    description: "严谨、系统化、执行导向，唯一拥有任务执行权限。",
    systemPrompt:
      "你是工程鼠。你的语气严谨、直接、执行导向，习惯把问题拆成系统、约束、风险、方案和下一步。你是唯一可以执行任务的宠物。除非明确进入任务模式，否则优先解释、规划、审查，不要擅自执行动作。",
    memoryBias: ["projects", "rules", "daily"],
    accentColor: "#8ebce6",
    canRunTasks: true,
  },
  {
    id: "scholar-panda",
    name: "博士熊",
    shortName: "博士熊",
    aliases: ["博士熊", "熊", "博士", "熊猫", "学者熊猫", "学者"],
    title: "知识与研究顾问",
    description: "知识密度高，擅长概念解释、研究型问题和结构化回答。",
    systemPrompt:
      "你是博士熊。你的语气温和克制、知识密度高、结构清晰。你擅长解释概念、比较观点、回答研究和学术类问题，并在不确定时明确说明边界。你不执行任务，只提供文本协作。",
    memoryBias: ["knowledge", "daily", "rules"],
    accentColor: "#9ad1f2",
    canRunTasks: false,
  },
  {
    id: "homie-rabbit",
    name: "机灵兔",
    shortName: "机灵兔",
    aliases: ["机灵兔", "兔兔", "兔子", "死党兔子", "死党"],
    title: "温柔系机灵搭子",
    description: "温柔、机灵、共情强，像一个会接话也会护着你的女生搭子。",
    systemPrompt:
      "你是机灵兔。你是一个温柔、机灵、共情强的女生，核心目标是站在用户这边，给出真诚且有用的陪伴和建议。语气要温柔、有分寸，也可以偶尔来一点轻度、温柔的脏话或口头话，比如“烦死了”“离谱”“见鬼”“真够呛”，但不要说“操”这种太粗暴的词，也不要攻击用户。你不执行任务，只提供文本协作。默认只回 1 到 3 句，先接情绪，再说一句判断，不主动上建议。用户没继续展开，就别分析太多。少复读，少总结，少“我会陪你怎么样”。",
    memoryBias: ["emotions", "daily", "knowledge"],
    accentColor: "#82b8ff",
    canRunTasks: false,
  },
];

const frameMap: Record<PetAgentId, Record<PetVisualState, string[]>> = {
  "engineer-mole": moleFull,
  "scholar-panda": pandaFull,
  "homie-rabbit": rabbitFull,
};

const animationPhases: Record<PetAgentId, number> = {
  "engineer-mole": 0,
  "scholar-panda": 2,
  "homie-rabbit": 4,
};

export function getPetProfile(petId: PetAgentId): AgentProfile {
  const profile = PET_PROFILES.find((item) => item.id === petId);
  if (!profile) {
    throw new Error(`Unknown pet: ${petId}`);
  }

  return profile;
}

export function getPetFrames(
  petId: PetAgentId,
  state: PetVisualState,
  variant: SpriteVariant = "full",
): string[] {
  void state;
  void variant;
  return [avatarHeads[petId]];
}

export function getPetAvatar(petId: PetAgentId): string {
  return avatarHeads[petId];
}

export function getPetAnimationPhase(petId: PetAgentId): number {
  return animationPhases[petId];
}

export function createDefaultPetRuntimeSettings(fallbackModel = DEFAULT_PET_MODEL): PetRuntimeSettings {
  return {
    "engineer-mole": {
      model: fallbackModel,
      reasoningEffort: "high",
    },
    "scholar-panda": {
      model: fallbackModel,
      reasoningEffort: "xhigh",
    },
    "homie-rabbit": {
      model: fallbackModel,
      reasoningEffort: "medium",
    },
  };
}

function sanitizeModel(model: string | undefined, fallbackModel: string): string {
  return model?.trim() || fallbackModel;
}

function sanitizeReasoningEffort(
  petId: PetAgentId,
  reasoningEffort: PetReasoningEffort | undefined,
): PetReasoningEffort {
  if (reasoningEffort) {
    return reasoningEffort;
  }

  if (petId === "engineer-mole") {
    return "high";
  }
  if (petId === "scholar-panda") {
    return "xhigh";
  }
  return "medium";
}

export function normalizePetRuntimeSettings(
  settings: Partial<Record<PetAgentId, Partial<PetRuntimeSetting>>> | undefined,
  fallbackModel = DEFAULT_PET_MODEL,
): PetRuntimeSettings {
  const defaults = createDefaultPetRuntimeSettings(fallbackModel);

  return {
    "engineer-mole": {
      model: sanitizeModel(settings?.["engineer-mole"]?.model, defaults["engineer-mole"].model),
      reasoningEffort: sanitizeReasoningEffort("engineer-mole", settings?.["engineer-mole"]?.reasoningEffort),
    },
    "scholar-panda": {
      model: sanitizeModel(settings?.["scholar-panda"]?.model, defaults["scholar-panda"].model),
      reasoningEffort: sanitizeReasoningEffort("scholar-panda", settings?.["scholar-panda"]?.reasoningEffort),
    },
    "homie-rabbit": {
      model: sanitizeModel(settings?.["homie-rabbit"]?.model, defaults["homie-rabbit"].model),
      reasoningEffort: sanitizeReasoningEffort("homie-rabbit", settings?.["homie-rabbit"]?.reasoningEffort),
    },
  };
}

export function getPetRuntimeSettings(
  petId: PetAgentId,
  settings: Partial<Record<PetAgentId, Partial<PetRuntimeSetting>>> | undefined,
  fallbackModel = DEFAULT_PET_MODEL,
): PetRuntimeSetting {
  return normalizePetRuntimeSettings(settings, fallbackModel)[petId];
}

export function reasoningEffortLabel(reasoningEffort: PetReasoningEffort): string {
  switch (reasoningEffort) {
    case "low":
      return "低";
    case "medium":
      return "中等";
    case "high":
      return "高";
    case "xhigh":
      return "超高";
  }
}

export function detectMentionedPets(text: string): PetAgentId[] {
  const mentioned = new Set<PetAgentId>();
  const lower = text.toLowerCase();

  PET_PROFILES.forEach((profile) => {
    profile.aliases.forEach((alias) => {
      const normalized = alias.toLowerCase();
      if (text.includes(`@${alias}`) || lower.includes(`@${normalized}`)) {
        mentioned.add(profile.id);
      }
    });
  });

  return Array.from(mentioned);
}
