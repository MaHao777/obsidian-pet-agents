import type { ChildProcessWithoutNullStreams } from "child_process";

import type {
  ProviderAdapter,
  ProviderHealth,
  ProviderStreamEvent,
  ProviderTurnRequest,
  ProviderTurnResult,
} from "./types";
import { resolveExecutionPolicy } from "./runtime-policies";

declare const require: NodeRequire;

interface ChildProcessModule {
  spawn: typeof import("child_process").spawn;
  execFile: typeof import("child_process").execFile;
}

export interface CodexProviderOptions {
  executable: string;
  model: string;
  profile: string;
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

function pushRootArgs(args: string[], options: CodexProviderOptions, request: ProviderTurnRequest): void {
  if (options.profile.trim()) {
    args.push("--profile", options.profile.trim());
  }

  const effectiveModel = request.model?.trim() || options.model.trim();
  if (effectiveModel) {
    args.push("--model", effectiveModel);
  }

  if (request.reasoningEffort) {
    args.push("-c", `reasoning_effort="${request.reasoningEffort}"`);
  }
}

function pushNewSessionPolicy(args: string[], request: ProviderTurnRequest): void {
  const policy = resolveExecutionPolicy(request.mode, request.executionPolicy);
  if (policy === "read-only") {
    args.push("--sandbox", "read-only");
    return;
  }

  args.push("--dangerously-bypass-approvals-and-sandbox");
}

function pushResumePolicy(args: string[], request: ProviderTurnRequest): void {
  const policy = resolveExecutionPolicy(request.mode, request.executionPolicy);
  if (policy === "read-only") {
    return;
  }

  args.push("--dangerously-bypass-approvals-and-sandbox");
}

export function buildCodexTurnArgs(options: CodexProviderOptions, request: ProviderTurnRequest): string[] {
  const args: string[] = [];

  pushRootArgs(args, options, request);
  args.push("exec");

  if (request.sessionId) {
    args.push("resume", "--json", "--skip-git-repo-check");
    pushResumePolicy(args, request);
    args.push(request.sessionId, "-");
    return args;
  }

  args.push("--json", "--skip-git-repo-check");
  pushNewSessionPolicy(args, request);
  args.push("-");
  return args;
}

function spawnCodex(command: string, args: string[], cwd: string): ChildProcessWithoutNullStreams {
  return childProcess().spawn(command, args, {
    cwd,
    shell: isWindowsShell(),
  });
}

function execCodex(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess().execFile(command, args, { shell: isWindowsShell() }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }

      resolve((stdout || stderr).trim());
    });
  });
}

export class CodexCliProvider implements ProviderAdapter {
  private readonly runningTurns = new Map<string, ChildProcessWithoutNullStreams>();

  constructor(private readonly getOptions: () => CodexProviderOptions) {}

  async healthCheck(): Promise<ProviderHealth> {
    const options = this.getOptions();

    try {
      const version = await execCodex(options.executable, ["--version"]);
      const loginStatus = await execCodex(options.executable, ["login", "status"]);
      return {
        ok: true,
        version,
        loginStatus,
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
    const args = buildCodexTurnArgs(options, request);

    const child = spawnCodex(options.executable, args, request.cwd);
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
              thread_id?: string;
              delta?: string;
              item?: { type?: string; text?: string };
            };

            switch (event.type) {
              case "thread.started":
                sessionId = event.thread_id ?? sessionId;
                onEvent?.({ type: "thread-started", threadId: sessionId, raw: event });
                break;
              case "turn.started":
                onEvent?.({ type: "turn-started", raw: event });
                break;
              case "item.delta":
                if (event.delta) {
                  collectedText += event.delta;
                  onEvent?.({ type: "message-delta", text: event.delta, raw: event });
                }
                break;
              case "item.completed":
                if (event.item?.type === "agent_message") {
                  collectedText = event.item.text ?? collectedText;
                  onEvent?.({ type: "message", text: collectedText, raw: event });
                }
                break;
              case "turn.completed":
                onEvent?.({ type: "turn-completed", raw: event });
                break;
              default:
                onEvent?.({ type: "stderr", text: line, raw: event });
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

        reject(new Error(stderrLines.join("\n") || `Codex exited with code ${code ?? "unknown"}`));
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
