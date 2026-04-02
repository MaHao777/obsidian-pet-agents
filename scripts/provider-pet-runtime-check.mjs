import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = mkdtempSync(join(tmpdir(), "obs-pet-provider-runtime-"));
const outfile = join(tempDir, "provider-runtime-test.mjs");

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
    model: "",
    profile: "default",
  };

  const baseRequest = {
    prompt: "hello",
    cwd: projectRoot,
    mode: "chat",
    executionPolicy: "read-only",
    requestId: "pet-runtime-check",
    model: "gpt-5.4",
    reasoningEffort: "high",
  };

  const newSessionArgs = module.buildCodexTurnArgs(baseOptions, baseRequest);
  assert.ok(newSessionArgs.includes("--model"), "request-level model should be added");
  assert.ok(newSessionArgs.includes("gpt-5.4"), "request-level model value should be preserved");
  assert.ok(newSessionArgs.includes("-c"), "request-level reasoning should add a config override");
  assert.ok(newSessionArgs.includes('reasoning_effort="high"'), "reasoning override should be encoded as config");

  const resumeArgs = module.buildCodexTurnArgs(baseOptions, {
    ...baseRequest,
    sessionId: "session-123",
    reasoningEffort: "xhigh",
  });
  assert.ok(resumeArgs.includes('reasoning_effort="xhigh"'), "resume turns should retain request reasoning");
  assert.ok(resumeArgs.includes("session-123"), "resume turns must still include the session id");

  console.log("provider-pet-runtime-check: ok");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
