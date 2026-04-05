import type {
  ProviderAdapter,
  ProviderHealth,
  ProviderStreamEvent,
  ProviderTurnRequest,
  ProviderTurnResult,
} from "./types";

export interface AnthropicApiProviderOptions {
  apiKey: string;
  model: string;
}

export class AnthropicApiProvider implements ProviderAdapter {
  constructor(private readonly getOptions: () => AnthropicApiProviderOptions) {}

  async healthCheck(): Promise<ProviderHealth> {
    return {
      ok: false,
      error: "Anthropic API 尚未实现，敬请期待。",
    };
  }

  async runTurn(
    _request: ProviderTurnRequest,
    _onEvent?: (event: ProviderStreamEvent) => void,
  ): Promise<ProviderTurnResult> {
    throw new Error("Anthropic API 尚未实现。");
  }

  cancelTurn(_requestId: string): void {
    // no-op
  }
}
