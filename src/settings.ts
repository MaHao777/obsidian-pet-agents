import { App, PluginSettingTab, Setting } from "obsidian";

import { createDefaultPetRuntimeSettings, PET_PROFILES, reasoningEffortLabel } from "./pets";
import type { PetAgentsSettings, TaskExecutionPolicy } from "./types";
import type PetAgentsPlugin from "./main";

export const DEFAULT_SETTINGS: PetAgentsSettings = {
  providerKind: "codex-cli",
  codexExecutable: "codex",
  codexModel: "",
  codexProfile: "",
  petRuntimeSettings: createDefaultPetRuntimeSettings(),
  taskExecutionPolicy: "workspace-write",
  taskModeConfirmation: true,
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

export class PetAgentsSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: PetAgentsPlugin) {
    super(app, plugin);
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

    new Setting(containerEl)
      .setName("Codex 可执行文件")
      .setDesc("默认直接调用 `codex`。如果你放在了别的路径，可以在这里改。")
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
        .setName(`${profile.name}模型`)
        .setDesc(`留空时会回退到 ${runtimeSettings.model || "gpt-5.4"}。推荐保持为 gpt-5.4。`)
        .addText((text) =>
          text.setValue(runtimeSettings.model).onChange(async (value) => {
            await this.savePetModel(profile.id, value);
          }),
        );

      new Setting(containerEl)
        .setName(`${profile.name}思考强度`)
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
      .setName("工程师任务权限")
      .setDesc("仅工程鼠的任务模式会用到这个权限预设。")
      .addDropdown((dropdown) => {
        (["read-only", "workspace-write", "danger-full-access"] as TaskExecutionPolicy[]).forEach((policy) =>
          dropdown.addOption(policy, policyLabel(policy)),
        );

        dropdown.setValue(this.plugin.settings.taskExecutionPolicy).onChange(async (value) => {
          this.plugin.settings.taskExecutionPolicy = value as TaskExecutionPolicy;
          await this.plugin.persistState();
        });
      });

    new Setting(containerEl)
      .setName("任务模式二次确认")
      .setDesc("开启后，每次从界面切到任务模式都要再确认一次。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.taskModeConfirmation).onChange(async (value) => {
          this.plugin.settings.taskModeConfirmation = value;
          await this.plugin.persistState();
        }),
      );

    new Setting(containerEl)
      .setName("记忆白名单目录")
      .setDesc("每行一个 vault 内路径。留空时只靠日记目录启发式。")
      .addTextArea((text) =>
        text
          .setPlaceholder("Projects\nDaily Notes")
          .setValue(this.plugin.settings.memoryWhitelistPaths.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.memoryWhitelistPaths = value
              .split(/\r?\n/)
              .map((item) => item.trim())
              .filter(Boolean);
            await this.plugin.handleMemorySettingsChanged();
          }),
      );

    new Setting(containerEl)
      .setName("日记目录关键词")
      .setDesc("主动扫描时会优先命中这些目录名或路径片段。")
      .addTextArea((text) =>
        text
          .setPlaceholder("Daily Notes\nDiary\n日记")
          .setValue(this.plugin.settings.diaryFolderHints.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.diaryFolderHints = value
              .split(/\r?\n/)
              .map((item) => item.trim())
              .filter(Boolean);
            await this.plugin.handleMemorySettingsChanged();
          }),
      );

    new Setting(containerEl)
      .setName("自动增量扫描记忆")
      .setDesc("监听 vault 里的 Markdown 变化并更新记忆索引。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoScanMemory).onChange(async (value) => {
          this.plugin.settings.autoScanMemory = value;
          await this.plugin.persistState();
        }),
      );

    new Setting(containerEl)
      .setName("每轮注入的关键记忆数")
      .setDesc("只把顶层胶囊记忆塞进上下文，避免把上下文挤爆。")
      .addSlider((slider) =>
        slider
          .setLimits(1, 8, 1)
          .setValue(this.plugin.settings.memoryCapsuleLimit)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.memoryCapsuleLimit = value;
            await this.plugin.persistState();
          }),
      );

    new Setting(containerEl)
      .setName("细节记忆上限")
      .setDesc("只有用户明显索要细节时，才把这部分原始片段补进上下文。")
      .addSlider((slider) =>
        slider
          .setLimits(0, 5, 1)
          .setValue(this.plugin.settings.memoryDetailLimit)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.memoryDetailLimit = value;
            await this.plugin.persistState();
          }),
      );

    new Setting(containerEl)
      .setName("机灵兔允许粗口")
      .setDesc("关掉后仍然保留高共情语气，但不主动爆粗。")
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
