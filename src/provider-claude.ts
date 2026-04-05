import type { ChildProcessWithoutNullStreams } from "child_process";

import { execCli, spawnCli } from "./provider-utils";
import type {
  ProviderAdapter,
  ProviderHealth,
  ProviderStreamEvent,
  ProviderTurnRequest,
  ProviderTurnResult,
} from "./types";

export interface ClaudeProviderOptions {
  executable: string;
  model: string;
}

export function buildClaudeTurnArgs(options: ClaudeProviderOptions, request: ProviderTurnRequest): string[] {
  const args: string[] = ["--print", "--output-format", "stream-json", "--max-turns", "1"];

  const effectiveModel = request.model?.trim() || options.model.trim();
  if (effectiveModel) {
    args.push("--model", effectiveModel);
  }

  if (request.sessionId) {
    args.push("--resume", request.sessionId);
  }

  return args;
}

export class ClaudeCodeProvider implements ProviderAdapter {
  private readonly runningTurns = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(private readonly getOptions: () => ClaudeProviderOptions) {}

  async healthCheck(): Promise<ProviderHealth> {
    const options = this.getOptions();

    try {
      const version = await execCli(options.executable, ["--version"]);
      return {
        ok: true,
        version,
        loginStatus: "ok",
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async runTurn(request: ProviderTurnRequest, onEvent?: (event: ProviderStreamEvent) => void): Promise<ProviderTurnResult> {
    const options = this.getOptions();
    const args = buildClaudeTurnArgs(options, request);

    const child = spawnCli(options.executable, args, request.cwd);
    this.runningTurns.set(request.requestId, child);
    child.stdin.write(request.prompt);
    child.stdin.end();

    return await new Promise<ProviderTurnResult>((resolve, reject) => {
      let stdoutBuffer = "";
      let stderrBuffer = "";
      let collectedText = "";
      let sessionId = request.sessionId;
      const stderrLines: string[] = [];

      const flushStdout = () => {
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() ?? "";

        lines.forEach((line) => {
          if (!line.trim()) {
            return;
          }

          try {
            const event = JSON.parse(line) as {
              type?: string;
              session_id?: string;
              conversation_id?: string;
              content_block_delta?: { delta?: { text?: string } };
              message?: { content?: Array<{ type?: string; text?: string }> };
              result?: { text?: string; session_id?: string };
              delta?: { text?: string };
              [key: string]: unknown;
            };

            switch (event.type) {
              case "system": {
                const sid = event.session_id ?? event.conversation_id;
                if (typeof sid === "string") {
                  sessionId = sid;
                  onEvent?.({ type: "thread-started", threadId: sid, raw: event });
                }
                break;
              }
              case "assistant": {
                const msgContent = event.message?.content;
                if (Array.isArray(msgContent)) {
                  const textBlock = msgContent.find((block) => block.type === "text");
                  if (textBlock?.text) {
                    collectedText = textBlock.text;
                    onEvent?.({ type: "message", text: collectedText, raw: event });
                  }
                }
                break;
              }
              case "content_block_delta": {
                const deltaText = event.content_block_delta?.delta?.text ?? event.delta?.text;
                if (deltaText) {
                  collectedText += deltaText;
                  onEvent?.({ type: "message-delta", text: deltaText, raw: event });
                }
                break;
              }
              case "result": {
                if (event.result?.session_id) {
                  sessionId = event.result.session_id;
                }
                if (event.result?.text) {
                  collectedText = event.result.text;
                  onEvent?.({ type: "message", text: collectedText, raw: event });
                }
                onEvent?.({ type: "turn-completed", raw: event });
                break;
              }
              default:
                break;
            }
          } catch {
            onEvent?.({ type: "stderr", text: line, raw: line });
          }
        });
      };

      const flushStderr = () => {
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() ?? "";

        lines.forEach((line) => {
          if (!line.trim()) {
            return;
          }

          stderrLines.push(line);
          onEvent?.({ type: "stderr", text: line, raw: line });
        });
      };

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk: string) => {
        stdoutBuffer += chunk;
        flushStdout();
      });

      child.stderr.on("data", (chunk: string) => {
        stderrBuffer += chunk;
        flushStderr();
      });

      child.on("error", (error) => {
        this.runningTurns.delete(request.requestId);
        reject(error);
      });

      child.on("close", (code) => {
        flushStdout();
        flushStderr();
        this.runningTurns.delete(request.requestId);

        if (code === 0) {
          resolve({
            sessionId,
            text: collectedText.trim(),
            stderr: stderrLines,
          });
          return;
        }

        reject(new Error(stderrLines.join("\n") || `Claude Code exited with code ${code ?? "unknown"}`));
      });
    });
  }

  cancelTurn(requestId: string): void {
    const child = this.runningTurns.get(requestId);
    if (!child) {
      return;
    }

    child.kill();
    this.runningTurns.delete(requestId);
  }
}
