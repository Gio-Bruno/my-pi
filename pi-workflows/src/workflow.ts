import { exec } from "node:child_process";
import { promisify } from "node:util";
import { STRUCTURED_TOOL_NAME, text } from "./formats.js";
import { ConsoleWorkflowLogger, LoggerPhaseLog } from "./logging.js";
import { mapWithConcurrency, runNamedParallel } from "./parallel.js";
import { DefaultPipelineBuilder } from "./pipeline.js";
import { createWorkflowAgentSession, isInlineProfile, resolveProfileRoot } from "./profiles.js";
import { addUsage, DefaultBudgetTracker, emptyUsage, usageFromAssistantMessage } from "./budget.js";
import type {
  AgentOptions,
  AgentResult,
  AgentTarget,
  ProfileRef,
  OutputFormat,
  OutputRuntime,
  ParallelOptions,
  PipelineBuilder,
  ProfileMap,
  RunWorkflowOptions,
  ShellOptions,
  ShellResult,
  UsageStats,
  Workflow,
  WorkflowContext,
  WorkflowDefaults,
  WorkflowLogger,
} from "./types.js";

const execAsync = promisify(exec);

export function defineWorkflow<P extends ProfileMap, Args = unknown, Result = unknown>(
  workflow: Workflow<P, Args, Result>,
): Workflow<P, Args, Result> {
  return workflow;
}

export async function runWorkflow<P extends ProfileMap, Args = unknown, Result = unknown>(
  workflow: Workflow<P, Args, Result>,
  options: RunWorkflowOptions<Args> = {},
): Promise<Result> {
  const logger = options.logger ?? new ConsoleWorkflowLogger();
  const defaults = normalizeDefaults(workflow.defaults, options);
  const budget = new DefaultBudgetTracker(defaults.budget);
  const cwd = options.cwd ?? process.cwd();
  const profileRoot = resolveProfileRoot(options.profileRoot);

  logger.start?.("workflow", workflow.meta.name);

  const ctx = createWorkflowContext({
    workflow,
    cwd,
    profileRoot,
    defaults,
    logger,
    budget,
  });

  const result = await workflow.run(ctx, options.args as Args);
  budget.throwIfExceeded();
  logger.success?.("workflow", workflow.meta.name);
  return result;
}

