import { App, PluginSettingTab, Setting } from "obsidian";

import { createDefaultPetRuntimeSettings, normalizePetRuntimeSettings, PET_PROFILES, reasoningEffortLabel } from "./pets";
import type { PetAgentsSettings, TaskExecutionPolicy } from "./types";
import type PetAgentsPlugin from "./main";

export const DEFAULT_SETTINGS: PetAgentsSettings = {
  providerKind: "codex-cli",
  codexExecutable: "codex",
  codexModel: "",
  codexProfile: "",
  petRuntimeSettings: createDefaultPetRuntimeSettings(),
  taskExecutionPolicy: "danger-full-access",
  taskModeConfirmation: false,
  memorySourcePaths: ["Daily Notes", "Diary", "Journal", "日记", "日志"],
  memoryFolderPath: "memory",
  memoryWhitelistPaths: [],
  diaryFolderHints: ["Daily Notes", "Diary", "Journal", "日记", "日志"],
  autoScanMemory: true,
  memoryCapsuleLimit: 4,
  memoryDetailLimit: 2,
  enableProfanityRabbit: true,
  enablePetAnimations: true,
};

function policyLabel(policy: TaskExecutionPolicy): string {
  switch (policy) {
    case "read-only":
      return "只读";
    case "workspace-write":
      return "工作区写入";
    case "danger-full-access":
      return "完全权限";
  }
}

export function normalizeLoadedSettings(
  storedSettings: Partial<PetAgentsSettings> | undefined,
): { settings: PetAgentsSettings; migrated: boolean } {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...storedSettings,
  };

  const settings: PetAgentsSettings = {
    ...merged,
    petRuntimeSettings: normalizePetRuntimeSettings(storedSettings?.petRuntimeSettings, merged.codexModel || "gpt-5.4"),
    taskExecutionPolicy: "danger-full-access",
    taskModeConfirmation: false,
    memorySourcePaths:
      storedSettings?.memorySourcePaths && storedSettings.memorySourcePaths.length > 0
        ? storedSettings.memorySourcePaths
        : Array.from(new Set([...(storedSettings?.memoryWhitelistPaths ?? []), ...DEFAULT_SETTINGS.memorySourcePaths])),
    memoryFolderPath: storedSettings?.memoryFolderPath?.trim() || DEFAULT_SETTINGS.memoryFolderPath,
  };

  const migrated =
    storedSettings?.taskExecutionPolicy !== settings.taskExecutionPolicy ||
    storedSettings?.taskModeConfirmation !== settings.taskModeConfirmation ||
    JSON.stringify(storedSettings?.petRuntimeSettings ?? {}) !== JSON.stringify(settings.petRuntimeSettings) ||
    JSON.stringify(storedSettings?.memorySourcePaths ?? []) !== JSON.stringify(settings.memorySourcePaths) ||
    storedSettings?.memoryFolderPath !== settings.memoryFolderPath;

  return { settings, migrated };
}

export class PetAgentsSettingTab extends PluginSettingTab {
  private readonly plugin: PetAgentsPlugin;

  constructor(app: App, plugin: PetAgentsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private async savePetModel(petId: keyof PetAgentsSettings["petRuntimeSettings"], value: string): Promise<void> {
    this.plugin.settings.petRuntimeSettings[petId].model = value.trim() || "gpt-5.4";
    await this.plugin.persistState();
  }

  private async savePetReasoning(
    petId: keyof PetAgentsSettings["petRuntimeSettings"],
    value: PetAgentsSettings["petRuntimeSettings"][keyof PetAgentsSettings["petRuntimeSettings"]]["reasoningEffort"],
  ): Promise<void> {
    this.plugin.settings.petRuntimeSettings[petId].reasoningEffort = value;
    await this.plugin.persistState();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "OBS Pet Agents" });
    containerEl.createEl("h3", { text: "宠物提示词文件" });

    PET_PROFILES.forEach((profile) => {
      new Setting(containerEl)
        .setName(`${profile.name} 提示词`)
        .setDesc(this.plugin.getPetPromptPath(profile.id))
        .addButton((button) =>
          button.setButtonText("打开").onClick(async () => {
            await this.plugin.openPetPromptFile(profile.id);
          }),
        );
    });

    new Setting(containerEl)
      .setName("重新加载提示词")
      .setDesc("如果刚修改了 vault 里的提示词文件，可以手动重载一次。")
      .addButton((button) =>
        button.setButtonText("重新加载").onClick(async () => {
          await this.plugin.reloadPromptFiles(true);
        }),
      );

