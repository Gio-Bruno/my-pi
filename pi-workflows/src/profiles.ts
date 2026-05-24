import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentPresetOptions,
  InlineAgentConfig,
  InlineAgentProfile,
  OutputFormat,
  PiProfileConfig,
  ProfileRef,
  ThinkingLevel,
} from "./types.js";

const DEFAULT_BUILTIN_TOOLS = ["read", "write", "edit", "bash"];
const EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);

export interface LoadedProfile {
  name: string;
  dir: string;
  config: PiProfileConfig;
  tools: string[];
  extensionPaths: string[];
  systemPrompt?: string;
  disableSystemPromptDiscovery: boolean;
  appendSystemPrompt: string[];
}

export interface CreateProfileSessionOptions<T> {
  profileName: string;
  cwd: string;
  profileRoot?: string;
  output: OutputFormat<T>;
}

export interface CreateWorkflowAgentSessionOptions<T> {
  profile: ProfileRef;
  cwd: string;
  profileRoot?: string;
  output: OutputFormat<T>;
}

export function inlineProfile(config: InlineAgentConfig): InlineAgentProfile {
  return { kind: "inline", ...config };
}

export function profile(name: string): string {
  validateProfileName(name);
  return name;
}

export function inlineAgent(config: InlineAgentConfig): InlineAgentProfile {
  return inlineProfile(config);
}

export function readOnlyAgent(instructions = "Read files and answer concisely. Do not edit files.", options: AgentPresetOptions = {}): InlineAgentProfile {
  return presetAgent({
    name: "read-only",
    tools: ["read", "grep", "find", "ls"],
    thinkingLevel: "low",
    ...options,
    instructions: joinInstructions("Read-only agent. Do not edit files.", instructions),
  });
}

export function codeSearchAgent(
  instructions = "Search the codebase and answer with minimal tokens and strongest evidence.",
  options: AgentPresetOptions = {},
): InlineAgentProfile {
  return presetAgent({
    name: "code-search",
    tools: ["read", "grep", "find", "ls", "bash"],
    thinkingLevel: "low",
    ...options,
    instructions: joinInstructions("Code search agent. Prefer read-only inspection and concise evidence.", instructions),
  });
}

export function editAgent(instructions = "Make minimal safe edits.", options: AgentPresetOptions = {}): InlineAgentProfile {
  return presetAgent({
    name: "editor",
    tools: ["read", "grep", "find", "ls", "edit", "write", "bash"],
    thinkingLevel: "medium",
    ...options,
    instructions: joinInstructions("Editing agent. Keep changes minimal and safe.", instructions),
  });
}

export function isInlineProfile(value: unknown): value is InlineAgentProfile {
  return Boolean(value && typeof value === "object" && (value as { kind?: unknown }).kind === "inline");
}

export function resolveProfileRoot(explicit?: string): string {
  if (explicit) return resolve(expandHome(explicit));
  if (process.env.PI_AGENTS_HOME) return resolve(expandHome(process.env.PI_AGENTS_HOME));

  const configHome = process.env.XDG_CONFIG_HOME
    ? expandHome(process.env.XDG_CONFIG_HOME)
    : join(homedir(), ".config");
  const pathFile = join(configHome, "custom-pi-agents", "agent-path");
  if (existsSync(pathFile)) {
    const stored = readFileSync(pathFile, "utf8").trim();
    if (stored) return resolve(expandHome(stored));
  }

  return join(homedir(), ".pi-agents");
}

