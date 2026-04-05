import { Notice, Plugin, TAbstractFile, TFile } from "obsidian";

import { type MemoryGitChangeSet, LayeredMemoryService } from "./memory";
import { buildMemoryExtractionPrompt, parseMemoryExtractionResponse, type MemoryExtractionAtom } from "./memory-extraction";
import { detectMentionedPets, getPetProfile, getPetRuntimeSettings } from "./pets";
import { getPetPromptFilePath, PetPromptStore } from "./prompt-store";
import { CodexCliProvider } from "./provider";
import { DEFAULT_SETTINGS, normalizeLoadedSettings, PetAgentsSettingTab } from "./settings";
import { refreshLayeredMemoryFromSlash } from "./slash-actions";
import type {
  ChatMessage,
  ChatThreadState,
  MemoryContext,
  MemoryIndexState,
  PetAgentId,
  PetAgentsPluginData,
  PetAgentsSettings,
  PetVisualState,
  ProviderHealth,
} from "./types";
import { PET_AGENTS_VIEW_TYPE, PetAgentsView } from "./view";

declare const require: NodeRequire;

interface ChildProcessModule {
  execFile: typeof import("child_process").execFile;
}

const DEFAULT_THREAD_ID = "main";

interface RuntimeState {
  isBusy: boolean;
  statusText: string;
  providerHealth?: ProviderHealth;
  providerHealthCheckedAt?: number;
  petStates: Record<PetAgentId, PetVisualState>;
  activeSpeakerPetId?: PetAgentId;
  activeWorkerPetId?: PetAgentId;
  latestAssistantPetId?: PetAgentId;
}

interface UserTurnInput {
  displayText: string;
  promptText: string;
  queryText: string;
}

function getRequire(): NodeRequire {
  const scopedWindow = window as Window & { require?: NodeRequire };
  if (typeof scopedWindow.require === "function") {
    return scopedWindow.require;
  }
  return require;
}

function childProcess(): ChildProcessModule {
  return getRequire()("child_process") as ChildProcessModule;
}

