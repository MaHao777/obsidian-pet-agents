import type { ChildProcessWithoutNullStreams } from "child_process";

declare const require: NodeRequire;

export interface ChildProcessModule {
  spawn: typeof import("child_process").spawn;
  execFile: typeof import("child_process").execFile;
}

export function getRequire(): NodeRequire {
  const scopedWindow = window as Window & { require?: NodeRequire };
  if (typeof scopedWindow.require === "function") {
    return scopedWindow.require;
  }
  return require;
}

export function childProcess(): ChildProcessModule {
  return getRequire()("child_process") as ChildProcessModule;
}

export function isWindowsShell(): boolean {
  return navigator.userAgent.toLowerCase().includes("windows");
}

export function spawnCli(command: string, args: string[], cwd: string): ChildProcessWithoutNullStreams {
  return childProcess().spawn(command, args, {
    cwd,
    shell: isWindowsShell(),
  });
}

export function execCli(command: string, args: string[]): Promise<string> {
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
