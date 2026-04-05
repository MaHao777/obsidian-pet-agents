import { FuzzySuggestModal, ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf, type FuzzyMatch } from "obsidian";

import {
  applyMentionSuggestion,
  applySlashSuggestion,
  findMentionTrigger,
  findSlashTrigger,
  getMentionSuggestions,
  getNextPrimaryPet,
  getPreviousPrimaryPet,
  getSlashSuggestions,
  type SlashCommandDefinition,
  type SlashTrigger,
  type MentionSuggestion,
  type MentionTrigger,
} from "./composer";
import {
  buildDisplayUserInput,
  buildPromptUserInput,
  createFileAttachmentSnapshot,
  isTextLikeExtension,
  upsertComposerAttachment,
  type ComposerSelectedContext,
} from "./composer-attachments";
import {
  getPetAnimationPhase,
  getPetAvatar,
  getPetFrames,
  getPetProfile,
  getPetRuntimeSettings,
  PET_PROFILES,
  reasoningEffortLabel,
} from "./pets";
import { providerLabel } from "./main";
import { computeProfilePopoverPosition, shouldHideProfilePopover } from "./profile-popover";
import { discoverSkills, type DiscoveredSkill } from "./skills";
import type PetAgentsPlugin from "./main";
import type { ChatMessage, ComposerAttachment, PetAgentId, ProviderKind, SkillAttachment } from "./types";

export const PET_AGENTS_VIEW_TYPE = "obs-pet-agents-view";

type SpriteRef = {
  el: HTMLImageElement;
  petId: PetAgentId;
};

type SelectedContext = {
  text: string;
  sourceLabel?: string;
};

type ComposerSuggestion =
  | { kind: "mention"; item: MentionSuggestion }
  | { kind: "slash"; item: SlashCommandDefinition };

type ComposerSuggestionTrigger =
  | { kind: "mention"; trigger: MentionTrigger }
  | { kind: "slash"; trigger: SlashTrigger };

