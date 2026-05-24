import type { Static, TSchema } from "typebox";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type AgentMessageLike = Record<string, unknown> & {
  role?: string;
  content?: unknown[];
  usage?: Record<string, unknown>;
  stopReason?: string;
  errorMessage?: string;
};

export interface ModelRef {
  provider: string;
  id: string;
}

export interface InlineAgentProfile {
  kind: "inline";
  name?: string;
  tools?: string[];
  extensionPaths?: string[];
  extensionPackages?: string[];
  customTools?: unknown[];
  skillPaths?: string[];
  promptPaths?: string[];
  themePaths?: string[];
  systemPrompt?: string;
  appendSystemPrompt?: string | string[] | null;
  instructions?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  noContextFiles?: boolean;
}

export type InlineAgentConfig = Omit<InlineAgentProfile, "kind">;
export type AgentPresetOptions = Omit<InlineAgentConfig, "instructions">;
export type ProfileRef = string | InlineAgentProfile;
export type ProfileMap = Record<string, ProfileRef>;
export type AgentTarget<P extends ProfileMap> = (keyof P & string) | InlineAgentProfile;

export interface WorkflowMeta {
  name: string;
  description?: string;
  phases: string[];
}

export interface WorkflowBudgetConfig {
  maxCostUsd?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface WorkflowDefaults {
  maxIterations?: number;
  budget?: WorkflowBudgetConfig;
  concurrency?: number;
}

export interface Workflow<P extends ProfileMap = ProfileMap, Args = unknown, Result = unknown> {
  meta: WorkflowMeta;
  profiles: P;
  defaults?: WorkflowDefaults;
  run(ctx: WorkflowContext<P>, args: Args): Promise<Result> | Result;
}

export interface WorkflowOptions<P extends ProfileMap = ProfileMap, Args = unknown, Result = unknown> {
  description?: string;
  phases: readonly string[];
  agents?: P;
  budget?: WorkflowBudgetConfig;
  concurrency?: number;
  maxIterations?: number;
  run(ctx: WorkflowContext<P>, args: Args): Promise<Result> | Result;
}

export interface RunWorkflowOptions<Args = unknown> {
  args?: Args;
  cwd?: string;
  profileRoot?: string;
  logger?: WorkflowLogger;
  budget?: WorkflowBudgetConfig;
  human?: HumanProvider;
}

export interface ChildWorkflowOptions {
  cwd?: string;
  profileRoot?: string;
  budget?: WorkflowBudgetConfig;
  human?: HumanProvider;
}

export interface ShellOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBuffer?: number;
  rejectOnFailure?: boolean;
}

export interface ShellResult {
  ok: boolean;
  command: string;
  cwd: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  output: string;
}

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costUsd: number;
  turns: number;
}

export interface ToolCallSummary {
  id?: string;
  name: string;
  args: unknown;
}

export interface AgentResult<T> {
  value: T;
  rawText: string;
  messages: AgentMessageLike[];
  usage: UsageStats;
  toolCalls: ToolCallSummary[];
  stopReason?: string;
  errorMessage?: string;
  profile: string;
  inline: boolean;
}

export interface AgentOptions<T> {
  output?: OutputFormat<T>;
}

export interface OutputRuntime {
  structuredDetails?: unknown;
}

export interface OutputFormat<T> {
  name: string;
  augmentPrompt?(prompt: string): string;
  customTools?: unknown[];
  toolNames?: string[];
  parse(rawText: string, runtime: OutputRuntime): T;
}

export interface ParallelOptions {
  concurrency?: number;
}

export interface PipelineStageOptions {
  concurrency?: number;
}

export interface WorkflowLogger {
  phase?(name: string): void;
  workflowStart?(name: string): void;
  workflowEnd?(name: string): void;
  start?(phase: string, message?: string): void;
  info?(phaseOrMessage: string, message?: string): void;
  success?(phaseOrMessage: string, message?: string): void;
  warn?(phaseOrMessage: string, message?: string): void;
  error?(phaseOrMessage: string, message?: string): void;
  stepStart?(kind: string, name: string): void;
  stepEnd?(kind: string, name: string): void;
}

