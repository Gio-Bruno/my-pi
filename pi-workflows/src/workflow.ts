import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { TSchema } from "typebox";
import { json as jsonFormat, structured as structuredFormat, STRUCTURED_TOOL_NAME, text as textFormat } from "./formats.js";
import { ConsoleWorkflowLogger } from "./logging.js";
import { mapWithConcurrency, runNamedParallel } from "./parallel.js";
import { DefaultPipelineBuilder } from "./pipeline.js";
import { createWorkflowAgentSession, isInlineProfile, resolveProfileRoot } from "./profiles.js";
import { addUsage, DefaultBudgetTracker, emptyUsage, ScopedBudgetTracker, usageFromAssistantMessage } from "./budget.js";
import { defaultHumanProvider } from "./human.js";
import type {
  AgentOptions,
  AgentResult,
  AgentTarget,
  BudgetTracker,
  ChildWorkflowOptions,
  HumanAskOptions,
  HumanChooseOptions,
  HumanConfirmOptions,
  HumanApproveOptions,
  HumanProvider,
  HumanRequestBase,
  HumanApproval,
  OutputFormat,
  OutputRuntime,
  ParallelOptions,
  PipelineBuilder,
  ProfileMap,
  ProfileRef,
  RunWorkflowOptions,
  ShellOptions,
  ShellResult,
  UsageStats,
  Workflow,
  WorkflowContext,
  WorkflowDefaults,
  WorkflowLogger,
  WorkflowOptions,
} from "./types.js";

const execAsync = promisify(exec);

interface InternalRunWorkflowOptions<Args> extends RunWorkflowOptions<Args> {
  parentBudget?: BudgetTracker;
  nested?: boolean;
}

export function workflow<P extends ProfileMap = ProfileMap, Args = unknown, Result = unknown>(
  name: string,
  options: WorkflowOptions<P, Args, Result>,
): Workflow<P, Args, Result> {
  const phases = normalizePhases(options.phases);
  const defaults: WorkflowDefaults = {
    maxIterations: options.maxIterations,
    concurrency: options.concurrency,
    budget: options.budget,
  };

  return {
    meta: {
      name: validateWorkflowName(name),
      description: options.description,
      phases,
    },
    profiles: (options.agents ?? {}) as P,
    defaults,
    run: options.run,
  };
}

export async function run<P extends ProfileMap, Args = unknown, Result = unknown>(
  targetWorkflow: Workflow<P, Args, Result>,
  options: RunWorkflowOptions<Args> = {},
): Promise<Result> {
  return runWorkflowInternal(targetWorkflow, options);
}

async function runWorkflowInternal<P extends ProfileMap, Args = unknown, Result = unknown>(
  targetWorkflow: Workflow<P, Args, Result>,
  options: InternalRunWorkflowOptions<Args> = {},
): Promise<Result> {
  validateWorkflowShape(targetWorkflow);

  const logger = options.logger ?? new ConsoleWorkflowLogger();
  const defaults = normalizeDefaults(targetWorkflow.defaults, options);
  const budget = options.parentBudget
    ? new ScopedBudgetTracker(options.parentBudget, defaults.budget)
    : new DefaultBudgetTracker(defaults.budget);
  const cwd = options.cwd ?? process.cwd();
  const profileRoot = resolveProfileRoot(options.profileRoot);
  const human = options.human ?? defaultHumanProvider();

  logger.start?.(options.nested ? "child workflow" : "workflow", targetWorkflow.meta.name);

  const ctx = createWorkflowContext({
    workflow: targetWorkflow,
    cwd,
    profileRoot,
    defaults,
    logger,
    budget,
    human,
  });

  const result = await targetWorkflow.run(ctx, options.args as Args);
  budget.throwIfExceeded();
  logger.success?.(options.nested ? "child workflow" : "workflow", targetWorkflow.meta.name);
  return result;
}

