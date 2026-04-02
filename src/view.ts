import { ItemView, WorkspaceLeaf } from "obsidian";

import {
  applyMentionSuggestion,
  findMentionTrigger,
  getMentionSuggestions,
  getNextPrimaryPet,
  getPreviousPrimaryPet,
  type MentionTrigger,
} from "./composer";
import {
  getPetAnimationPhase,
  getPetAvatar,
  getPetFrames,
  getPetProfile,
  getPetRuntimeSettings,
  PET_PROFILES,
  reasoningEffortLabel,
} from "./pets";
import type PetAgentsPlugin from "./main";
import type { AgentProfile, ChatMessage, PetAgentId } from "./types";

export const PET_AGENTS_VIEW_TYPE = "obs-pet-agents-view";

type SpriteRef = {
  el: HTMLImageElement;
  petId: PetAgentId;
};

function relativeTime(timestamp: number): string {
  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (diffMinutes < 1) {
    return "刚刚";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }

  return `${Math.floor(diffHours / 24)} 天前`;
}

function clip(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function nearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 40;
}

export class PetAgentsView extends ItemView {
  private unsubscribe?: () => void;
  private spriteRefs: SpriteRef[] = [];
  private frameTick = 0;

  private selectedHeaderPetId: PetAgentId | null = null;
  private statusPanelExpanded = false;
  private composerSettingsExpanded = false;
  private expandedMessageMetaIds = new Set<string>();
  private isPinnedToBottom = true;