export function loadProfile(profileName: string, profileRoot?: string): LoadedProfile {
  validateProfileName(profileName);

  const root = resolveProfileRoot(profileRoot);
  const dir = join(root, profileName);
  if (!isDirectory(dir)) {
    throw new Error(`Pi profile "${profileName}" does not exist at ${dir}`);
  }

  const configPath = join(dir, "config.json");
  const config = readProfileConfig(configPath);

  const builtinTools = asStringArray(config.builtinTools, "builtinTools", DEFAULT_BUILTIN_TOOLS);
  const extensionTools = asStringArray(config.extensionTools, "extensionTools", []);
  const extensionPackages = asStringArray(config.extensionPackages, "extensionPackages", []);
  const toolFiles = extensionFiles(join(dir, "tools"));
  const extensionFilesAndIndexes = [
    ...extensionFiles(join(dir, "extensions")),
    ...extensionIndexFiles(join(dir, "extensions")),
  ];

  const toolFileNames = toolFiles.map((file) => basename(file).replace(/\.[^.]+$/, ""));
  const tools = unique([...builtinTools, ...toolFileNames, ...extensionTools]);
  const extensionPaths = [...toolFiles, ...extensionFilesAndIndexes, ...extensionPackages];

  const systemPrompt = config.systemPrompt ? resolveProfileFile(dir, config.systemPrompt) : undefined;
  const disableSystemPromptDiscovery = config.systemPrompt === null;
  if (systemPrompt && !existsSync(systemPrompt)) {
    throw new Error(`systemPrompt file does not exist: ${systemPrompt}`);
  }

  const appendSystemPrompt = resolveAppendSystemPrompt(dir, config);

  return {
    name: profileName,
    dir,
    config,
    tools,
    extensionPaths,
    systemPrompt,
    disableSystemPromptDiscovery,
    appendSystemPrompt,
  };
}

export async function createProfileAgentSession<T>({
  profileName,
  cwd,
  profileRoot,
  output,
}: CreateProfileSessionOptions<T>) {
  const profile = loadProfile(profileName, profileRoot);
  const authStorage = AuthStorage.create(join(profile.dir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, join(profile.dir, "models.json"));
  const settingsManager = SettingsManager.create(cwd, profile.dir);

  const model = profile.config.model
    ? modelRegistry.find(profile.config.model.provider, profile.config.model.id)
    : undefined;
  if (profile.config.model && !model) {
    throw new Error(`Model not found for profile ${profileName}: ${profile.config.model.provider}/${profile.config.model.id}`);
  }

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: profile.dir,
    settingsManager,
    noContextFiles: true,
    noExtensions: true,
    additionalExtensionPaths: profile.extensionPaths,
    noSkills: true,
    additionalSkillPaths: [join(profile.dir, "skills")],
    noPromptTemplates: true,
    additionalPromptTemplatePaths: [join(profile.dir, "prompts")],
    noThemes: true,
    additionalThemePaths: [join(profile.dir, "themes")],
    systemPrompt: profile.systemPrompt,
    appendSystemPrompt: profile.appendSystemPrompt,
    systemPromptOverride: profile.disableSystemPromptDiscovery ? () => undefined : undefined,
  });
  await loader.reload();

  const workflowToolNames = output.toolNames ?? [];
  const customTools = (output.customTools ?? []) as ToolDefinition[];
  const tools = unique([...profile.tools, ...workflowToolNames]);

  const { session } = await createAgentSession({
    cwd,
    agentDir: profile.dir,
    authStorage,
    modelRegistry,
    settingsManager,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    tools,
    customTools,
    model,
    thinkingLevel: profile.config.thinkingLevel as ThinkingLevel | undefined,
  });

  return { session, label: profile.name, inline: false, profile };
}

