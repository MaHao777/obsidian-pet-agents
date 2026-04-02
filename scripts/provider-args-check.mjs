import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = mkdtempSync(join(tmpdir(), "obs-pet-provider-"));
const outfile = join(tempDir, "provider-test.mjs");

try {
  mkdirSync(tempDir, { recursive: true });

  await build({
    entryPoints: [resolve(projectRoot, "src", "provider.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
  });

  const module = await import(pathToFileURL(outfile).href);
  assert.equal(typeof module.buildCodexTurnArgs, "function", "buildCodexTurnArgs export is missing");

  const baseOptions = {
    executable: "codex",
    model: "gpt-5.4",
    profile: "default",
  };

  const baseRequest = {
    prompt: "hello",
    cwd: projectRoot,
    mode: "chat",
    executionPolicy: "read-only",
    requestId: "check",
  };

  const newSessionArgs = module.buildCodexTurnArgs(baseOptions, baseRequest);
  assert.deepEqual(newSessionArgs.slice(0, 5), ["--profile", "default", "--model", "gpt-5.4", "exec"]);
  assert.ok(newSessionArgs.includes("--sandbox"), "new exec turns should still set sandbox for chat mode");

  const resumeArgs = module.buildCodexTurnArgs(baseOptions, {
    ...baseRequest,
    sessionId: "session-123",
  });

  const resumeSandboxIndex = resumeArgs.indexOf("--sandbox");
  assert.equal(resumeSandboxIndex, -1, "resume turns must not pass --sandbox");
  assert.ok(resumeArgs.includes("resume"), "resume turns must use exec resume");
  assert.ok(resumeArgs.indexOf("--json") < resumeArgs.indexOf("session-123"), "resume flags must appear before the session id");
  assert.ok(resumeArgs.indexOf("--skip-git-repo-check") < resumeArgs.indexOf("session-123"), "resume flags must appear before the session id");

  console.log("provider-args-check: ok");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