  private shellEl!: HTMLDivElement;
  private messagesEl!: HTMLDivElement;
  private composerEl!: HTMLDivElement;
  private settingsPanelEl!: HTMLDivElement;
  private petSwitchEl!: HTMLDivElement;
  private mentionActionsEl!: HTMLDivElement;
  private taskSlotEl!: HTMLDivElement;
  private overflowActionsEl!: HTMLDivElement;
  private inputShellEl!: HTMLDivElement;
  private textareaEl!: HTMLTextAreaElement;
  private composerToggleEl!: HTMLButtonElement;
  private mentionPopupEl!: HTMLDivElement;
  private mentionListEl!: HTMLDivElement;
  private petButtons = new Map<PetAgentId, HTMLButtonElement>();
  private mentionSuggestions: AgentProfile[] = [];
  private mentionSelectionIndex = 0;
  private activeMentionTrigger: MentionTrigger | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: PetAgentsPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return PET_AGENTS_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Pet Agents";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("pet-agents-view");
    this.createLayout();
    this.unsubscribe = this.plugin.subscribe(() => this.render());
    this.registerInterval(window.setInterval(() => this.tickSprites(), 320));
    this.render();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.spriteRefs = [];
  }

  private createLayout(): void {
    this.selectedHeaderPetId = null;
    this.statusPanelExpanded = false;
    this.composerSettingsExpanded = false;
    this.expandedMessageMetaIds.clear();
    this.isPinnedToBottom = true;

    this.contentEl.empty();
    this.spriteRefs = [];

    this.shellEl = this.contentEl.createDiv({ cls: "pet-agents-shell" });

    this.messagesEl = this.shellEl.createDiv({ cls: "pet-agents-messages" });
    this.messagesEl.addEventListener("scroll", () => {
      this.isPinnedToBottom = nearBottom(this.messagesEl);
    });

    this.composerEl = this.shellEl.createDiv({ cls: "pet-agents-composer" });
    this.inputShellEl = this.composerEl.createDiv({ cls: "pet-agents-input-shell" });
    this.settingsPanelEl = this.inputShellEl.createDiv({ cls: "pet-agents-settings-panel" });

    const mainPetSection = this.settingsPanelEl.createDiv({ cls: "pet-agents-settings-section" });
    const petHead = mainPetSection.createDiv({ cls: "pet-agents-settings-head" });
    petHead.createSpan({ cls: "pet-agents-settings-label", text: "主讲宠物" });
    this.petSwitchEl = mainPetSection.createDiv({ cls: "pet-agents-pet-switch" });
    PET_PROFILES.forEach((profile) => {
      const button = this.petSwitchEl.createEl("button", {
        cls: "pet-agents-segment-button",
        text: profile.shortName,
      });
      button.type = "button";
      button.onclick = () => this.plugin.switchPet(profile.id);
      this.petButtons.set(profile.id, button);
    });

    const mentionSection = this.settingsPanelEl.createDiv({ cls: "pet-agents-settings-section" });
    mentionSection.createSpan({ cls: "pet-agents-settings-label", text: "协作插入" });
    this.mentionActionsEl = mentionSection.createDiv({ cls: "pet-agents-popover-actions" });
    PET_PROFILES.forEach((profile) => {
      const button = this.mentionActionsEl.createEl("button", {
        cls: "pet-agents-popover-button",
        text: `@${profile.shortName}`,
      });
      button.type = "button";
      button.onclick = () => this.insertMention(profile.shortName);
    });

    const actionsSection = this.settingsPanelEl.createDiv({ cls: "pet-agents-settings-section" });
    actionsSection.createSpan({ cls: "pet-agents-settings-label", text: "更多操作" });
    const actionsRow = actionsSection.createDiv({ cls: "pet-agents-toolbar-group pet-agents-toolbar-group-actions" });
    this.taskSlotEl = actionsRow.createDiv({ cls: "pet-agents-task-slot" });
    this.overflowActionsEl = actionsRow.createDiv({ cls: "pet-agents-overflow-inline" });

    this.textareaEl = this.inputShellEl.createEl("textarea", {
      cls: "pet-agents-input",
      attr: { rows: "2" },
    });
    this.textareaEl.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" && this.isMentionPopupOpen()) {
        event.preventDefault();
        this.shiftMentionSelection(1);
        return;
      }

      if (event.key === "ArrowUp" && this.isMentionPopupOpen()) {
        event.preventDefault();
        this.shiftMentionSelection(-1);
        return;
      }

      if (event.key === "Escape" && this.isMentionPopupOpen()) {
        event.preventDefault();
        this.closeMentionPopup();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        if (this.isMentionPopupOpen()) {
          this.acceptMentionSelection();
          return;
        }

        const currentPetId = this.plugin.getActiveThread().currentPetId;
        const nextPetId = event.shiftKey ? getPreviousPrimaryPet(currentPetId) : getNextPrimaryPet(currentPetId);
        this.plugin.switchPet(nextPetId);
        this.textareaEl.focus();
        return;
      }

      if (event.key === "Enter" && this.isMentionPopupOpen()) {
        event.preventDefault();
        this.acceptMentionSelection();
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.sendCurrentInput();
      }
    });
    this.textareaEl.addEventListener("input", () => this.refreshMentionPopup());
    this.textareaEl.addEventListener("click", () => this.refreshMentionPopup());
    this.textareaEl.addEventListener("keyup", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === "Tab") {
        return;
      }
      this.refreshMentionPopup();
    });

    this.mentionPopupEl = this.inputShellEl.createDiv({ cls: "pet-agents-mention-popup" });
    const mentionHead = this.mentionPopupEl.createDiv({ cls: "pet-agents-mention-head" });
    mentionHead.createSpan({ text: "选择协作 agent" });
    this.mentionListEl = this.mentionPopupEl.createDiv({ cls: "pet-agents-mention-list" });

    this.composerToggleEl = this.inputShellEl.createEl("button", {
      cls: "pet-agents-composer-toggle",
      attr: {
        "aria-label": "打开输入设置",
        title: "输入设置",
      },
      text: "⚙",
    });
    this.composerToggleEl.type = "button";
    this.composerToggleEl.onclick = () => {
      this.composerSettingsExpanded = !this.composerSettingsExpanded;
      this.renderComposer();
    };
  }

  private render(): void {
    this.spriteRefs = [];
    this.renderMessages();
    this.renderComposer();
    this.tickSprites();
  }

  private renderStatusPanel(parent: HTMLElement): void {
    const thread = this.plugin.getActiveThread();
    const runtime = this.plugin.runtimeState;
    const currentSpeaker = runtime.activeSpeakerPetId ?? runtime.latestAssistantPetId ?? thread.currentPetId;
    const currentWorker = runtime.activeWorkerPetId;
    const currentPet = getPetProfile(thread.currentPetId);
    const currentSpeakerPet = getPetProfile(currentSpeaker);

    if (!this.statusPanelExpanded) {
      const launcher = parent.createDiv({ cls: "pet-agents-status-launcher" });
      const launcherButton = launcher.createEl("button", {
        cls: "pet-agents-status-toggle is-launcher",
        attr: {
          "aria-label": "打开宠物状态",
          title: "宠物状态",
        },
        text: "⚙",
      });
      launcherButton.type = "button";
      launcherButton.onclick = () => {
        this.statusPanelExpanded = true;
        if (!this.selectedHeaderPetId) {
          this.selectedHeaderPetId = currentSpeaker;
        }
        this.renderMessages();
        this.tickSprites();
      };
      return;
    }

    const card = parent.createDiv({ cls: "pet-agents-status-card is-expanded" });
    const top = card.createDiv({ cls: "pet-agents-status-top" });
    const summary = top.createDiv({ cls: "pet-agents-status-summary" });
    summary.createDiv({ cls: "pet-agents-status-title", text: "宠物状态" });
    summary.createDiv({
      cls: "pet-agents-status-copy",
      text: runtime.isBusy
        ? `${currentSpeakerPet.shortName} 正在处理`
        : `主讲 ${currentPet.shortName}，当前 ${currentSpeakerPet.shortName}`,
    });

    const toggle = top.createEl("button", {
      cls: "pet-agents-status-toggle",
      text: "收起",
    });
    toggle.type = "button";
    toggle.onclick = () => {
      this.statusPanelExpanded = false;
      this.renderMessages();
      this.tickSprites();
    };

    const body = card.createDiv({ cls: "pet-agents-status-body" });
    const petsEl = body.createDiv({ cls: "pet-agents-header-pets" });
    const detailEl = body.createDiv({ cls: "pet-agents-header-detail" });

    PET_PROFILES.forEach((profile) => {
      const button = petsEl.createEl("button", {
        cls: `pet-agents-header-pet ${thread.currentPetId === profile.id ? "is-current" : ""} ${
          currentSpeaker === profile.id ? "is-speaking" : ""
        } ${currentWorker === profile.id ? "is-working" : ""} ${
          this.selectedHeaderPetId === profile.id ? "is-selected" : ""
        }`,
        attr: {
          "aria-label": `${profile.name} 状态详情`,
        },
      });
      button.type = "button";
      button.onclick = () => {
        this.selectedHeaderPetId = this.selectedHeaderPetId === profile.id ? null : profile.id;
        this.renderMessages();
        this.tickSprites();
      };

      const sprite = button.createEl("img", {
        cls: "pet-agents-header-sprite",
        attr: {
          alt: profile.name,
          title: `${profile.name}：点击查看详情`,
        },
      });
      this.spriteRefs.push({ el: sprite, petId: profile.id });

      const markers = button.createDiv({ cls: "pet-agents-header-markers" });
      if (thread.currentPetId === profile.id) {
        markers.createSpan({ cls: "is-current", attr: { title: "当前主讲" } });
      }
      if (currentSpeaker === profile.id) {
        markers.createSpan({ cls: "is-speaking", attr: { title: "当前发言" } });
      }
      if (currentWorker === profile.id) {
        markers.createSpan({ cls: "is-working", attr: { title: "正在工作" } });
      }
    });

    detailEl.empty();
    detailEl.toggleClass("is-hidden", this.selectedHeaderPetId === null);
    if (!this.selectedHeaderPetId) {
      return;
    }

    const profile = getPetProfile(this.selectedHeaderPetId);
    const runtimeSettings = getPetRuntimeSettings(
      this.selectedHeaderPetId,
      this.plugin.settings.petRuntimeSettings,
      this.plugin.settings.codexModel || "gpt-5.4",
    );
    const latestMessage = [...thread.messages]
      .reverse()
      .find((message) => message.role === "assistant" && message.petId === this.selectedHeaderPetId);

    const detailTop = detailEl.createDiv({ cls: "pet-agents-header-detail-top" });
    const title = detailTop.createDiv({ cls: "pet-agents-header-detail-title" });
    title.createEl("strong", { text: profile.name });
    title.createSpan({ text: profile.title });

    const pills = detailTop.createDiv({ cls: "pet-agents-header-detail-pills" });
    if (thread.currentPetId === profile.id) {
      pills.createSpan({ text: "主讲" });
    }
    if (currentSpeaker === profile.id) {
      pills.createSpan({ text: "发言中" });
    }
    if (currentWorker === profile.id) {
      pills.createSpan({ text: "工作中" });
    }
    if (pills.childElementCount === 0) {
      pills.createSpan({ text: "待命" });
    }

    const detailCopy = detailEl.createDiv({ cls: "pet-agents-header-detail-copy" });
    detailCopy.createDiv({ text: profile.description });
    detailCopy.createDiv({
      text: runtime.providerHealth?.ok ? "Codex 已连接" : "Codex 连接异常",
    });
    detailCopy.createDiv({
      text: thread.engineerTaskMode && profile.id === "engineer-mole" ? "模式：任务" : "模式：聊天",
    });
    detailCopy.createDiv({
      text: `模型：${runtimeSettings.model}`,
    });
    detailCopy.createDiv({
      text: `思考强度：${reasoningEffortLabel(runtimeSettings.reasoningEffort)}`,
    });
    detailCopy.createDiv({
      text: `状态：${runtime.statusText}`,
    });

    const semanticCount = this.plugin.memoryService.snapshot.records.filter((record) => record.tier === "semantic").length;
    const detailMeta = detailEl.createDiv({ cls: "pet-agents-header-detail-meta" });
    detailMeta.createSpan({ text: `语义记忆 ${semanticCount}` });
    if (this.plugin.memoryService.snapshot.lastScanAt > 0) {
      detailMeta.createSpan({ text: `上次扫描 ${relativeTime(this.plugin.memoryService.snapshot.lastScanAt)}` });
    }

    if (latestMessage) {
      const quote = detailEl.createDiv({ cls: "pet-agents-header-detail-quote" });
      quote.createDiv({ cls: "pet-agents-header-detail-label", text: "最近一句" });
      quote.createDiv({ text: clip(latestMessage.text, 160) });
    }
  }

  private renderMessages(): void {
    const thread = this.plugin.getActiveThread();
    const previousBottomGap = this.messagesEl.scrollHeight - this.messagesEl.scrollTop;
    const shouldStickToBottom = this.isPinnedToBottom;

    this.messagesEl.empty();
    this.renderStatusPanel(this.messagesEl);

    if (thread.messages.length === 0) {
      const empty = this.messagesEl.createDiv({ cls: "pet-agents-empty" });
      empty.createEl("h3", { text: "开始对话吧" });
      empty.createEl("p", {
        text: "聊天顶部的状态卡默认折叠，点开后再看宠物详情。输入框里按 Tab 切换主讲，输入 @ 会弹出协作 agent 列表；右上角的设置图标会展开更多工具。",
      });
    } else {
      thread.messages.forEach((message) => this.renderMessage(message));
    }

    if (shouldStickToBottom) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    } else {
      this.messagesEl.scrollTop = Math.max(0, this.messagesEl.scrollHeight - previousBottomGap);
    }

    this.isPinnedToBottom = nearBottom(this.messagesEl);
  }

  private renderMessage(message: ChatMessage): void {
    const isUser = message.role === "user";
    const row = this.messagesEl.createDiv({
      cls: `pet-agents-message-row ${isUser ? "is-user" : ""} ${message.role === "status" ? "is-status" : ""}`,
    });

    if (message.role === "assistant" && message.petId) {
      row.createEl("img", {
        cls: "pet-agents-avatar",
        attr: { alt: getPetProfile(message.petId).name, src: getPetAvatar(message.petId) },
      });
    }

    const bubbleWrap = row.createDiv({ cls: "pet-agents-bubble-wrap" });
    const hasMeta = Boolean((message.memoryHits && message.memoryHits.length > 0) || (message.sources && message.sources.length > 0));

    if (message.role === "assistant" && message.petId) {
      const runtimeSettings = getPetRuntimeSettings(
        message.petId,
        this.plugin.settings.petRuntimeSettings,
        this.plugin.settings.codexModel || "gpt-5.4",
      );
      const title = bubbleWrap.createDiv({ cls: "pet-agents-message-title" });
      title.createSpan({ text: getPetProfile(message.petId).name });
      title.createSpan({ cls: "pet-agents-inline-tag", text: message.model ?? runtimeSettings.model });
      title.createSpan({
        cls: "pet-agents-inline-tag",
        text: reasoningEffortLabel(message.reasoningEffort ?? runtimeSettings.reasoningEffort),
      });

      if (message.collaborator) {
        title.createSpan({ cls: "pet-agents-inline-tag", text: "协作" });
      }
      if (message.mode === "task") {
        title.createSpan({ cls: "pet-agents-inline-tag", text: "任务" });
      }

      if (hasMeta) {
        const toggle = title.createEl("button", {
          cls: "pet-agents-meta-toggle",
          text: this.expandedMessageMetaIds.has(message.id) ? "收起" : "细节",
        });
        toggle.type = "button";
        toggle.onclick = () => {
          if (this.expandedMessageMetaIds.has(message.id)) {
            this.expandedMessageMetaIds.delete(message.id);
          } else {
            this.expandedMessageMetaIds.add(message.id);
          }
          this.renderMessages();
        };
      }
    }

    const bubble = bubbleWrap.createDiv({
      cls: `pet-agents-bubble ${isUser ? "is-user" : ""} ${message.pending ? "is-pending" : ""} ${message.role === "status" ? "is-status" : ""}`,
    });
    bubble.setText(message.text);

    if (hasMeta && this.expandedMessageMetaIds.has(message.id)) {
      const meta = bubbleWrap.createDiv({ cls: "pet-agents-message-meta" });
      if (message.memoryHits && message.memoryHits.length > 0) {
        const memoryLine = meta.createDiv({ cls: "pet-agents-message-meta-line" });
        memoryLine.createSpan({ cls: "pet-agents-message-meta-label", text: "记忆" });
        const memoryValues = memoryLine.createDiv({ cls: "pet-agents-message-meta-values" });
        message.memoryHits.forEach((value) => memoryValues.createSpan({ text: value }));
      }

      if (message.sources && message.sources.length > 0) {
        const sourcesLine = meta.createDiv({ cls: "pet-agents-message-meta-line" });
        sourcesLine.createSpan({ cls: "pet-agents-message-meta-label", text: "来源" });
        const sourceValues = sourcesLine.createDiv({ cls: "pet-agents-message-meta-values" });
        message.sources.forEach((source) => sourceValues.createSpan({ text: clip(source, 40) }));
      }
    }
  }

  private renderComposer(): void {
    const thread = this.plugin.getActiveThread();
    const runtime = this.plugin.runtimeState;

    this.composerEl.classList.toggle("is-expanded", this.composerSettingsExpanded);
    this.settingsPanelEl.classList.toggle("is-expanded", this.composerSettingsExpanded);
    this.composerToggleEl.classList.toggle("is-active", this.composerSettingsExpanded);
    this.composerToggleEl.disabled = runtime.isBusy;

    this.petButtons.forEach((button, petId) => {
      button.classList.toggle("is-active", thread.currentPetId === petId);
      button.disabled = runtime.isBusy;
    });

    Array.from(this.mentionActionsEl.querySelectorAll("button")).forEach((button) => {
      (button as HTMLButtonElement).disabled = runtime.isBusy;
    });

    this.taskSlotEl.empty();
    if (thread.currentPetId === "engineer-mole") {
      const taskButton = this.taskSlotEl.createEl("button", {
        cls: `pet-agents-toolbar-button ${thread.engineerTaskMode ? "is-task-active" : ""}`,
        text: thread.engineerTaskMode ? "任务模式已开" : "开启任务模式",
      });
      taskButton.type = "button";
      taskButton.disabled = runtime.isBusy;
      taskButton.onclick = async () => {
        await this.plugin.toggleEngineerTaskMode();
      };
    }

    this.overflowActionsEl.empty();
    const clearButton = this.overflowActionsEl.createEl("button", {
      cls: "pet-agents-overflow-action",
      text: "清空会话",
    });
    clearButton.type = "button";
    clearButton.disabled = runtime.isBusy;
    clearButton.onclick = async () => {
      await this.plugin.resetConversation();
      this.composerSettingsExpanded = false;
      this.renderComposer();
    };

    const currentPet = getPetProfile(thread.currentPetId);
    this.textareaEl.placeholder = `对 ${currentPet.shortName} 说点什么。Tab 切主讲，Enter 发送，Shift + Enter 换行。`;
    this.textareaEl.disabled = runtime.isBusy;
    if (runtime.isBusy) {
      this.closeMentionPopup();
    } else {
      this.refreshMentionPopup();
    }
  }

  private async sendCurrentInput(): Promise<void> {
    const value = this.textareaEl.value.trim();
    if (!value) {
      return;
    }

    this.textareaEl.value = "";
    this.closeMentionPopup();
    this.composerSettingsExpanded = false;
    this.renderComposer();
    await this.plugin.sendUserMessage(value);
    this.textareaEl.focus();
  }

  private insertMention(shortName: string): void {
    const value = this.textareaEl.value.trimEnd();
    this.textareaEl.value = value ? `${value} @${shortName} ` : `@${shortName} `;
    this.closeMentionPopup();
    this.textareaEl.focus();
  }

  private isMentionPopupOpen(): boolean {
    return this.activeMentionTrigger !== null && this.mentionSuggestions.length > 0;
  }

  private refreshMentionPopup(): void {
    if (this.textareaEl.disabled) {
      this.closeMentionPopup();
      return;
    }

    const trigger = findMentionTrigger(this.textareaEl.value, this.textareaEl.selectionStart ?? this.textareaEl.value.length);
    if (!trigger) {
      this.closeMentionPopup();
      return;
    }

    this.activeMentionTrigger = trigger;
    this.mentionSuggestions = getMentionSuggestions(trigger.query);
    if (this.mentionSuggestions.length === 0) {
      this.closeMentionPopup();
      return;
    }

    if (this.mentionSelectionIndex >= this.mentionSuggestions.length) {
      this.mentionSelectionIndex = 0;
    }

    this.renderMentionPopup();
  }

  private closeMentionPopup(): void {
    this.activeMentionTrigger = null;
    this.mentionSuggestions = [];
    this.mentionSelectionIndex = 0;
    this.renderMentionPopup();
  }

  private shiftMentionSelection(direction: 1 | -1): void {
    if (!this.isMentionPopupOpen()) {
      return;
    }

    this.mentionSelectionIndex =
      (this.mentionSelectionIndex + direction + this.mentionSuggestions.length) % this.mentionSuggestions.length;
    this.renderMentionPopup();
  }

  private acceptMentionSelection(): void {
    if (!this.activeMentionTrigger || this.mentionSuggestions.length === 0) {
      return;
    }

    const selected = this.mentionSuggestions[this.mentionSelectionIndex];
    const nextValue = applyMentionSuggestion(this.textareaEl.value, this.activeMentionTrigger, selected.shortName);
    this.textareaEl.value = nextValue.text;
    this.textareaEl.setSelectionRange(nextValue.caretIndex, nextValue.caretIndex);
    this.closeMentionPopup();
    this.textareaEl.focus();
  }

  private renderMentionPopup(): void {
    const isOpen = this.isMentionPopupOpen();
    this.mentionPopupEl.toggleClass("is-open", isOpen);
    this.mentionListEl.empty();

    if (!isOpen) {
      return;
    }

    this.mentionSuggestions.forEach((profile, index) => {
      const button = this.mentionListEl.createEl("button", {
        cls: `pet-agents-mention-option ${index === this.mentionSelectionIndex ? "is-selected" : ""}`,
      });
      button.type = "button";
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.mentionSelectionIndex = index;
        this.acceptMentionSelection();
      });

      const avatar = button.createEl("img", {
        cls: "pet-agents-mention-avatar",
        attr: {
          alt: profile.name,
          src: getPetAvatar(profile.id),
        },
      });
      avatar.width = 24;
      avatar.height = 24;

      const copy = button.createDiv({ cls: "pet-agents-mention-copy" });
      copy.createDiv({ cls: "pet-agents-mention-name", text: profile.name });
      copy.createDiv({ cls: "pet-agents-mention-role", text: profile.title });
    });
  }

  private tickSprites(): void {
    const runtime = this.plugin.runtimeState;
    this.frameTick += 1;

    this.spriteRefs.forEach(({ el, petId }) => {
      const state = this.plugin.settings.enablePetAnimations ? runtime.petStates[petId] : "idle";
      const frames = getPetFrames(petId, state);
      const frameIndex = frames.length > 1 ? (this.frameTick + getPetAnimationPhase(petId)) % frames.length : 0;
      el.src = frames[frameIndex];
      el.width = 46;
      el.height = 46;
    });
  }
}
