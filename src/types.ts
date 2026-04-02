export type PetAgentId = "engineer-mole" | "scholar-panda" | "homie-rabbit";

export type ChatRole = "user" | "assistant" | "status";

export type ExecutionMode = "chat" | "task";

export type PetReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type TaskExecutionPolicy = "read-only" | "workspace-write" | "danger-full-access";

export type PetVisualState = "idle" | "thinking" | "speaking" | "error";

export type MemoryTier = "session" | "episodic" | "semantic" | "capsule";

export interface AgentProfile {
  id: PetAgentId;
  name: string;
  shortName: string;
  aliases: string[];
  title: string;
  description: string;
  systemPrompt: string;
  memoryBias: Array<"projects" | "knowledge" | "emotions" | "daily" | "rules">;
  accentColor: string;
  canRunTasks: boolean;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  petId?: PetAgentId;
  model?: string;
  reasoningEffort?: PetReasoningEffort;
  timestamp: number;
  pending?: boolean;
  collaborator?: boolean;
  mode?: ExecutionMode;
  sources?: string[];
  memoryHits?: string[];
}

export interface PetSessionState {
  providerSessionId?: string;
  mode?: ExecutionMode;
  turns: number;
  updatedAt: number;
}

export interface ChatThreadState {
  id: string;
  title: string;
  currentPetId: PetAgentId;
  engineerTaskMode: boolean;
  messages: ChatMessage[];
  petSessions: Partial<Record<PetAgentId, PetSessionState>>;
  summary: string;
  updatedAt: number;
}

export interface MemoryRecord {
  id: string;
  tier: MemoryTier;
  path: string;
  title: string;
  text: string;
  summary: string;
  keywords: string[];
  tags: string[];
  petBias: PetAgentId[];
  createdAt: number;
  updatedAt: number;
  importance: number;
  sourceId?: string;
  dateHint?: string;
}

export interface MemorySnapshot {
  schemaVersion: number;
  lastScanAt: number;
  records: MemoryRecord[];
  scannedFiles: Record<string, number>;
}

export interface MemoryContext {
  capsules: MemoryRecord[];
  details: MemoryRecord[];
  sessionSummary?: string;
}

export interface MemoryQuery {
  petId: PetAgentId;
  query: string;
  conversation: ChatMessage[];
}

export interface PetRuntimeSetting {
  model: string;
  reasoningEffort: PetReasoningEffort;
}

export type PetRuntimeSettings = Record<PetAgentId, PetRuntimeSetting>;

export interface PetAgentsSettings {
  providerKind: "codex-cli";
  codexExecutable: string;
  codexModel: string;
  codexProfile: string;
  petRuntimeSettings: PetRuntimeSettings;
  taskExecutionPolicy: TaskExecutionPolicy;
  taskModeConfirmation: boolean;
  memoryWhitelistPaths: string[];
  diaryFolderHints: string[];
  autoScanMemory: boolean;
  memoryCapsuleLimit: number;
  memoryDetailLimit: number;
  enableProfanityRabbit: boolean;
  enablePetAnimations: boolean;
}

export interface PetAgentsPluginData {
  settings: PetAgentsSettings;
  memory: MemorySnapshot;
  threads: Record<string, ChatThreadState>;
}

export interface ProviderHealth {
  ok: boolean;
  version?: string;
  loginStatus?: string;
  error?: string;
}

export interface ProviderStreamEvent {
  type: "thread-started" | "turn-started" | "message" | "message-delta" | "turn-completed" | "stderr" | "error";
  text?: string;
  threadId?: string;
  raw?: unknown;
}

export interface ProviderTurnRequest {
  prompt: string;
  sessionId?: string;
  cwd: string;
  mode: ExecutionMode;
  model?: string;
  reasoningEffort?: PetReasoningEffort;
  executionPolicy: TaskExecutionPolicy;
  requestId: string;
}

export interface ProviderTurnResult {
  sessionId?: string;
  text: string;
  stderr: string[];
}

export interface ProviderAdapter {
  healthCheck(): Promise<ProviderHealth>;
  runTurn(request: ProviderTurnRequest, onEvent?: (event: ProviderStreamEvent) => void): Promise<ProviderTurnResult>;
  cancelTurn(requestId: string): void;
}