    new Setting(containerEl)
      .setName("Codex 可执行文件")
      .setDesc("默认直接调用 `codex`。如果你放在了别的路径，可以在这里覆盖。")
      .addText((text) =>
        text
          .setPlaceholder("codex")
          .setValue(this.plugin.settings.codexExecutable)
          .onChange(async (value) => {
            this.plugin.settings.codexExecutable = value.trim() || "codex";
            await this.plugin.persistState();
          }),
      );

    new Setting(containerEl)
      .setName("Codex Profile")
      .setDesc("对应 `codex --profile`。")
      .addText((text) =>
        text.setValue(this.plugin.settings.codexProfile).onChange(async (value) => {
          this.plugin.settings.codexProfile = value.trim();
          await this.plugin.persistState();
        }),
      );

    containerEl.createEl("h3", { text: "宠物模型与思考强度" });

    PET_PROFILES.forEach((profile) => {
      const runtimeSettings = this.plugin.settings.petRuntimeSettings[profile.id];

      new Setting(containerEl)
        .setName(`${profile.name} 模型`)
        .setDesc(`留空时会回退到 ${runtimeSettings.model || "gpt-5.4"}。建议保持 gpt-5.4。`)
        .addText((text) =>
          text.setValue(runtimeSettings.model).onChange(async (value) => {
            await this.savePetModel(profile.id, value);
          }),
        );

      new Setting(containerEl)
        .setName(`${profile.name} 思考强度`)
        .setDesc(`这个值会直接作为 ${profile.name} 的 Codex reasoning_effort 传参。`)
        .addDropdown((dropdown) => {
          (["low", "medium", "high", "xhigh"] as const).forEach((effort) => {
            dropdown.addOption(effort, reasoningEffortLabel(effort));
          });

          dropdown.setValue(runtimeSettings.reasoningEffort).onChange(async (value) => {
            await this.savePetReasoning(profile.id, value as typeof runtimeSettings.reasoningEffort);
          });
        });
    });

    new Setting(containerEl)
      .setName("工程鼠任务模式")
      .setDesc(`任务模式固定使用 ${policyLabel(this.plugin.settings.taskExecutionPolicy)}，不再做额外确认。`);

    new Setting(containerEl)
      .setName("记忆源目录")
      .setDesc("每行一个 vault 内目录。只有这些目录里的 markdown 会被抽成 memory notes。")
      .addTextArea((text) =>
        text
          .setPlaceholder("Daily Notes\n文科")
          .setValue(this.plugin.settings.memorySourcePaths.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.memorySourcePaths = value
              .split(/\r?\n/)
              .map((item) => item.trim())
              .filter(Boolean);
            await this.plugin.handleMemorySettingsChanged();
          }),
      );

    new Setting(containerEl)
      .setName("记忆目录")
      .setDesc("生成的原子记忆笔记存放在这个 vault 目录下，默认是 memory。")
      .addText((text) =>
        text.setPlaceholder("memory").setValue(this.plugin.settings.memoryFolderPath).onChange(async (value) => {
          this.plugin.settings.memoryFolderPath = value.trim() || "memory";
          await this.plugin.handleMemorySettingsChanged();
        }),
      );

    new Setting(containerEl)
      .setName("自动增量刷新记忆")
      .setDesc("监听 vault 变化并按 Git diff 或文件指纹更新 memory graph。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoScanMemory).onChange(async (value) => {
          this.plugin.settings.autoScanMemory = value;
          await this.plugin.persistState();
        }),
      );

    new Setting(containerEl)
      .setName("记忆注入策略")
      .setDesc("显式回忆类问题会做广义检索，普通聊天只有命中高置信人名或事件名时才做双链扩散。");

    new Setting(containerEl)
      .setName("机灵兔允许轻度粗口")
      .setDesc("关闭后仍然保留高共情语气，但不主动爆粗。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableProfanityRabbit).onChange(async (value) => {
          this.plugin.settings.enableProfanityRabbit = value;
          await this.plugin.persistState();
        }),
      );

    new Setting(containerEl)
      .setName("启用宠物动画")
      .setDesc("关闭后仍显示像素宠物，但固定在 idle 帧。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enablePetAnimations).onChange(async (value) => {
          this.plugin.settings.enablePetAnimations = value;
          this.plugin.refreshViews();
          await this.plugin.persistState();
        }),
      );
  }
}