function isWindowsShell(): boolean {
  return navigator.userAgent.toLowerCase().includes("windows");
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clip(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

function createDefaultThread(): ChatThreadState {
  return {
    id: DEFAULT_THREAD_ID,
    title: "主会话",
    currentPetId: "engineer-mole",
    engineerTaskMode: false,
    messages: [],
    petSessions: {},
    summary: "",
    updatedAt: Date.now(),
  };
}

function initialPetStates(): Record<PetAgentId, PetVisualState> {
  return {
    "engineer-mole": "idle",
    "scholar-panda": "idle",
    "homie-rabbit": "idle",
  };
}

function createEmptyMemoryIndexState(memoryFolderPath: string): MemoryIndexState {
  return {
    schemaVersion: 2,
    lastSyncAt: 0,
    lastIndexedCommit: "",
    sourceFiles: {},
    memoryFolderPath,
    activeMemoryCount: 0,
    archivedMemoryCount: 0,
  };
}

function parseGitStatusPaths(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .flatMap((line) => {
      const rawPath = line.slice(3).trim();
      if (rawPath.includes(" -> ")) {
        const [oldPath, nextPath] = rawPath.split(" -> ").map((item) => normalizeVaultPath(item));
        return [oldPath, nextPath];
      }
      return [normalizeVaultPath(rawPath)];
    });
}

export default class PetAgentsPlugin extends Plugin {
  settings: PetAgentsSettings = { ...DEFAULT_SETTINGS };
  pluginData: PetAgentsPluginData = {
    settings: { ...DEFAULT_SETTINGS },
    memory: createEmptyMemoryIndexState(DEFAULT_SETTINGS.memoryFolderPath),
    threads: {
      [DEFAULT_THREAD_ID]: createDefaultThread(),
    },
  };

  memoryService!: LayeredMemoryService;
  promptStore!: PetPromptStore;
  runtimeState: RuntimeState = {
    isBusy: false,
    statusText: "等待输入",
    petStates: initialPetStates(),
  };

  private readonly provider = new CodexCliProvider(() => ({
    executable: this.settings.codexExecutable,
    model: this.settings.codexModel,
    profile: this.settings.codexProfile,
  }));

  private readonly listeners = new Set<() => void>();
  private persistTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadPluginState();

    this.promptStore = new PetPromptStore(this);
    await this.promptStore.initialize();
    this.memoryService = new LayeredMemoryService(this, this.pluginData.memory);
    this.registerView(PET_AGENTS_VIEW_TYPE, (leaf) => new PetAgentsView(leaf, this));

    this.addRibbonIcon("bot", "Open OBS Pet Agents", () => void this.activateView());
    this.addCommand({
      id: "open-pet-agents",
      name: "Open Pet Agents",
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: "pet-agents-rescan-memory",
      name: "Refresh memory graph",
      callback: async () => {
        await this.memoryService.fullScan(true);
        this.runtimeState.statusText = "记忆图谱已刷新。";
        this.refreshViews();
      },
    });
    this.addCommand({
      id: "pet-agents-reset-thread",
      name: "Clear current pet conversation",
      callback: async () => this.resetConversation(),
    });
    this.addCommand({
      id: "pet-agents-switch-mole",
      name: "Switch main pet to 工程鼠",
      callback: () => this.switchPet("engineer-mole"),
    });
    this.addCommand({
      id: "pet-agents-switch-panda",
      name: "Switch main pet to 博士熊",
      callback: () => this.switchPet("scholar-panda"),
    });
    this.addCommand({
      id: "pet-agents-switch-rabbit",
      name: "Switch main pet to 机灵兔",
      callback: () => this.switchPet("homie-rabbit"),
    });

    this.addSettingTab(new PetAgentsSettingTab(this.app, this));

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.promptStore.handlesPath(file.path)) {
          void this.reloadPromptFiles(false);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (this.promptStore.handlesPath(file.path)) {
          void this.reloadPromptFiles(false);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (this.promptStore.handlesPath(file.path)) {
          void this.reloadPromptFiles(false);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        if (this.promptStore.handlesPath(oldPath) || this.promptStore.handlesPath(file.path)) {
          void this.reloadPromptFiles(false);
        }
      }),
    );

    const refreshMemory = () => {
      void this.memoryService.fullScan(false).then(() => this.refreshViews());
    };

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (
          this.settings.autoScanMemory &&
          file instanceof TFile &&
          file.extension === "md" &&
          !this.memoryService.isManagedMemoryPath(file.path) &&
          this.memoryService.isSourcePath(file.path)
        ) {
          refreshMemory();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (
          this.settings.autoScanMemory &&
          file instanceof TFile &&
          file.extension === "md" &&
          !this.memoryService.isManagedMemoryPath(file.path) &&
          this.memoryService.isSourcePath(file.path)
        ) {
          refreshMemory();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (
          this.settings.autoScanMemory &&
          !this.memoryService.isManagedMemoryPath(file.path) &&
          this.memoryService.isSourcePath(file.path)
        ) {
          refreshMemory();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
        if (
          !this.settings.autoScanMemory ||
          this.memoryService.isManagedMemoryPath(oldPath) ||
          this.memoryService.isManagedMemoryPath(file.path) ||
          (!this.memoryService.isSourcePath(oldPath) && !this.memoryService.isSourcePath(file.path))
        ) {
          return;
        }
        refreshMemory();
      }),
    );

    void this.memoryService.initialize().then(() => this.refreshViews());
    void this.refreshProviderHealth();
  }

  onunload(): void {
    this.listeners.clear();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  refreshViews(): void {
    this.listeners.forEach((listener) => listener());
  }

  schedulePersist(): void {
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
    }

    this.persistTimer = window.setTimeout(() => {
      void this.persistState();
    }, 250);
  }

  async persistState(): Promise<void> {
    this.pluginData = {
      settings: this.settings,
      memory: this.memoryService ? this.memoryService.snapshot : this.pluginData.memory,
      threads: this.pluginData.threads,
    };

    await this.saveData(this.pluginData);
  }

  async handleMemorySettingsChanged(): Promise<void> {
    await this.persistState();
    await this.memoryService.fullScan(true);
    this.runtimeState.statusText = "记忆源目录已更新。";
    this.refreshViews();
  }

  async reloadPromptFiles(manual: boolean): Promise<void> {
    await this.promptStore.reloadAll();
    if (manual) {
      this.runtimeState.statusText = "宠物提示词已重载。";
      new Notice("宠物提示词已重载。");
    }
    this.refreshViews();
  }

  getPetPromptPath(petId: PetAgentId): string {
    return getPetPromptFilePath(petId);
  }

  async openPetPromptFile(petId: PetAgentId): Promise<void> {
    await this.promptStore.ensureDefaultFiles();
    const path = this.getPetPromptPath(petId);
    const file = this.app.vault.getAbstractFileByPath(path);

    if (!(file instanceof TFile)) {
      new Notice(`找不到提示词文件：${path}`);
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.openFile(file);
  }

  getActiveThread(): ChatThreadState {
    if (!this.pluginData.threads[DEFAULT_THREAD_ID]) {
      this.pluginData.threads[DEFAULT_THREAD_ID] = createDefaultThread();
    }
    return this.pluginData.threads[DEFAULT_THREAD_ID];
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PET_AGENTS_VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getRightLeaf(false);

    if (!leaf) {
      new Notice("无法创建 Pet Agents 视图。");
      return;
    }

    await leaf.setViewState({ type: PET_AGENTS_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  switchPet(petId: PetAgentId): void {
    const thread = this.getActiveThread();
    thread.currentPetId = petId;

    if (petId !== "engineer-mole") {
      thread.engineerTaskMode = false;
    }

    thread.updatedAt = Date.now();
    this.runtimeState.statusText = `${getPetProfile(petId).name} 已成为当前主讲宠物。`;
    this.schedulePersist();
    this.refreshViews();
  }

  async toggleEngineerTaskMode(): Promise<void> {
    const thread = this.getActiveThread();
    if (thread.currentPetId !== "engineer-mole") {
      new Notice("只有工程鼠可以进入任务模式。");
      return;
    }

    const nextState = !thread.engineerTaskMode;
    thread.engineerTaskMode = nextState;
    thread.updatedAt = Date.now();
    this.runtimeState.statusText = nextState ? "工程鼠已进入任务模式。" : "工程鼠已回到聊天模式。";
    this.schedulePersist();
    this.refreshViews();
  }

  async resetConversation(): Promise<void> {
    const currentThread = this.getActiveThread();
    const nextThread = createDefaultThread();
    nextThread.currentPetId = currentThread.currentPetId;

    this.pluginData.threads[DEFAULT_THREAD_ID] = nextThread;
    this.runtimeState.statusText = "当前会话已清空。";
    this.runtimeState.activeSpeakerPetId = undefined;
    this.runtimeState.activeWorkerPetId = undefined;
    this.runtimeState.latestAssistantPetId = undefined;
    this.runtimeState.petStates = initialPetStates();
    await this.persistState();
    this.refreshViews();
  }

  async rescanLayeredMemory(manual: boolean): Promise<void> {
    await refreshLayeredMemoryFromSlash(this);
    if (manual) {
      new Notice("记忆图谱已刷新。");
    }
  }

  async sendUserMessage(input: string | UserTurnInput): Promise<void> {
    if (this.runtimeState.isBusy) {
      new Notice("当前还有一轮对话在处理中。");
      return;
    }

    await this.ensureProviderHealth();
    if (!this.runtimeState.providerHealth?.ok) {
      new Notice(this.runtimeState.providerHealth?.error ?? "Codex 不可用。");
      this.refreshViews();
      return;
    }

    const displayText = typeof input === "string" ? input : input.displayText;
    const promptText = typeof input === "string" ? input : input.promptText;
    const queryText = typeof input === "string" ? input : input.queryText;
    const thread = this.getActiveThread();

    thread.messages.push({
      id: nowId("user"),
      role: "user",
      text: displayText,
      timestamp: Date.now(),
    });
    thread.updatedAt = Date.now();
    thread.summary = this.buildThreadSummary(thread.messages);

    this.runtimeState.isBusy = true;
    this.runtimeState.activeWorkerPetId = thread.currentPetId;
    this.runtimeState.statusText = `正在等待 ${getPetProfile(thread.currentPetId).name} 回应。`;
    this.refreshViews();
    this.schedulePersist();

    try {
      const primaryPet = thread.currentPetId;
      const primaryReply = await this.runPetTurn({
        petId: primaryPet,
        userText: promptText,
        memoryQueryText: queryText,
        collaborator: false,
      });

      const collaborators = detectMentionedPets(queryText).filter((petId) => petId !== primaryPet);
      for (const petId of collaborators) {
        await this.runPetTurn({
          petId,
          userText: `${promptText}\n\nPrimary pet reply:\n${primaryReply}`,
          memoryQueryText: queryText,
          collaborator: true,
        });
      }

      thread.summary = this.buildThreadSummary(thread.messages);
      this.runtimeState.statusText = "本轮对话完成。";
    } catch (error) {
      this.runtimeState.statusText = error instanceof Error ? error.message : String(error);
      new Notice(`Pet Agents 错误：${this.runtimeState.statusText}`);
    } finally {
      this.runtimeState.isBusy = false;
      this.runtimeState.activeWorkerPetId = undefined;
      this.resetPetStates();
      thread.updatedAt = Date.now();
      await this.persistState();
      this.refreshViews();
    }
  }

  async extractMemoryAtoms(input: { path: string; content: string }): Promise<MemoryExtractionAtom[]> {
    await this.ensureProviderHealth();
    if (!this.runtimeState.providerHealth?.ok) {
      throw new Error(this.runtimeState.providerHealth?.error ?? "Codex 不可用，无法抽取记忆。");
    }

    const requestId = nowId("memory");
    const result = await this.provider.runTurn({
      prompt: buildMemoryExtractionPrompt(input),
      cwd: this.getVaultBasePath(),
      mode: "chat",
      model: this.settings.codexModel || this.settings.petRuntimeSettings["engineer-mole"].model || "gpt-5.4",
      reasoningEffort: "medium",
      executionPolicy: "read-only",
      requestId,
    });

    return parseMemoryExtractionResponse(result.text);
  }

  async getGitChanges(sourcePaths: string[], lastIndexedCommit: string): Promise<MemoryGitChangeSet | null> {
    const normalizedPaths = sourcePaths.map((path) => normalizeVaultPath(path)).filter(Boolean);
    if (normalizedPaths.length === 0) {
      return { paths: [], headCommit: "" };
    }

    try {
      const headCommit = (await this.execGit(["rev-parse", "HEAD"])).trim();
      const argsSuffix = ["--", ...normalizedPaths];
      const committedOutput =
        lastIndexedCommit && lastIndexedCommit !== headCommit
          ? await this.execGit(["diff", "--name-only", `${lastIndexedCommit}..${headCommit}`, ...argsSuffix])
          : "";
      const statusOutput = await this.execGit(["status", "--porcelain", "--untracked-files=all", ...argsSuffix]);
      const committedPaths = committedOutput
        .split(/\r?\n/)
        .map((line) => normalizeVaultPath(line.trim()))
        .filter(Boolean);
      const statusPaths = parseGitStatusPaths(statusOutput);

      return {
        paths: Array.from(new Set(committedPaths.concat(statusPaths))),
        headCommit,
      };
    } catch {
      return null;
    }
  }

  private async runPetTurn(options: {
    petId: PetAgentId;
    userText: string;
    memoryQueryText: string;
    collaborator: boolean;
  }): Promise<string> {
    const thread = this.getActiveThread();
    const pet = getPetProfile(options.petId);
    const petRuntimeSettings = getPetRuntimeSettings(options.petId, this.settings.petRuntimeSettings, this.settings.codexModel || "gpt-5.4");
    const mode = options.petId === "engineer-mole" && thread.engineerTaskMode ? "task" : "chat";
    const memory = this.memoryService.buildContext({
      petId: options.petId,
      query: options.memoryQueryText,
      conversation: thread.messages,
    });
    const storedSession = thread.petSessions[options.petId];
    const session = storedSession?.mode === mode ? storedSession : undefined;

    const pendingMessage: ChatMessage = {
      id: nowId("assistant"),
      role: "assistant",
      petId: options.petId,
      model: petRuntimeSettings.model,
      reasoningEffort: petRuntimeSettings.reasoningEffort,
      text: mode === "task" ? "正在处理任务..." : "正在思考...",
      timestamp: Date.now(),
      pending: true,
      collaborator: options.collaborator,
      mode,
      memoryHits: memory.capsules.map((item) => item.title),
      sources: Array.from(
        new Set(
          memory.details
            .concat(memory.capsules)
            .flatMap((item) => (item.sourcePaths.length > 0 ? item.sourcePaths : [item.path])),
        ),
      ).slice(0, 12),
    };
    thread.messages.push(pendingMessage);

    this.runtimeState.activeWorkerPetId = options.petId;
    this.runtimeState.statusText = mode === "task" ? `${pet.name} 正在工作。` : `${pet.name} 正在回复。`;
    this.setPetState(options.petId, "thinking");
    this.refreshViews();

    const prompt = this.buildPrompt({
      petId: options.petId,
      userText: options.userText,
      collaborator: options.collaborator,
      memory,
      mode,
    });

    try {
      const result = await this.provider.runTurn(
        {
          prompt,
          sessionId: session?.providerSessionId,
          cwd: this.getVaultBasePath(),
          mode,
          model: petRuntimeSettings.model,
          reasoningEffort: petRuntimeSettings.reasoningEffort,
          executionPolicy: this.settings.taskExecutionPolicy,
          requestId: nowId("turn"),
        },
        (event) => {
          if ((event.type === "message-delta" || event.type === "message") && event.text) {
            pendingMessage.text =
              event.type === "message-delta"
                ? `${pendingMessage.text === "正在思考..." || pendingMessage.text === "正在处理任务..." ? "" : pendingMessage.text}${event.text}`
                : event.text;

            this.runtimeState.activeSpeakerPetId = options.petId;
            this.runtimeState.latestAssistantPetId = options.petId;
            this.runtimeState.statusText = mode === "task" ? `${pet.name} 正在执行并汇报。` : `${pet.name} 正在说话。`;
            this.setPetState(options.petId, "speaking");
            this.refreshViews();
          }
        },
      );

      pendingMessage.pending = false;
      pendingMessage.text = result.text || pendingMessage.text || "（没有拿到文本输出）";
      pendingMessage.sources = Array.from(new Set(pendingMessage.sources ?? []));

      thread.petSessions[options.petId] = {
        providerSessionId: result.sessionId,
        mode,
        turns: (session?.turns ?? 0) + 1,
        updatedAt: Date.now(),
      };

      this.runtimeState.activeSpeakerPetId = options.petId;
      this.runtimeState.latestAssistantPetId = options.petId;
      this.runtimeState.activeWorkerPetId = undefined;
      this.runtimeState.statusText = options.collaborator ? `${pet.name} 已补充回复。` : `${pet.name} 已完成回复。`;
      this.setPetState(options.petId, "speaking");

      window.setTimeout(() => {
        this.setPetState(options.petId, "idle");
        this.refreshViews();
      }, 800);

      return pendingMessage.text;
    } catch (error) {
      pendingMessage.pending = false;
      pendingMessage.text = `请求失败：${error instanceof Error ? error.message : String(error)}`;
      this.runtimeState.activeSpeakerPetId = options.petId;
      this.runtimeState.activeWorkerPetId = undefined;
      this.runtimeState.statusText = `${pet.name} 的请求失败了。`;
      this.setPetState(options.petId, "error");
      this.refreshViews();
      throw error;
    }
  }

  private buildPrompt(options: {
    petId: PetAgentId;
    userText: string;
    collaborator: boolean;
    memory: MemoryContext;
    mode: "chat" | "task";
  }): string {
    const thread = this.getActiveThread();
    const systemPrompt = this.promptStore.getPrompt(options.petId);
    const conversation = thread.messages
      .filter((message) => message.role !== "status")
      .slice(-8)
      .map((message) => {
        const speaker = message.role === "user" ? "用户" : message.petId ? getPetProfile(message.petId).name : "宠物";
        return `${speaker}: ${clip(message.text.replace(/\s+/g, " ").trim(), 180)}`;
      })
      .join("\n");

    const memoryCapsules = options.memory.capsules.length > 0 ? options.memory.capsules.map((item) => `- ${item.text}`).join("\n") : "- 无";
    const memoryDetails = options.memory.details.length > 0 ? options.memory.details.map((item) => `- ${item.text}`).join("\n") : "- 无";
    const rabbitStyle =
      options.petId === "homie-rabbit"
        ? this.settings.enableProfanityRabbit
          ? "额外要求：你是一个温柔、机灵、站在用户这边的女生。可以偶尔说一点轻度、温柔的口头脏话，比如“烦死了”“离谱”“见鬼”“真够呛”，但不要说“操”这种太粗暴的词，也不要攻击用户。"
          : "额外要求：你是一个温柔、机灵、站在用户这边的女生。不主动说脏话，但仍然保持鲜活、亲近和共情。"
        : "";

    const modeRules =
      options.mode === "task"
        ? "当前是任务模式。你可以使用 Codex 的任务能力执行必要操作。先判断目标，再执行，再用中文简洁汇报结果、风险和下一步。"
        : "当前是普通聊天模式。不要运行命令，不要编辑文件，不要假装执行过任何任务。只做文本回答。";

    const collaboratorRules = options.collaborator
      ? "你不是本轮主讲者。请基于主讲宠物刚刚的回答，只补充新的角度、提醒或情绪支持，不要复述已有内容。控制在 4 到 8 句。"
      : "你是本轮主讲宠物。保持你的角色设定，优先直接回答用户。";
    const memorySections = options.memory.relevant
      ? [
          "如果引用到记忆，不要装作百分之百确定；能自然就自然，不能自然就不要硬塞。",
          options.memory.mode === "broad"
            ? "记忆注入策略：这是显式回忆类问题，优先给出直接命中的记忆摘要，再按双链扩散补充关联上下文。"
            : "记忆注入策略：这是普通聊天里的高置信实体命中，只注入局部图谱，不做泛化回忆。",
          "[记忆摘要]",
          memoryCapsules,
          "[展开记忆]",
          memoryDetails,
        ]
      : [];

    return [
      "你正在 Obsidian 插件内回复用户。",
      "角色设定（来自 vault 提示词文件）：",
      systemPrompt,
      rabbitStyle,
      modeRules,
      collaboratorRules,
      "[当前会话摘要]",
      options.memory.sessionSummary ?? "无",
      ...memorySections,
      "[最近对话]",
      conversation || "无",
      "[用户本轮输入]",
      options.userText,
      "[回答要求]",
      "用中文回答。保持角色感，不要提到你在读提示词。必要时可以分段，但不要啰嗦。",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  private async loadPluginState(): Promise<void> {
    const stored = (await this.loadData()) as Partial<PetAgentsPluginData> | null;
    const { settings, migrated } = normalizeLoadedSettings(stored?.settings);

    this.settings = settings;
    this.pluginData = {
      settings: this.settings,
      memory: (stored?.memory as MemoryIndexState | undefined) ?? createEmptyMemoryIndexState(this.settings.memoryFolderPath),
      threads:
        stored?.threads && Object.keys(stored.threads).length > 0
          ? stored.threads
          : {
              [DEFAULT_THREAD_ID]: createDefaultThread(),
            },
    };

    if (migrated) {
      await this.saveData(this.pluginData);
    }
  }

  private buildThreadSummary(messages: ChatMessage[]): string {
    return messages
      .filter((message) => message.role !== "status")
      .slice(-8)
      .map((message) => {
        const speaker = message.role === "user" ? "用户" : message.petId ? getPetProfile(message.petId).shortName : "宠物";
        return `${speaker}: ${clip(message.text.replace(/\s+/g, " ").trim(), 80)}`;
      })
      .join("\n");
  }

  private setPetState(petId: PetAgentId, state: PetVisualState): void {
    this.runtimeState.petStates[petId] = state;
  }

  private resetPetStates(): void {
    this.runtimeState.petStates = initialPetStates();
  }

  private async refreshProviderHealth(): Promise<void> {
    this.runtimeState.providerHealth = await this.provider.healthCheck();
    this.runtimeState.providerHealthCheckedAt = Date.now();
    this.refreshViews();
  }

  private async ensureProviderHealth(): Promise<void> {
    const stale = !this.runtimeState.providerHealthCheckedAt || Date.now() - this.runtimeState.providerHealthCheckedAt > 5 * 60 * 1000;
    if (stale) {
      await this.refreshProviderHealth();
    }
  }

  private async execGit(args: string[]): Promise<string> {
    const basePath = this.getVaultBasePath();
    return await new Promise<string>((resolve, reject) => {
      childProcess().execFile(
        "git",
        ["-C", basePath, ...args],
        { shell: isWindowsShell() },
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }

          resolve((stdout || stderr).trim());
        },
      );
    });
  }

  getVaultBasePath(): string {
    const adapter = this.app.vault.adapter as { getBasePath?: () => string; basePath?: string };
    const basePath = adapter.getBasePath?.() ?? adapter.basePath;

    if (!basePath) {
      throw new Error("当前 vault 不是本地桌面仓库，无法调用本地 Codex。");
    }

    return basePath;
  }
}
