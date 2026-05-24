import type { BudgetTracker, UsageStats, WorkflowBudgetConfig } from "./types.js";

export function emptyUsage(): UsageStats {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    costUsd: 0,
    turns: 0,
  };
}

export function addUsage(a: UsageStats, b: UsageStats): UsageStats {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    totalTokens: a.totalTokens + b.totalTokens,
    costUsd: a.costUsd + b.costUsd,
    turns: a.turns + b.turns,
  };
}

export class WorkflowBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowBudgetExceededError";
  }
}

export class DefaultBudgetTracker implements BudgetTracker {
  private readonly startedAt = Date.now();
  private currentUsage = emptyUsage();

  constructor(readonly config: WorkflowBudgetConfig = {}) {}

  get usage(): UsageStats {
    return { ...this.currentUsage };
  }

  addUsage(usage: UsageStats): void {
    this.currentUsage = addUsage(this.currentUsage, usage);
  }

  throwIfExceeded(): void {
    const { maxCostUsd, maxTokens, timeoutMs } = this.config;

    if (maxCostUsd !== undefined && this.currentUsage.costUsd > maxCostUsd) {
      throw new WorkflowBudgetExceededError(
        `Workflow budget exceeded: cost $${this.currentUsage.costUsd.toFixed(4)} > $${maxCostUsd.toFixed(4)}`,
      );
    }

    if (maxTokens !== undefined && this.currentUsage.totalTokens > maxTokens) {
      throw new WorkflowBudgetExceededError(
        `Workflow budget exceeded: tokens ${this.currentUsage.totalTokens} > ${maxTokens}`,
      );
    }

    if (timeoutMs !== undefined && Date.now() - this.startedAt > timeoutMs) {
      throw new WorkflowBudgetExceededError(
        `Workflow budget exceeded: elapsed ${Date.now() - this.startedAt}ms > ${timeoutMs}ms`,
      );
    }
  }
}

export function usageFromAssistantMessage(message: any): UsageStats {
  const usage = message?.usage ?? {};
  return {
    input: Number(usage.input ?? 0),
    output: Number(usage.output ?? 0),
    cacheRead: Number(usage.cacheRead ?? 0),
    cacheWrite: Number(usage.cacheWrite ?? 0),
    totalTokens: Number(usage.totalTokens ?? 0),
    costUsd: Number(usage.cost?.total ?? usage.costUsd ?? 0),
    turns: 1,
  };
}