type ProfilePopoverState = {
  petId: PetAgentId;
  messageId: string;
  anchorX: number;
  anchorY: number;
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

function selectionSignature(context: SelectedContext | null): string {
  return context ? `${context.sourceLabel ?? ""}::${context.text}` : "";
}

function inferImageExtension(mimeType: string, fileName: string): string {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/gif") {
    return "gif";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  if (mimeType === "image/svg+xml") {
    return "svg";
  }

  const extension = fileName.split(".").pop()?.trim().toLowerCase();
  return extension || "png";
}

function formatSelectionContextMarkdown(context: SelectedContext): string {
  const header = context.sourceLabel ? `> [!note] 当前选中文本 · ${context.sourceLabel}` : "> [!note] 当前选中文本";
  const lines = context.text.split(/\r?\n/).map((line) => `> ${line}`);
  return [header, ...lines].join("\n");
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
  private settingsSummaryEl!: HTMLDivElement;
  private providerSwitchEl!: HTMLDivElement;
  private providerButtons = new Map<ProviderKind, HTMLButtonElement>();
  private petSwitchEl!: HTMLDivElement;
  private mentionActionsEl!: HTMLDivElement;
  private taskSlotEl!: HTMLDivElement;
  private overflowActionsEl!: HTMLDivElement;
  private inputShellEl!: HTMLDivElement;
  private composerHeaderEl!: HTMLDivElement;
  private attachmentSlotEl!: HTMLDivElement;
  private selectionSlotEl!: HTMLDivElement;
  private textareaEl!: HTMLTextAreaElement;
  private composerToggleEl!: HTMLButtonElement;
  private mentionPopupEl!: HTMLDivElement;
  private mentionHeadLabelEl!: HTMLSpanElement;
  private mentionListEl!: HTMLDivElement;
  private profilePopoverEl!: HTMLDivElement;
  private petButtons = new Map<PetAgentId, HTMLButtonElement>();
  private composerAttachments: ComposerAttachment[] = [];
  private mentionSuggestions: ComposerSuggestion[] = [];
  private mentionSelectionIndex = 0;
  private activeMentionTrigger: ComposerSuggestionTrigger | null = null;
  private selectedContext: SelectedContext | null = null;
  private ignoredSelectionSignature = "";
  private profilePopoverState: ProfilePopoverState | null = null;
  private profilePopoverHideTimer: number | null = null;
  private activeProfileTriggerEl: HTMLButtonElement | null = null;

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
    this.registerDomEvent(document, "selectionchange", () => this.refreshSelectedContext());
    this.registerDomEvent(document, "mousemove", (event) => this.handleProfilePointerMove(event));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshSelectedContext()));
    this.render();
    this.refreshSelectedContext();
  }

  async onClose(): Promise<void> {
    this.unsubscribe?.();
    this.spriteRefs = [];
    this.cancelProfilePopoverHide();
  }

  private createLayout(): void {
    this.selectedHeaderPetId = null;
    this.statusPanelExpanded = false;
    this.composerSettingsExpanded = false;
    this.expandedMessageMetaIds.clear();
    this.isPinnedToBottom = true;
    this.profilePopoverState = null;
    this.activeProfileTriggerEl = null;
    this.cancelProfilePopoverHide();

    this.contentEl.empty();
    this.spriteRefs = [];

    this.shellEl = this.contentEl.createDiv({ cls: "pet-agents-shell" });
    this.profilePopoverEl = this.contentEl.createDiv({ cls: "pet-agents-profile-popover" });
    this.profilePopoverEl.addEventListener("mouseenter", () => this.cancelProfilePopoverHide());
    this.profilePopoverEl.addEventListener("mouseleave", (event) =>
      this.scheduleHideProfilePopover(event.relatedTarget instanceof Node ? event.relatedTarget : null),
    );

    this.messagesEl = this.shellEl.createDiv({ cls: "pet-agents-messages" });
    this.messagesEl.addEventListener("scroll", () => {
      this.isPinnedToBottom = nearBottom(this.messagesEl);
      if (this.profilePopoverState) {
        this.hideProfilePopover();
      }
    });

    this.composerEl = this.shellEl.createDiv({ cls: "pet-agents-composer" });
    this.inputShellEl = this.composerEl.createDiv({ cls: "pet-agents-input-shell" });
    this.settingsPanelEl = this.inputShellEl.createDiv({ cls: "pet-agents-settings-panel" });
    this.settingsSummaryEl = this.settingsPanelEl.createDiv({ cls: "pet-agents-settings-summary" });

    const providerSection = this.settingsPanelEl.createDiv({ cls: "pet-agents-settings-section" });
    const providerHead = providerSection.createDiv({ cls: "pet-agents-settings-head" });
    providerHead.createSpan({ cls: "pet-agents-settings-label", text: "调用方式" });
    this.providerSwitchEl = providerSection.createDiv({ cls: "pet-agents-pet-switch" });
    const providerKinds: Array<{ kind: ProviderKind; label: string }> = [
      { kind: "codex-cli", label: "Codex" },
      { kind: "claude-code", label: "Claude" },
      { kind: "anthropic-api", label: "API" },
    ];
    providerKinds.forEach(({ kind, label }) => {
      const button = this.providerSwitchEl.createEl("button", {
        cls: "pet-agents-segment-button",
        text: label,
      });
      button.type = "button";
      button.onclick = () => void this.plugin.switchProvider(kind);
      this.providerButtons.set(kind, button);
    });

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

    this.composerHeaderEl = this.inputShellEl.createDiv({ cls: "pet-agents-composer-header" });
    this.attachmentSlotEl = this.composerHeaderEl.createDiv({ cls: "pet-agents-attachment-slot" });
    this.selectionSlotEl = this.composerHeaderEl.createDiv({ cls: "pet-agents-selection-slot" });

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
          void this.acceptMentionSelection();
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
        void this.acceptMentionSelection();
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.sendCurrentInput();
      }
    });
    this.textareaEl.addEventListener("input", () => this.refreshMentionPopup());
    this.textareaEl.addEventListener("click", () => {
      this.refreshMentionPopup();
      this.refreshSelectedContext();
    });
    this.textareaEl.addEventListener("focus", () => this.refreshSelectedContext());
    this.textareaEl.addEventListener("keyup", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === "Tab") {
        return;
      }
      this.refreshMentionPopup();
    });
    this.textareaEl.addEventListener("paste", (event) => {
      void this.handleImagePaste(event);
    });
    this.textareaEl.addEventListener("dragover", (event) => {
      if (Array.from(event.dataTransfer?.files ?? []).some((file) => file.type.startsWith("image/"))) {
        event.preventDefault();
      }
    });
    this.textareaEl.addEventListener("drop", (event) => {
      void this.handleImageDrop(event);
    });

    this.mentionPopupEl = this.inputShellEl.createDiv({ cls: "pet-agents-mention-popup" });
    const mentionHead = this.mentionPopupEl.createDiv({ cls: "pet-agents-mention-head" });
    mentionHead.createSpan({ text: "选择协作 agent" });
    this.mentionHeadLabelEl = mentionHead.querySelector("span") as HTMLSpanElement;
    this.mentionListEl = this.mentionPopupEl.createDiv({ cls: "pet-agents-mention-list" });
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
    const currentProviderLabel = providerLabel(this.plugin.settings.providerKind);
    detailCopy.createDiv({
      text: runtime.providerHealth?.ok ? `${currentProviderLabel} 已连接` : `${currentProviderLabel} 连接异常`,
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

    const memorySnapshot = this.plugin.memoryService.snapshot;
    const detailMeta = detailEl.createDiv({ cls: "pet-agents-header-detail-meta" });
    detailMeta.createSpan({ text: `记忆笔记 ${memorySnapshot.activeMemoryCount}` });
    if (memorySnapshot.lastSyncAt > 0) {
      detailMeta.createSpan({ text: `上次同步 ${relativeTime(memorySnapshot.lastSyncAt)}` });
    }
    if (memorySnapshot.lastIndexedCommit) {
      detailMeta.createSpan({ text: `Git ${memorySnapshot.lastIndexedCommit.slice(0, 8)}` });
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
    if (this.profilePopoverState) {
      this.hideProfilePopover();
    }

    this.messagesEl.empty();

    if (thread.messages.length === 0) {
      const empty = this.messagesEl.createDiv({ cls: "pet-agents-empty" });
      empty.createEl("h3", { text: "开始对话吧" });
      empty.createEl("p", {
        text: "支持 Markdown、图片嵌入、选中文本上下文和 @ 协作。消息头像可以展开个人信息卡，输入区右上角保留设置入口。",
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
      const avatarButton = row.createEl("button", {
        cls: "pet-agents-avatar-button",
        attr: {
          "aria-label": `切换到 ${getPetProfile(message.petId).name}`,
          title: `切换到 ${getPetProfile(message.petId).name}`,
        },
      });
      avatarButton.type = "button";
      avatarButton.addEventListener("mouseenter", () => this.cancelProfilePopoverHide());
      avatarButton.addEventListener("mouseleave", (event) =>
        this.scheduleHideProfilePopover(event.relatedTarget instanceof Node ? event.relatedTarget : null),
      );
      avatarButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.profilePopoverState?.messageId === message.id) {
          this.hideProfilePopover();
          return;
        }

        this.showProfilePopover(
          {
            petId: message.petId!,
            messageId: message.id,
            anchorX: event.clientX,
            anchorY: event.clientY,
          },
          avatarButton,
        );
      };
      avatarButton.createEl("img", {
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
    const bubbleContent = bubble.createDiv({ cls: "pet-agents-bubble-markdown" });
    void this.renderMarkdownInto(bubbleContent, message.text);

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

  private async renderMarkdownInto(container: HTMLElement, markdown: string): Promise<void> {
    container.empty();
    await MarkdownRenderer.renderMarkdown(markdown, container, this.getMarkdownSourcePath(), this);
  }

  private renderMessageProfileCard(parent: HTMLElement, petId: PetAgentId): void {
    const thread = this.plugin.getActiveThread();
    const runtime = this.plugin.runtimeState;
    const profile = getPetProfile(petId);
    const runtimeSettings = getPetRuntimeSettings(
      petId,
      this.plugin.settings.petRuntimeSettings,
      this.plugin.settings.codexModel || "gpt-5.4",
    );

    const card = parent.createDiv({ cls: "pet-agents-message-profile-card" });
    const top = card.createDiv({ cls: "pet-agents-message-profile-top" });
    const identity = top.createDiv({ cls: "pet-agents-message-profile-identity" });
    identity.createEl("img", {
      cls: "pet-agents-message-profile-avatar",
      attr: {
        alt: profile.name,
        src: getPetAvatar(profile.id),
      },
    });
    const copy = identity.createDiv({ cls: "pet-agents-message-profile-copy" });
    copy.createDiv({ cls: "pet-agents-message-profile-name", text: profile.name });
    copy.createDiv({ cls: "pet-agents-message-profile-title", text: profile.title });

    card.createDiv({ cls: "pet-agents-message-profile-description", text: profile.description });

    const pills = card.createDiv({ cls: "pet-agents-message-profile-pills" });
    if (thread.currentPetId === petId) {
      pills.createSpan({ text: "当前主讲" });
    }
    if (runtime.activeSpeakerPetId === petId || runtime.latestAssistantPetId === petId) {
      pills.createSpan({ text: "最近发言" });
    }
    if (runtime.activeWorkerPetId === petId) {
      pills.createSpan({ text: "工作中" });
    }
    if (pills.childElementCount === 0) {
      pills.createSpan({ text: "待命" });
    }

    const meta = card.createDiv({ cls: "pet-agents-message-profile-meta" });
    meta.createDiv({ text: `模型：${runtimeSettings.model}` });
    meta.createDiv({ text: `思考强度：${reasoningEffortLabel(runtimeSettings.reasoningEffort)}` });
    meta.createDiv({ text: thread.engineerTaskMode && petId === "engineer-mole" ? "模式：任务" : "模式：聊天" });
    meta.createDiv({ text: runtime.providerHealth?.ok ? "Codex：已连接" : "Codex：连接异常" });

    const actions = card.createDiv({ cls: "pet-agents-message-profile-actions" });
    const switchButton = actions.createEl("button", {
      cls: "pet-agents-message-profile-action",
      text: thread.currentPetId === petId ? "已是主讲" : "设为主讲",
    });
    switchButton.type = "button";
    switchButton.disabled = thread.currentPetId === petId || runtime.isBusy;
    switchButton.onclick = () => {
      this.plugin.switchPet(petId);
      this.hideProfilePopover();
      this.textareaEl.focus();
    };
  }

  private showProfilePopover(state: ProfilePopoverState, triggerEl: HTMLButtonElement): void {
    this.profilePopoverState = state;
    this.activeProfileTriggerEl = triggerEl;
    this.cancelProfilePopoverHide();
    this.renderProfilePopover();
  }

  private renderProfilePopover(): void {
    if (!this.profilePopoverState) {
      return;
    }

    this.profilePopoverEl.empty();
    this.profilePopoverEl.addClass("is-open");
    this.profilePopoverEl.style.left = "0px";
    this.profilePopoverEl.style.top = "0px";
    this.renderMessageProfileCard(this.profilePopoverEl, this.profilePopoverState.petId);

    const rect = this.profilePopoverEl.getBoundingClientRect();
    const position = computeProfilePopoverPosition({
      anchorX: this.profilePopoverState.anchorX,
      anchorY: this.profilePopoverState.anchorY,
      popoverWidth: rect.width,
      popoverHeight: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });

    this.profilePopoverEl.style.left = `${position.left}px`;
    this.profilePopoverEl.style.top = `${position.top}px`;
  }

  private hideProfilePopover(): void {
    this.cancelProfilePopoverHide();
    this.profilePopoverState = null;
    this.activeProfileTriggerEl = null;
    this.profilePopoverEl.removeClass("is-open");
    this.profilePopoverEl.empty();
  }

  private scheduleHideProfilePopover(relatedTarget: Node | null): void {
    if (!this.profilePopoverState) {
      return;
    }

    if (
      (relatedTarget && this.activeProfileTriggerEl?.contains(relatedTarget)) ||
      (relatedTarget && this.profilePopoverEl.contains(relatedTarget))
    ) {
      this.cancelProfilePopoverHide();
      return;
    }

    if (this.profilePopoverHideTimer !== null) {
      return;
    }

    this.profilePopoverHideTimer = window.setTimeout(() => {
      this.profilePopoverHideTimer = null;
      this.hideProfilePopover();
    }, 120);
  }

  private cancelProfilePopoverHide(): void {
    if (this.profilePopoverHideTimer === null) {
      return;
    }

    window.clearTimeout(this.profilePopoverHideTimer);
    this.profilePopoverHideTimer = null;
  }

  private handleProfilePointerMove(event: MouseEvent): void {
    if (!this.profilePopoverState) {
      return;
    }

    const pointer = {
      x: event.clientX,
      y: event.clientY,
    };
    const triggerRect = this.activeProfileTriggerEl?.getBoundingClientRect() ?? null;
    const popoverRect =
      this.profilePopoverEl.childElementCount > 0 && this.profilePopoverEl.classList.contains("is-open")
        ? this.profilePopoverEl.getBoundingClientRect()
        : null;

    if (shouldHideProfilePopover(pointer, triggerRect, popoverRect)) {
      this.scheduleHideProfilePopover(null);
      return;
    }

    this.cancelProfilePopoverHide();
  }

  private renderComposer(): void {
    const thread = this.plugin.getActiveThread();
    const runtime = this.plugin.runtimeState;

    this.composerEl.classList.toggle("is-expanded", this.composerSettingsExpanded);
    this.settingsPanelEl.classList.toggle("is-expanded", this.composerSettingsExpanded);
    this.composerToggleEl.classList.toggle("is-active", this.composerSettingsExpanded);
    this.composerToggleEl.disabled = runtime.isBusy;
    this.renderSettingsSummary();
    this.renderAttachmentChips();
    this.renderSelectionContext();
    this.composerHeaderEl.toggleClass("is-hidden", !this.selectedContext && this.composerAttachments.length === 0);

    this.providerButtons.forEach((button, kind) => {
      button.classList.toggle("is-active", this.plugin.settings.providerKind === kind);
      button.disabled = runtime.isBusy;
    });

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

  private renderSettingsSummary(): void {
    const thread = this.plugin.getActiveThread();
    const runtime = this.plugin.runtimeState;
    const currentPet = getPetProfile(thread.currentPetId);
    const runtimeSettings = getPetRuntimeSettings(
      thread.currentPetId,
      this.plugin.settings.petRuntimeSettings,
      this.plugin.settings.codexModel || "gpt-5.4",
    );

    this.settingsSummaryEl.empty();
    this.settingsSummaryEl.createDiv({ cls: "pet-agents-settings-summary-title", text: `${currentPet.name} · ${currentPet.title}` });
    this.settingsSummaryEl.createDiv({ cls: "pet-agents-settings-summary-copy", text: currentPet.description });
    const meta = this.settingsSummaryEl.createDiv({ cls: "pet-agents-settings-summary-meta" });
    meta.createSpan({ text: thread.engineerTaskMode && thread.currentPetId === "engineer-mole" ? "任务模式" : "聊天模式" });
    meta.createSpan({ text: runtime.providerHealth?.ok ? "Codex 已连接" : "Codex 异常" });
    meta.createSpan({ text: runtimeSettings.model });
    meta.createSpan({ text: reasoningEffortLabel(runtimeSettings.reasoningEffort) });
  }

  private renderAttachmentChips(): void {
    this.attachmentSlotEl.empty();
    if (this.composerAttachments.length === 0) {
      return;
    }

    const row = this.attachmentSlotEl.createDiv({ cls: "pet-agents-attachment-row" });
    this.composerAttachments.forEach((attachment, index) => {
      const chip = row.createDiv({ cls: "pet-agents-attachment-chip" });
      const copy = chip.createDiv({ cls: "pet-agents-attachment-copy" });

      if (attachment.kind === "file") {
        copy.createDiv({
          cls: "pet-agents-attachment-title",
          text: `${attachment.source === "current-file" ? "当前文件" : "指定文件"} · ${clip(attachment.path, 64)}`,
        });
        copy.createDiv({
          cls: "pet-agents-attachment-preview",
          text: attachment.truncated ? "已保存文件快照，发送时附带截断内容" : "已保存文件快照，发送时附带文件内容",
        });
      } else {
        copy.createDiv({
          cls: "pet-agents-attachment-title",
          text: `Skill · ${attachment.name}`,
        });
        copy.createDiv({
          cls: "pet-agents-attachment-preview",
          text: clip(attachment.description, 96),
        });
      }

      const removeButton = chip.createEl("button", {
        cls: "pet-agents-attachment-remove",
        text: "移除",
      });
      removeButton.type = "button";
      removeButton.disabled = this.plugin.runtimeState.isBusy;
      removeButton.onclick = () => {
        this.composerAttachments = this.composerAttachments.filter((_, attachmentIndex) => attachmentIndex !== index);
        this.renderComposer();
      };
    });
  }

  private renderSelectionContext(): void {
    this.selectionSlotEl.empty();
    if (!this.selectedContext) {
      return;
    }

    const chip = this.selectionSlotEl.createDiv({ cls: "pet-agents-selection-chip" });
    const copy = chip.createDiv({ cls: "pet-agents-selection-copy" });
    copy.createDiv({
      cls: "pet-agents-selection-title",
      text: this.selectedContext.sourceLabel ? `当前选中 · ${this.selectedContext.sourceLabel}` : "当前选中",
    });
    copy.createDiv({
      cls: "pet-agents-selection-preview",
      text: clip(this.selectedContext.text.replace(/\s+/g, " ").trim(), 120),
    });

    const actions = chip.createDiv({ cls: "pet-agents-selection-actions" });
    const insertButton = actions.createEl("button", {
      cls: "pet-agents-selection-button",
      text: "插入正文",
    });
    insertButton.type = "button";
    insertButton.disabled = this.plugin.runtimeState.isBusy;
    insertButton.onclick = () => {
      this.insertTextAtCursor(`${formatSelectionContextMarkdown(this.selectedContext!)}\n\n`);
      this.dismissSelectedContext();
    };

    const clearButton = actions.createEl("button", {
      cls: "pet-agents-selection-button",
      text: "关闭",
    });
    clearButton.type = "button";
    clearButton.disabled = this.plugin.runtimeState.isBusy;
    clearButton.onclick = () => this.dismissSelectedContext();
  }

  private async sendCurrentInput(): Promise<void> {
    const rawValue = this.textareaEl.value.trim();
    if (!rawValue) {
      if (this.selectedContext || this.composerAttachments.length > 0) {
        new Notice("请先输入本轮问题，再发送附加上下文。");
      }
      return;
    }

    const selectedContext: ComposerSelectedContext | null = this.selectedContext
      ? {
          text: this.selectedContext.text,
          sourceLabel: this.selectedContext.sourceLabel,
        }
      : null;
    const displayText = buildDisplayUserInput({
      selectedContext,
      attachments: this.composerAttachments,
      rawInput: rawValue,
    });
    const promptText = buildPromptUserInput({
      selectedContext,
      attachments: this.composerAttachments,
      rawInput: rawValue,
    });
    this.textareaEl.value = "";
    this.closeMentionPopup();
    this.composerSettingsExpanded = false;
    this.composerAttachments = [];
    this.selectedContext = null;
    this.ignoredSelectionSignature = "";
    this.renderComposer();
    await this.plugin.sendUserMessage({
      displayText,
      promptText,
      queryText: rawValue,
    });
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

    const cursor = this.textareaEl.selectionStart ?? this.textareaEl.value.length;
    const slashTrigger = findSlashTrigger(this.textareaEl.value, cursor);
    if (slashTrigger) {
      this.activeMentionTrigger = {
        kind: "slash",
        trigger: slashTrigger,
      };
      this.mentionSuggestions = getSlashSuggestions(slashTrigger.query).map((item) => ({
        kind: "slash",
        item,
      }));
      if (this.mentionSuggestions.length === 0) {
        this.closeMentionPopup();
        return;
      }
      if (this.mentionSelectionIndex >= this.mentionSuggestions.length) {
        this.mentionSelectionIndex = 0;
      }
      this.renderMentionPopup();
      return;
    }

    const mentionTrigger = findMentionTrigger(this.textareaEl.value, cursor);
    if (!mentionTrigger) {
      this.closeMentionPopup();
      return;
    }

    this.activeMentionTrigger = {
      kind: "mention",
      trigger: mentionTrigger,
    };
    this.mentionSuggestions = getMentionSuggestions(mentionTrigger.query).map((item) => ({
      kind: "mention",
      item,
    }));
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

  private async acceptMentionSelection(): Promise<void> {
    if (!this.activeMentionTrigger || this.mentionSuggestions.length === 0) {
      return;
    }

    const selected = this.mentionSuggestions[this.mentionSelectionIndex];
    if (selected.kind === "mention" && this.activeMentionTrigger.kind === "mention") {
      const nextValue = applyMentionSuggestion(this.textareaEl.value, this.activeMentionTrigger.trigger, selected.item.shortName);
      this.textareaEl.value = nextValue.text;
      this.textareaEl.setSelectionRange(nextValue.caretIndex, nextValue.caretIndex);
      this.closeMentionPopup();
      this.textareaEl.focus();
      return;
    }

    if (selected.kind === "slash" && this.activeMentionTrigger.kind === "slash") {
      const nextValue = applySlashSuggestion(this.textareaEl.value, this.activeMentionTrigger.trigger);
      this.textareaEl.value = nextValue.text;
      this.textareaEl.setSelectionRange(nextValue.caretIndex, nextValue.caretIndex);
      this.closeMentionPopup();
      this.textareaEl.focus();
      await this.handleSlashCommand(selected.item);
    }
  }

  private renderMentionPopup(): void {
    const isOpen = this.isMentionPopupOpen();
    this.mentionPopupEl.toggleClass("is-open", isOpen);
    this.mentionListEl.empty();

    if (!isOpen) {
      return;
    }

    this.mentionHeadLabelEl.setText(this.activeMentionTrigger?.kind === "slash" ? "选择斜杠命令" : "选择协作 agent");
    this.mentionSuggestions.forEach((suggestion, index) => {
      const button = this.mentionListEl.createEl("button", {
        cls: `pet-agents-mention-option ${index === this.mentionSelectionIndex ? "is-selected" : ""}`,
      });
      button.type = "button";
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.mentionSelectionIndex = index;
        void this.acceptMentionSelection();
      });

      if (suggestion.kind === "mention") {
        const avatar = button.createEl("img", {
          cls: "pet-agents-mention-avatar",
          attr: {
            alt: suggestion.item.name,
            src: getPetAvatar(suggestion.item.id),
          },
        });
        avatar.width = 24;
        avatar.height = 24;

        const copy = button.createDiv({ cls: "pet-agents-mention-copy" });
        copy.createDiv({ cls: "pet-agents-mention-name", text: suggestion.item.name });
        copy.createDiv({ cls: "pet-agents-mention-role", text: suggestion.item.title });
        return;
      }

      button.addClass("is-slash");
      const icon = button.createDiv({ cls: "pet-agents-mention-icon", text: "/" });
      icon.setAttr("aria-hidden", "true");
      const copy = button.createDiv({ cls: "pet-agents-mention-copy" });
      copy.createDiv({ cls: "pet-agents-mention-name", text: suggestion.item.label });
      copy.createDiv({ cls: "pet-agents-mention-role", text: suggestion.item.description });
    });
  }

  private async handleSlashCommand(command: SlashCommandDefinition): Promise<void> {
    switch (command.id) {
      case "current-file":
        await this.attachCurrentFile();
        return;
      case "file":
        await this.attachNamedFile();
        return;
      case "skill":
        await this.attachSkill();
        return;
      case "refresh-memory":
        await this.plugin.rescanLayeredMemory(true);
        return;
    }
  }

  private async attachCurrentFile(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile)) {
      new Notice("当前没有可附加的活动文件。");
      return;
    }

    await this.attachFileSnapshot(file, "current-file");
  }

  private async attachNamedFile(): Promise<void> {
    const files = this.app.vault.getFiles().filter((file) => isTextLikeExtension(file.extension));
    if (files.length === 0) {
      new Notice("vault 里没有可附加的文本文件。");
      return;
    }

    const selected = await this.chooseVaultFile(files);
    if (!selected) {
      return;
    }

    await this.attachFileSnapshot(selected, "file");
  }

  private async attachSkill(): Promise<void> {
    const skills = await discoverSkills();
    if (skills.length === 0) {
      new Notice("没有发现可用的 skill。");
      return;
    }

    const selected = await this.chooseSkill(skills);
    if (!selected) {
      return;
    }

    const attachment: SkillAttachment = {
      kind: "skill",
      name: selected.name,
      description: selected.description,
      path: selected.path,
    };
    this.composerAttachments = upsertComposerAttachment(this.composerAttachments, attachment);
    this.renderComposer();
  }

  private async attachFileSnapshot(file: TFile, source: "current-file" | "file"): Promise<void> {
    if (!isTextLikeExtension(file.extension)) {
      new Notice("这个文件不是可直接附加的文本文件。");
      return;
    }

    const content = await this.app.vault.cachedRead(file);
    this.composerAttachments = upsertComposerAttachment(
      this.composerAttachments,
      createFileAttachmentSnapshot({
        path: file.path,
        source,
        content,
      }),
    );
    this.renderComposer();
  }

  private async chooseVaultFile(files: TFile[]): Promise<TFile | null> {
    return await new Promise((resolve) => {
      const modal = new VaultFileSuggestModal(this.app, files, resolve);
      modal.open();
    });
  }

  private async chooseSkill(skills: DiscoveredSkill[]): Promise<DiscoveredSkill | null> {
    return await new Promise((resolve) => {
      const modal = new SkillSuggestModal(this.app, skills, resolve);
      modal.open();
    });
  }

  private refreshSelectedContext(): void {
    const next = this.captureSelectedContext();
    const nextSignature = selectionSignature(next);
    if (nextSignature && nextSignature === this.ignoredSelectionSignature) {
      return;
    }

    if (nextSignature === selectionSignature(this.selectedContext)) {
      return;
    }

    this.selectedContext = next;
    if (!next) {
      this.ignoredSelectionSignature = "";
    }
    this.renderComposer();
  }

  private captureSelectedContext(): SelectedContext | null {
    const editorSelection = this.app.workspace.activeEditor?.editor?.getSelection()?.trim();
    if (editorSelection) {
      return {
        text: editorSelection,
        sourceLabel: this.app.workspace.getActiveFile()?.path ?? "当前笔记",
      };
    }

    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text) {
      return null;
    }

    if (selection?.anchorNode && this.contentEl.contains(selection.anchorNode)) {
      return null;
    }

    return {
      text,
      sourceLabel: this.app.workspace.getActiveFile()?.path ?? "当前页面",
    };
  }

  private dismissSelectedContext(): void {
    this.ignoredSelectionSignature = selectionSignature(this.selectedContext);
    this.selectedContext = null;
    this.renderComposer();
  }

  private insertTextAtCursor(text: string): void {
    const start = this.textareaEl.selectionStart ?? this.textareaEl.value.length;
    const end = this.textareaEl.selectionEnd ?? this.textareaEl.value.length;
    const before = this.textareaEl.value.slice(0, start);
    const after = this.textareaEl.value.slice(end);
    this.textareaEl.value = `${before}${text}${after}`;
    const caret = before.length + text.length;
    this.textareaEl.setSelectionRange(caret, caret);
    this.textareaEl.focus();
    this.refreshMentionPopup();
  }

  private async handleImagePaste(event: ClipboardEvent): Promise<void> {
    const imageFiles = Array.from(event.clipboardData?.items ?? [])
      .map((item) => (item.type.startsWith("image/") ? item.getAsFile() : null))
      .filter((file): file is File => file !== null);

    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    await this.attachImageFiles(imageFiles);
  }

  private async handleImageDrop(event: DragEvent): Promise<void> {
    const imageFiles = Array.from(event.dataTransfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    await this.attachImageFiles(imageFiles);
  }

  private async attachImageFiles(files: File[]): Promise<void> {
    const embeds: string[] = [];

    for (const file of files) {
      try {
        const path = await this.saveImageAttachment(file);
        embeds.push(`![[${path}]]`);
      } catch (error) {
        new Notice(`图片插入失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (embeds.length === 0) {
      return;
    }

    const prefix = this.textareaEl.value && !this.textareaEl.value.endsWith("\n") ? "\n" : "";
    this.insertTextAtCursor(`${prefix}${embeds.join("\n")}\n`);
  }

  private async saveImageAttachment(file: File): Promise<string> {
    const activeFile = this.app.workspace.getActiveFile();
    const extension = inferImageExtension(file.type, file.name);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `pet-agents-${timestamp}.${extension}`;
    let attachmentPath: string;

    if (activeFile?.path) {
      attachmentPath = await this.app.fileManager.getAvailablePathForAttachment(fileName, activeFile.path);
    } else {
      const folder = "Pet Agents/Attachments";
      await this.ensureFolder(folder);
      attachmentPath = `${folder}/${fileName}`;
    }

    const created = await this.app.vault.createBinary(attachmentPath, await file.arrayBuffer());
    return created.path;
  }

  private async ensureFolder(path: string): Promise<void> {
    const segments = path.split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private getMarkdownSourcePath(): string {
    return this.app.workspace.getActiveFile()?.path ?? "";
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

class VaultFileSuggestModal extends FuzzySuggestModal<TFile> {
  private didChoose = false;

  constructor(
    app: PetAgentsView["app"],
    private readonly files: TFile[],
    private readonly resolve: (value: TFile | null) => void,
  ) {
    super(app);
    this.setPlaceholder("选择要附加的文件");
    this.emptyStateText = "没有匹配的文本文件";
  }

  getItems(): TFile[] {
    return this.files;
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  renderSuggestion(match: FuzzyMatch<TFile>, el: HTMLElement): void {
    el.createDiv({ cls: "pet-agents-mention-name", text: match.item.path });
    el.createDiv({ cls: "pet-agents-mention-role", text: match.item.extension || "text" });
  }

  onChooseItem(item: TFile): void {
    this.didChoose = true;
    this.resolve(item);
  }

  onClose(): void {
    super.onClose();
    if (!this.didChoose) {
      this.resolve(null);
    }
  }
}

class SkillSuggestModal extends FuzzySuggestModal<DiscoveredSkill> {
  private didChoose = false;

  constructor(
    app: PetAgentsView["app"],
    private readonly skills: DiscoveredSkill[],
    private readonly resolve: (value: DiscoveredSkill | null) => void,
  ) {
    super(app);
    this.setPlaceholder("选择要附加的 skill");
    this.emptyStateText = "没有匹配的 skill";
  }

  getItems(): DiscoveredSkill[] {
    return this.skills;
  }

  getItemText(item: DiscoveredSkill): string {
    return `${item.name} ${item.description}`;
  }

  renderSuggestion(match: FuzzyMatch<DiscoveredSkill>, el: HTMLElement): void {
    el.createDiv({ cls: "pet-agents-mention-name", text: match.item.name });
    el.createDiv({ cls: "pet-agents-mention-role", text: match.item.description });
  }

  onChooseItem(item: DiscoveredSkill): void {
    this.didChoose = true;
    this.resolve(item);
  }

  onClose(): void {
    super.onClose();
    if (!this.didChoose) {
      this.resolve(null);
    }
  }
}