export async function createWorkflowAgentSession<T>({
  profile,
  cwd,
  profileRoot,
  output,
}: CreateWorkflowAgentSessionOptions<T>) {
  if (!isInlineProfile(profile)) {
    return createProfileAgentSession({ profileName: profile, cwd, profileRoot, output });
  }

  const agentDir = getAgentDir();
  const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(authStorage, join(agentDir, "models.json"));
  const settingsManager = SettingsManager.create(cwd, agentDir);
  const extensionPaths = [...(profile.extensionPaths ?? []), ...(profile.extensionPackages ?? [])];
  const appendSystemPrompt = normalizeInlineAppendSystemPrompt(profile);
  const model = profile.model ? modelRegistry.find(profile.model.provider, profile.model.id) : undefined;
  if (profile.model && !model) {
    throw new Error(`Model not found for inline profile ${profile.name ?? "inline"}: ${profile.model.provider}/${profile.model.id}`);
  }

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noContextFiles: profile.noContextFiles ?? true,
    noExtensions: true,
    additionalExtensionPaths: extensionPaths,
    noSkills: true,
    additionalSkillPaths: profile.skillPaths ?? [],
    noPromptTemplates: true,
    additionalPromptTemplatePaths: profile.promptPaths ?? [],
    noThemes: true,
    additionalThemePaths: profile.themePaths ?? [],
    systemPrompt: profile.systemPrompt,
    appendSystemPrompt,
  });
  await loader.reload();

  const customTools = [...((profile.customTools ?? []) as ToolDefinition[]), ...((output.customTools ?? []) as ToolDefinition[])];
  const customToolNames = customTools.map((tool) => tool.name).filter(Boolean);
  const tools = unique([...(profile.tools ?? DEFAULT_BUILTIN_TOOLS), ...(output.toolNames ?? []), ...customToolNames]);

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    authStorage,
    modelRegistry,
    settingsManager,
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(cwd),
    tools,
    customTools,
    model,
    thinkingLevel: profile.thinkingLevel,
  });

  return {
    session,
    label: profile.name ?? "inline",
    inline: true,
    profile: {
      name: profile.name ?? "inline",
      dir: agentDir,
      config: {},
      tools,
      extensionPaths,
      appendSystemPrompt,
      disableSystemPromptDiscovery: false,
    } satisfies LoadedProfile,
  };
}

function presetAgent(config: InlineAgentConfig): InlineAgentProfile {
  return inlineProfile(config);
}

function joinInstructions(base: string, instructions: string): string {
  const trimmed = instructions.trim();
  if (!trimmed || trimmed === base) return base;
  return `${base}\n\n${trimmed}`;
}

function normalizeInlineAppendSystemPrompt(profile: InlineAgentProfile): string[] {
  const values: string[] = [];
  if (profile.appendSystemPrompt !== null && profile.appendSystemPrompt !== undefined) {
    if (Array.isArray(profile.appendSystemPrompt)) values.push(...profile.appendSystemPrompt);
    else values.push(profile.appendSystemPrompt);
  }
  if (profile.instructions) values.push(profile.instructions);
  return values;
}

function readProfileConfig(configPath: string): PiProfileConfig {
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as PiProfileConfig;
  } catch (error) {
    throw new Error(`Invalid profile config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveAppendSystemPrompt(dir: string, config: PiProfileConfig): string[] {
  if (config.appendSystemPrompt === null) return [];
  const append = config.appendSystemPrompt ?? "APPEND_SYSTEM.md";
  const appendPath = resolveProfileFile(dir, append);
  if (!existsSync(appendPath)) {
    throw new Error(`appendSystemPrompt file does not exist: ${appendPath}`);
  }
  return [appendPath];
}

function extensionFiles(dir: string): string[] {
  if (!isDirectory(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => join(dir, entry.name))
    .filter((file) => EXTENSIONS.has(file.slice(file.lastIndexOf("."))));
}

function extensionIndexFiles(dir: string): string[] {
  if (!isDirectory(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = join(dir, entry.name);
    for (const ext of EXTENSIONS) {
      const candidate = join(child, `index${ext}`);
      if (existsSync(candidate)) files.push(candidate);
    }
  }
  return files;
}

function resolveProfileFile(profileDir: string, filePath: string): string {
  const expanded = expandHome(filePath);
  return resolve(expanded.startsWith("/") ? expanded : join(profileDir, expanded));
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function asStringArray(value: unknown, label: string, fallback: string[]): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Profile config ${label} must be an array of strings`);
  }
  return [...value];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function validateProfileName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`Invalid profile name: ${name}`);
  }
}