function createWorkflowContext<P extends ProfileMap>({
  workflow,
  cwd,
  profileRoot,
  defaults,
  logger,
  budget,
  human,
}: {
  workflow: Workflow<P, unknown, unknown>;
  cwd: string;
  profileRoot?: string;
  defaults: Required<WorkflowDefaults>;
  logger: WorkflowLogger;
  budget: BudgetTracker;
  human: HumanProvider;
}): WorkflowContext<P> {
  const declaredPhases = new Set(workflow.meta.phases);
  const phaseStack: string[] = [];
  let phaseMarker: string | undefined;
  let humanCounter = 0;

  const currentPhase = () => phaseStack[phaseStack.length - 1] ?? phaseMarker;
  const stepLabel = (name: string) => `${currentPhase() ?? "root"}: ${name}`;

  function validatePhase(name: string): void {
    if (!declaredPhases.has(name)) {
      throw new Error(
        `Unknown phase "${name}" in workflow "${workflow.meta.name}". Declared phases: ${workflow.meta.phases.join(", ")}`,
      );
    }
  }

  const phase = ((name: string, fn?: () => Promise<unknown> | unknown) => {
    validatePhase(name);
    logger.phase?.(name);

    if (!fn) {
      phaseMarker = name;
      return undefined;
    }

    return (async () => {
      phaseStack.push(name);
      try {
        return await fn();
      } finally {
        phaseStack.pop();
      }
    })();
  }) as WorkflowContext<P>["phase"];

  let ctx!: WorkflowContext<P>;
  ctx = {
    cwd,
    profileRoot: profileRoot ?? "",
    profiles: workflow.profiles,
    defaults,
    budget,
    phase,

    async run<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
      budget.throwIfExceeded();
      logger.stepStart?.("js", stepLabel(name));
      try {
        const value = await fn();
        logger.stepEnd?.("js", stepLabel(name));
        budget.throwIfExceeded();
        return value;
      } catch (error) {
        logger.error?.("js", `${stepLabel(name)}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    },

    async sh(name: string, command: string, options: ShellOptions = {}): Promise<ShellResult> {
      budget.throwIfExceeded();
      logger.stepStart?.("shell", stepLabel(name));
      const result = await runShell(command, {
        ...options,
        cwd: options.cwd ?? cwd,
      });
      if (result.ok) logger.stepEnd?.("shell", stepLabel(name));
      else logger.warn?.("shell", `${stepLabel(name)} exited with ${result.code ?? result.signal ?? "unknown"}`);
      if (!result.ok && options.rejectOnFailure) {
        const error = new Error(`Shell step failed: ${name}\n${result.output}`) as Error & { result: ShellResult };
        error.result = result;
        throw error;
      }
      budget.throwIfExceeded();
      return result;
    },

    async text(target: AgentTarget<P>, prompt: string): Promise<string> {
      return (await ctx.request(target, prompt, { output: textFormat() })).value;
    },

    async json<T = unknown>(target: AgentTarget<P>, schemaOrPrompt: unknown, maybePrompt?: string): Promise<T> {
      const hasSchema = maybePrompt !== undefined;
      const prompt = hasSchema ? maybePrompt : String(schemaOrPrompt);
      const output = hasSchema ? jsonFormat(schemaOrPrompt as TSchema) : jsonFormat<T>();
      return (await ctx.request(target, prompt, { output: output as OutputFormat<T> })).value;
    },

    async structured<T = unknown>(target: AgentTarget<P>, schema: unknown, prompt: string): Promise<T> {
      return (await ctx.request(target, prompt, { output: structuredFormat(schema as TSchema) as OutputFormat<T> })).value;
    },

    async request<T = string>(
      target: AgentTarget<P>,
      prompt: string,
      options: AgentOptions<T> = {},
    ): Promise<AgentResult<T>> {
      budget.throwIfExceeded();
      const resolved = resolveAgentTarget(workflow.profiles, target);
      const output = (options.output ?? textFormat()) as OutputFormat<T>;
      logger.stepStart?.("agent", stepLabel(resolved.label));
      try {
        const result = await runProfileAgent({
          profile: resolved.profile,
          cwd,
          profileRoot,
          prompt,
          output,
          onUsage: (usage) => budget.addUsage(usage),
        });
        logger.stepEnd?.("agent", stepLabel(resolved.label));
        budget.throwIfExceeded();
        return result;
      } catch (error) {
        logger.error?.("agent", `${stepLabel(resolved.label)}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    },

    async workflow<ChildArgs = unknown, ChildResult = unknown>(
      child: Workflow<ProfileMap, ChildArgs, ChildResult>,
      args?: ChildArgs,
      options: ChildWorkflowOptions = {},
    ): Promise<ChildResult> {
      budget.throwIfExceeded();
      logger.stepStart?.("workflow", stepLabel(child.meta.name));
      try {
        const result = await runWorkflowInternal(child, {
          args,
          cwd: options.cwd ?? cwd,
          profileRoot: options.profileRoot ?? profileRoot,
          logger,
          budget: options.budget,
          human: options.human ?? human,
          parentBudget: budget,
          nested: true,
        });
        logger.stepEnd?.("workflow", stepLabel(child.meta.name));
        budget.throwIfExceeded();
        return result;
      } catch (error) {
        logger.error?.("workflow", `${stepLabel(child.meta.name)}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    },

    async approve(message: string, options: HumanApproveOptions = {}): Promise<HumanApproval> {
      const request = makeHumanRequest("approve", message, options);
      logger.stepStart?.("human", stepLabel(`approve: ${message}`));
      const result = await human.approve(request);
      logger.info?.("human", `${request.id}: ${result.approved ? "approved" : "not approved"}${result.reason ? ` (${result.reason})` : ""}`);
      logger.stepEnd?.("human", stepLabel(`approve: ${message}`));
      return result;
    },

    async confirm(message: string, options: HumanConfirmOptions = {}): Promise<boolean> {
      const request = makeHumanRequest("confirm", message, options);
      logger.stepStart?.("human", stepLabel(`confirm: ${message}`));
      const result = await human.confirm(request);
      logger.info?.("human", `${request.id}: ${result ? "yes" : "no"}`);
      logger.stepEnd?.("human", stepLabel(`confirm: ${message}`));
      return result;
    },

    async ask(message: string, options: HumanAskOptions = {}): Promise<string> {
      const request = makeHumanRequest("ask", message, options);
      logger.stepStart?.("human", stepLabel(`ask: ${message}`));
      const result = await human.ask(request);
      logger.info?.("human", `${request.id}: answered`);
      logger.stepEnd?.("human", stepLabel(`ask: ${message}`));
      return result;
    },

    async choose<T extends string>(message: string, choices: readonly T[], options: HumanChooseOptions<T> = {}): Promise<T> {
      const request = { ...makeHumanRequest("choose", message, options), choices };
      logger.stepStart?.("human", stepLabel(`choose: ${message}`));
      const result = await human.choose(request);
      logger.info?.("human", `${request.id}: ${result}`);
      logger.stepEnd?.("human", stepLabel(`choose: ${message}`));
      return result;
    },

    async parallel<T extends Record<string, () => Promise<unknown> | unknown>>(
      name: string,
      tasks: T,
      options: ParallelOptions = {},
    ): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
      budget.throwIfExceeded();
      logger.stepStart?.("parallel", stepLabel(name));
      try {
        const concurrency = options.concurrency ?? defaults.concurrency;
        const result = await runNamedParallel(tasks, concurrency);
        logger.stepEnd?.("parallel", stepLabel(name));
        budget.throwIfExceeded();
        return result;
      } catch (error) {
        logger.error?.("parallel", `${stepLabel(name)}: ${error instanceof Error ? error.message : String(error)}`);
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
      logger.stepStart?.("parallel", `${stepLabel(name)} (${items.length} items)`);
      try {
        const result = await mapWithConcurrency(items, options.concurrency ?? defaults.concurrency, worker);
        logger.stepEnd?.("parallel", stepLabel(name));
        budget.throwIfExceeded();
        return result;
      } catch (error) {
        logger.error?.("parallel", `${stepLabel(name)}: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    },

    pipeline<TItem>(name: string, items: readonly TItem[]): PipelineBuilder<TItem, TItem> {
      return new DefaultPipelineBuilder<TItem, TItem>(() => stepLabel(name), items, logger, [], defaults.concurrency);
    },
  };

  function makeHumanRequest<TDefault>(
    kind: string,
    message: string,
    options: { id?: string; details?: unknown; default?: TDefault },
  ): HumanRequestBase<TDefault> {
    return {
      id: options.id ?? `${slug(workflow.meta.name)}-${kind}-${++humanCounter}`,
      workflow: workflow.meta.name,
      phase: currentPhase(),
      message,
      details: options.details,
      default: options.default,
    };
  }

  return ctx;
}

function resolveAgentTarget<P extends ProfileMap>(profiles: P, target: AgentTarget<P>) {
  if (isInlineProfile(target)) {
    return { profile: target, label: target.name ? `inline:${target.name}` : "inline" };
  }

  const profile = profiles[target];
  if (!profile) throw new Error(`Unknown workflow agent role: ${target}`);
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

function validateWorkflowName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("workflow(name, options) requires a non-empty name.");
  return trimmed;
}

function normalizePhases(phases: readonly string[]): string[] {
  if (!Array.isArray(phases) || phases.length === 0) {
    throw new Error("workflow(name, options) requires phases with at least one phase.");
  }

  const normalized = phases.map((phase) => {
    if (typeof phase !== "string" || !phase.trim()) {
      throw new Error("workflow phases must be non-empty strings.");
    }
    return phase.trim();
  });

  const duplicates = normalized.filter((phase, index) => normalized.indexOf(phase) !== index);
  if (duplicates.length > 0) {
    throw new Error(`workflow phases must be unique. Duplicate phase(s): ${Array.from(new Set(duplicates)).join(", ")}`);
  }

  return normalized;
}

function validateWorkflowShape(targetWorkflow: Workflow): void {
  if (!targetWorkflow?.run || !targetWorkflow.meta || !targetWorkflow.profiles) {
    throw new Error("Workflow module must export default workflow(name, options).");
  }
  normalizePhases(targetWorkflow.meta.phases);
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workflow";
}