export interface BudgetTracker {
  readonly usage: UsageStats;
  readonly config: WorkflowBudgetConfig;
  addUsage(usage: UsageStats): void;
  throwIfExceeded(): void;
}

export interface HumanRequestBase<TDefault = unknown> {
  id: string;
  workflow: string;
  phase?: string;
  message: string;
  details?: unknown;
  default?: TDefault;
}

export interface HumanApproveRequest extends HumanRequestBase<boolean> {}
export interface HumanConfirmRequest extends HumanRequestBase<boolean> {}
export interface HumanAskRequest extends HumanRequestBase<string> {}
export interface HumanChooseRequest<T extends string = string> extends HumanRequestBase<T> {
  choices: readonly T[];
}

export interface HumanApproval {
  approved: boolean;
  reason?: string;
}

export interface HumanProvider {
  approve(request: HumanApproveRequest): Promise<HumanApproval>;
  confirm(request: HumanConfirmRequest): Promise<boolean>;
  ask(request: HumanAskRequest): Promise<string>;
  choose<T extends string>(request: HumanChooseRequest<T>): Promise<T>;
}

export interface HumanPromptOptions<TDefault = unknown> {
  id?: string;
  details?: unknown;
  default?: TDefault;
}

export type HumanApproveOptions = HumanPromptOptions<boolean>;
export type HumanConfirmOptions = HumanPromptOptions<boolean>;
export type HumanAskOptions = HumanPromptOptions<string>;
export type HumanChooseOptions<T extends string = string> = HumanPromptOptions<T>;

export interface WorkflowContext<P extends ProfileMap = ProfileMap> {
  readonly cwd: string;
  readonly profileRoot: string;
  readonly profiles: P;
  readonly defaults: Required<WorkflowDefaults>;
  readonly budget: BudgetTracker;
  phase(name: string): void;
  phase<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
  run<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
  sh(name: string, command: string, options?: ShellOptions): Promise<ShellResult>;
  text(target: AgentTarget<P>, prompt: string): Promise<string>;
  json<T = unknown>(target: AgentTarget<P>, prompt: string): Promise<T>;
  json<const S extends TSchema>(target: AgentTarget<P>, schema: S, prompt: string): Promise<Static<S>>;
  structured<const S extends TSchema>(target: AgentTarget<P>, schema: S, prompt: string): Promise<Static<S>>;
  request<T = string>(target: AgentTarget<P>, prompt: string, options?: AgentOptions<T>): Promise<AgentResult<T>>;
  workflow<ChildArgs = unknown, ChildResult = unknown>(
    child: Workflow<ProfileMap, ChildArgs, ChildResult>,
    args?: ChildArgs,
    options?: ChildWorkflowOptions,
  ): Promise<ChildResult>;
  approve(message: string, options?: HumanApproveOptions): Promise<HumanApproval>;
  confirm(message: string, options?: HumanConfirmOptions): Promise<boolean>;
  ask(message: string, options?: HumanAskOptions): Promise<string>;
  choose<T extends string>(message: string, choices: readonly T[], options?: HumanChooseOptions<T>): Promise<T>;
  parallel<T extends Record<string, () => Promise<unknown> | unknown>>(
    name: string,
    tasks: T,
    options?: ParallelOptions,
  ): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }>;
  mapParallel<TItem, TResult>(
    name: string,
    items: readonly TItem[],
    worker: (item: TItem, index: number) => Promise<TResult> | TResult,
    options?: ParallelOptions,
  ): Promise<TResult[]>;
  pipeline<TItem>(name: string, items: readonly TItem[]): PipelineBuilder<TItem, TItem>;
}

export interface PipelineBuilder<TInput, TCurrent> {
  stage<TNext>(
    name: string,
    worker: (item: TCurrent, index: number) => Promise<TNext> | TNext,
    options?: PipelineStageOptions,
  ): PipelineBuilder<TInput, TNext>;
  run(): Promise<TCurrent[]>;
}

export interface PiProfileConfig {
  builtinTools?: string[];
  extensionTools?: string[];
  extensionPackages?: string[];
  extraArgs?: string[];
  systemPrompt?: string | null;
  appendSystemPrompt?: string | null;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
}
