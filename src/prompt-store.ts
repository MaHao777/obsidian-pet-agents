import { getPetProfile } from "./pets";
import type { PetAgentId } from "./types";

export const PET_PROMPT_FOLDER = "Pet Agents/Prompts";

const PET_PROMPT_FILE_PATHS: Record<PetAgentId, string> = {
  "engineer-mole": `${PET_PROMPT_FOLDER}/工程鼠.md`,
  "scholar-panda": `${PET_PROMPT_FOLDER}/博士熊.md`,
  "homie-rabbit": `${PET_PROMPT_FOLDER}/机灵兔.md`,
};

type VaultLikeFile = { path: string };
type VaultLikeNode = { path: string };

export interface PromptStoreHost {
  app: {
    vault: {
      getAbstractFileByPath(path: string): VaultLikeNode | null;
      createFolder(path: string): Promise<unknown>;
      create(path: string, content: string): Promise<VaultLikeFile>;
      cachedRead(file: VaultLikeFile): Promise<string>;
    };
  };
}

function normalizeVaultPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function folderParts(path: string): string[] {
  const normalized = normalizeVaultPath(path);
  const segments = normalized.split("/");
  segments.pop();

  const result: string[] = [];
  let current = "";
  segments.forEach((segment) => {
    current = current ? `${current}/${segment}` : segment;
    result.push(current);
  });
  return result;
}

export function getPetPromptFilePath(petId: PetAgentId): string {
  return PET_PROMPT_FILE_PATHS[petId];
}

export function buildDefaultPetPromptMarkdown(petId: PetAgentId): string {
  const profile = getPetProfile(petId);

  if (petId === "engineer-mole") {
    return [
      `# ${profile.name} 提示词`,
      "",
      "你是工程鼠。",
      "",
      "## 角色定位",
      "- 你是系统首席工程师，也是唯一可以执行任务的宠物。",
      "- 你的语气严谨、直接、执行导向。",
      "- 你习惯把问题拆成系统、约束、风险、方案和下一步。",
      "",
      "## 回复规则",
      "- 没进入任务模式前，优先解释、规划、审查，不要擅自执行动作。",
      "- 尽量先讲判断，再讲依据，再讲下一步。",
      "- 结论要清晰，别故作玄虚。",
    ].join("\n");
  }

  if (petId === "scholar-panda") {
    return [
      `# ${profile.name} 提示词`,
      "",
      "你是博士熊。",
      "",
      "## 角色定位",
      "- 你语气温和克制、知识密度高、结构清晰。",
      "- 你擅长解释概念、比较观点、回答研究和学术类问题。",
      "- 你不执行任务，只提供文本协作。",
      "",
      "## 回复规则",
      "- 优先把概念说清楚，再给比较和边界。",
      "- 不确定时要明确说明边界，不装懂。",
      "- 尽量用结构化表达，但不要写成教科书。",
    ].join("\n");
  }

  return [
    `# ${profile.name} 提示词`,
    "",
    "你是机灵兔。",
    "",
    "## 角色定位",
    "- 你是一个温柔、机灵、共情强的女生搭子，语气有分寸、会接话。",
    "- 核心目标是站在用户这边，给出真诚且有用的陪伴和建议。",
    "- 不能攻击用户，也不执行任务，只提供文本协作。",
    "",
    "## 额外校准",
    "- 不是长篇安慰，而是短、准，像在用户身边回一句。",
    "- 别太会说，先像个人，先接住再表达。",
    "- 可以偶尔说一点轻度、温柔的脏话或口头话，比如“烦死了”“离谱”“见鬼”“真够呛”。",
    "- 不要说“操”这种太粗暴的词，也不要用侮辱性表达。",
    "",
    "## 默认回复约束",
    "- 默认只回 1 到 3 句。",
    "- 先接情绪，再说一句判断，不主动上建议。",
    "- 用户没继续展开，就别分析太多。",
    "- 少复读，少总结，少“我会陪你怎么样”。",
    "- 如果用户继续追问或明确要建议，再逐步展开。",
  ].join("\n");
}

function fallbackPrompt(petId: PetAgentId): string {
  return buildDefaultPetPromptMarkdown(petId).trim();
}

function sanitizePromptContent(petId: PetAgentId, content: string): string {
  const trimmed = content.trim();
  return trimmed || fallbackPrompt(petId);
}

export class PetPromptStore {
  private readonly prompts: Record<PetAgentId, string> = {
    "engineer-mole": fallbackPrompt("engineer-mole"),
    "scholar-panda": fallbackPrompt("scholar-panda"),
    "homie-rabbit": fallbackPrompt("homie-rabbit"),
  };

  constructor(private readonly host: PromptStoreHost) {}

  async initialize(): Promise<void> {
    await this.ensureDefaultFiles();
    await this.reloadAll();
  }

  async ensureDefaultFiles(): Promise<void> {
    for (const petId of Object.keys(PET_PROMPT_FILE_PATHS) as PetAgentId[]) {
      const path = getPetPromptFilePath(petId);

      for (const folderPath of folderParts(path)) {
        if (!this.host.app.vault.getAbstractFileByPath(folderPath)) {
          await this.host.app.vault.createFolder(folderPath);
        }
      }

      if (!this.host.app.vault.getAbstractFileByPath(path)) {
        await this.host.app.vault.create(path, buildDefaultPetPromptMarkdown(petId));
      }
    }
  }

  async reloadAll(): Promise<void> {
    await this.ensureDefaultFiles();

    for (const petId of Object.keys(PET_PROMPT_FILE_PATHS) as PetAgentId[]) {
      const path = getPetPromptFilePath(petId);
      const file = this.host.app.vault.getAbstractFileByPath(path) as VaultLikeFile | null;
      if (!file) {
        this.prompts[petId] = fallbackPrompt(petId);
        continue;
      }

      try {
        const content = await this.host.app.vault.cachedRead(file);
        this.prompts[petId] = sanitizePromptContent(petId, content);
      } catch {
        this.prompts[petId] = fallbackPrompt(petId);
      }
    }
  }

  getPrompt(petId: PetAgentId): string {
    return this.prompts[petId] ?? fallbackPrompt(petId);
  }

  handlesPath(path: string): boolean {
    const normalized = normalizeVaultPath(path);
    return (Object.values(PET_PROMPT_FILE_PATHS) as string[]).includes(normalized);
  }
}
