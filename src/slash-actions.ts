export interface SlashMemoryRefreshHost {
  memoryService: {
    fullScan(force: boolean): Promise<void>;
  };
  runtimeState: {
    statusText: string;
  };
  refreshViews(): void;
}

export async function refreshLayeredMemoryFromSlash(host: SlashMemoryRefreshHost): Promise<void> {
  await host.memoryService.fullScan(true);
  host.runtimeState.statusText = "记忆索引已刷新。";
  host.refreshViews();
}
