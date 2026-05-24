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
    throwIfUsageExceeded(this.config, this.currentUsage, this.startedAt);
  }
}

export class ScopedBudgetTracker implements BudgetTracker {
  private readonly startedAt = Date.now();
  private currentUsage = emptyUsage();

  constructor(
    private readonly parent: BudgetTracker,
    readonly config: WorkflowBudgetConfig = {},
  ) {}

  get usage(): UsageStats {
    return { ...this.currentUsage };
  }

  addUsage(usage: UsageStats): void {
    this.currentUsage = addUsage(this.currentUsage, usage);
    this.parent.addUsage(usage);
  }

  throwIfExceeded(): void {
    throwIfUsageExceeded(this.config, this.currentUsage, this.startedAt);
    this.parent.throwIfExceeded();
  }
}

function throwIfUsageExceeded(config: WorkflowBudgetConfig, usage: UsageStats, startedAt: number): void {
  const { maxCostUsd, maxTokens, timeoutMs } = config;

  if (maxCostUsd !== undefined && usage.costUsd > maxCostUsd) {
    throw new WorkflowBudgetExceededError(
      `Workflow budget exceeded: cost $${usage.costUsd.toFixed(4)} > $${maxCostUsd.toFixed(4)}`,
    );
  }

  if (maxTokens !== undefined && usage.totalTokens > maxTokens) {
    throw new WorkflowBudgetExceededError(`Workflow budget exceeded: tokens ${usage.totalTokens} > ${maxTokens}`);
  }

  if (timeoutMs !== undefined && Date.now() - startedAt > timeoutMs) {
    throw new WorkflowBudgetExceededError(`Workflow budget exceeded: elapsed ${Date.now() - startedAt}ms > ${timeoutMs}ms`);
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
