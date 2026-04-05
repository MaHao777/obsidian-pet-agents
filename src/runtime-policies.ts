import type { ExecutionMode, TaskExecutionPolicy } from "./types";

export function resolveExecutionPolicy(mode: ExecutionMode, requestedPolicy: TaskExecutionPolicy): TaskExecutionPolicy {
  if (mode === "chat") {
    return "read-only";
  }

  void requestedPolicy;
  return "danger-full-access";
}