function createWorkflowContext<P extends ProfileMap>({
  workflow,
  cwd,
  profileRoot,
  defaults,
  logger,
  budget,
}: {
  workflow: Workflow<P, unknown, unknown>;
  cwd: string;
  profileRoot?: string;
  defaults: Required<WorkflowDefaults>;
  logger: WorkflowLogger;
  budget: DefaultBudgetTracker;
}): WorkflowContext<P> {
  const phaseLog = new LoggerPhaseLog(logger);

  let ctx!: WorkflowContext<P>;
  ctx = {
    cwd,
    profileRoot: profileRoot ?? "",
    profiles: workflow.profiles,
    defaults,
    phaseLog,
    budget,

    phase(name: string) {
      logger.phase?.(name);
    },

    async run<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
      budget.throwIfExceeded();
      logger.stepStart?.("js", name);
      try {
        const value = await fn();
        logger.stepEnd?.("js", name);
        budget.throwIfExceeded();
        return value;
      } catch (error) {
        logger.error?.("js", `${name}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    },

    async sh(name: string, command: string, options: ShellOptions = {}): Promise<ShellResult> {
      budget.throwIfExceeded();
      logger.stepStart?.("shell", name);
      const result = await runShell(command, {
        ...options,
        cwd: options.cwd ?? cwd,
      });
      if (result.ok) logger.stepEnd?.("shell", name);
      else logger.warn?.("shell", `${name} exited with ${result.code ?? result.signal ?? "unknown"}`);
      if (!result.ok && options.rejectOnFailure) {
        const error = new Error(`Shell step failed: ${name}\n${result.output}`) as Error & { result: ShellResult };
        error.result = result;
        throw error;
      }
      budget.throwIfExceeded();
      return result;
    },

    async agent<T = string>(
      target: AgentTarget<P>,
      prompt: string,
      options: AgentOptions<T> = {},
    ): Promise<T> {
      return (await ctx.agentRaw(target, prompt, options)).value;
    },

    async agentRaw<T = string>(
      target: AgentTarget<P>,
      prompt: string,
      options: AgentOptions<T> = {},
    ): Promise<AgentResult<T>> {
      budget.throwIfExceeded();
      const resolved = resolveAgentTarget(workflow.profiles, target);
      const output = (options.output ?? text()) as OutputFormat<T>;
      logger.stepStart?.("agent", resolved.label);
      const result = await runProfileAgent({
        profile: resolved.profile,
        cwd,
        profileRoot,
        prompt,
        output,
        onUsage: (usage) => budget.addUsage(usage),
      });
      logger.stepEnd?.("agent", resolved.label);
      budget.throwIfExceeded();
      return result;
    },

    async parallel<T extends Record<string, () => Promise<unknown> | unknown>>(
      name: string,
      tasks: T,
      options: ParallelOptions = {},
    ): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
      budget.throwIfExceeded();
      logger.stepStart?.("parallel", name);
      try {
        const concurrency = options.concurrency ?? defaults.concurrency;
        const result = await runNamedParallel(tasks, concurrency);
        logger.stepEnd?.("parallel", name);
        budget.throwIfExceeded();
        return result;
      } catch (error) {
        logger.error?.("parallel", `${name}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    },

    async mapParallel<TItem, TResult>(
      name: string,
      items: readonly TItem[],
      worker: (item: TItem, index: number) => Promise<TResult> | TResult,
      options: ParallelOptions = {},
    ): Promise<TResult[]> {
      budget.throwIfExceeded();
      logger.stepStart?.("parallel", `${name} (${items.length} items)`);
      try {
        const result = await mapWithConcurrency(items, options.concurrency ?? defaults.concurrency, worker);
        logger.stepEnd?.("parallel", name);
        budget.throwIfExceeded();
        return result;
      } catch (error) {
        logger.error?.("parallel", `${name}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    },

    pipeline<TItem>(name: string, items: readonly TItem[]): PipelineBuilder<TItem, TItem> {
      return new DefaultPipelineBuilder<TItem, TItem>(name, items, logger, [], defaults.concurrency);
    },
  };

  return ctx;
}

function resolveAgentTarget<P extends ProfileMap>(profiles: P, target: AgentTarget<P>) {
  if (isInlineProfile(target)) {
    return { profile: target, label: target.name ? `inline:${target.name}` : "inline" };
  }

  const profile = profiles[target];
  if (!profile) throw new Error(`Unknown workflow profile role: ${target}`);
  const profileLabel = isInlineProfile(profile) ? `inline:${profile.name ?? target}` : profile;
  return { profile, label: `${target} -> ${profileLabel}` };
}

async function runProfileAgent<T>({
  profile,
  cwd,
  profileRoot,
  prompt,
  output,
  onUsage,
}: {
  profile: ProfileRef;
  cwd: string;
  profileRoot?: string;
  prompt: string;
  output: OutputFormat<T>;
  onUsage: (usage: UsageStats) => void;
}): Promise<AgentResult<T>> {
  const { session, label, inline } = await createWorkflowAgentSession({ profile, cwd, profileRoot, output });
  const messages: any[] = [];
  const toolCalls: AgentResult<T>["toolCalls"] = [];
  const usage = emptyUsage();
  const runtime: OutputRuntime = {};
  let rawText = "";
  let stopReason: string | undefined;
  let errorMessage: string | undefined;

  const unsubscribe = session.subscribe((event: any) => {
    if (event.type === "tool_execution_start") {
      toolCalls.push({ id: event.toolCallId, name: event.toolName, args: event.args });
    }

    if (event.type === "tool_execution_end") {
      if (event.toolName === STRUCTURED_TOOL_NAME) {
        runtime.structuredDetails = event.result?.details;
      }
    }

    if (event.type === "message_end" && event.message) {
      messages.push(event.message);
      if (event.message.role === "assistant") {
        const assistantUsage = usageFromAssistantMessage(event.message);
        Object.assign(usage, addUsage(usage, assistantUsage));
        onUsage(assistantUsage);
        stopReason = event.message.stopReason ?? stopReason;
        errorMessage = event.message.errorMessage ?? errorMessage;
        rawText = extractAssistantText(event.message) || rawText;
      }
    }
  });

  try {
    await session.prompt(output.augmentPrompt ? output.augmentPrompt(prompt) : prompt);
    const value = output.parse(rawText, runtime);
    return {
      value,
      rawText,
      messages,
      usage,
      toolCalls,
      stopReason,
      errorMessage,
      profile: label,
      inline,
    };
  } finally {
    unsubscribe();
    session.dispose();
  }
}

async function runShell(command: string, options: Required<Pick<ShellOptions, "cwd">> & ShellOptions): Promise<ShellResult> {
  try {
    const result = await execAsync(command, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeoutMs,
      maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    });
    return {
      ok: true,
      command,
      cwd: options.cwd,
      code: 0,
      signal: null,
      stdout: result.stdout,
      stderr: result.stderr,
      output: result.stdout + result.stderr,
    };
  } catch (error: any) {
    const stdout = String(error.stdout ?? "");
    const stderr = String(error.stderr ?? "");
    return {
      ok: false,
      command,
      cwd: options.cwd,
      code: typeof error.code === "number" ? error.code : null,
      signal: error.signal ?? null,
      stdout,
      stderr,
      output: stdout + stderr,
    };
  }
}

function extractAssistantText(message: any): string {
  return (message.content ?? [])
    .filter((part: any) => part?.type === "text")
    .map((part: any) => part.text)
    .join("\n");
}

function normalizeDefaults<Args>(workflowDefaults: WorkflowDefaults | undefined, options: RunWorkflowOptions<Args>): Required<WorkflowDefaults> {
  return {
    maxIterations: workflowDefaults?.maxIterations ?? 1,
    concurrency: workflowDefaults?.concurrency ?? 4,
    budget: {
      ...(workflowDefaults?.budget ?? {}),
      ...(options.budget ?? {}),
    },
  };
}
