export type InvocationValueType = "string" | "number" | "boolean" | "path" | "text";

export interface WorkflowInvocationPrimary {
  field: string;
  aliases?: string[];
  required?: boolean;
  description?: string;
  prompt?: string;
}

export interface WorkflowInvocationOption {
  flag?: string;
  aliases?: string[];
  type?: InvocationValueType;
  required?: boolean;
  default?: unknown;
  description?: string;
  prompt?: string;
}

export interface WorkflowInvocationDescriptor {
  primary?: WorkflowInvocationPrimary;
  options?: Record<string, WorkflowInvocationOption>;
  examples?: string[];
}

export interface ParseInvocationOptions {
  descriptor?: WorkflowInvocationDescriptor;
  fallbackPrimaryField?: string;
}

export interface ParsedInvocation {
  mode: "empty" | "json" | "inline";
  args: unknown;
}

interface OptionBinding {
  field: string;
  option: WorkflowInvocationOption;
}

export class InvocationParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvocationParseError";
  }
}

export function parseInvocationText(input: string, options: ParseInvocationOptions = {}): ParsedInvocation {
  const trimmed = input.trim();
  if (!trimmed) return { mode: "empty", args: {} };

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { mode: "json", args: parseJson(trimmed) };
  }

  const tokens = tokenizeInvocation(trimmed);
  return parseInvocationTokens(tokens, options);
}

export function parseInvocationTokens(tokens: readonly string[], options: ParseInvocationOptions = {}): ParsedInvocation {
  if (tokens.length === 0) return { mode: "empty", args: {} };

  if (tokens[0] === "--json") {
    if (tokens.length < 2) throw new InvocationParseError("--json requires a JSON value.");
    return { mode: "json", args: parseJson(tokens.slice(1).join(" ")) };
  }

  const joined = tokens.join(" ").trim();
  if (joined.startsWith("{") || joined.startsWith("[")) {
    return { mode: "json", args: parseJson(joined) };
  }

  return { mode: "inline", args: parseInlineTokens(tokens, options) };
}

export function tokenizeInvocation(input: string): string[] {
  if (input.includes("<<")) return tokenizeInvocationWithHeredocs(input);
  return tokenizeInvocationLine(input);
}

function tokenizeInvocationWithHeredocs(input: string): string[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const tokens: string[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineTokens = tokenizeInvocationLine(lines[lineIndex]);

    for (const token of lineTokens) {
      const marker = heredocMarker(token);
      if (!marker) {
        tokens.push(token);
        continue;
      }

      const body: string[] = [];
      let foundTerminator = false;
      for (lineIndex += 1; lineIndex < lines.length; lineIndex += 1) {
        if (lines[lineIndex] === marker) {
          foundTerminator = true;
          break;
        }
        body.push(lines[lineIndex]);
      }

      if (!foundTerminator) throw new InvocationParseError(`Missing heredoc terminator: ${marker}`);
      tokens.push(body.join("\n"));
    }
  }

  return tokens;
}

function tokenizeInvocationLine(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let tokenStarted = false;

  const push = () => {
    if (!tokenStarted) return;
    tokens.push(current);
    current = "";
    tokenStarted = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (quote) {
      if (char === quote) {
        quote = undefined;
        tokenStarted = true;
        continue;
      }

      if (char === "\\" && quote === '"' && index + 1 < input.length) {
        current += input[++index];
        tokenStarted = true;
        continue;
      }

      current += char;
      tokenStarted = true;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      tokenStarted = true;
      continue;
    }

    if (char === "\\" && index + 1 < input.length) {
      current += input[++index];
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      push();
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  if (quote) throw new InvocationParseError(`Unclosed ${quote === "'" ? "single" : "double"} quote in workflow invocation.`);
  push();
  return tokens;
}

function parseInlineTokens(tokens: readonly string[], options: ParseInvocationOptions): Record<string, unknown> {
  const descriptor = options.descriptor;
  const fallbackPrimaryField = options.fallbackPrimaryField ?? "input";

  if (!descriptor) {
    const primaryTokens = tokens[0] === "--" ? tokens.slice(1) : tokens;
    return primaryTokens.length > 0 ? { [fallbackPrimaryField]: primaryTokens.join(" ") } : {};
  }

  const primaryField = descriptor.primary?.field || fallbackPrimaryField;
  const lookup = buildOptionLookup(descriptor.options ?? {});
  const args: Record<string, unknown> = {};
  const primaryParts: string[] = [];
  let parseOptions = true;

  for (const [field, option] of Object.entries(descriptor.options ?? {})) {
    if (option.default !== undefined) args[field] = option.default;
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (parseOptions && token === "--") {
      parseOptions = false;
      continue;
    }

    if (parseOptions && isLongFlag(token)) {
      const parsed = parseFlagToken(token);
      const binding = lookup.get(normalizeFlagName(parsed.name));

      if (!binding) {
        throw new InvocationParseError(`Unknown workflow option --${parsed.name}. Use -- before literal text that starts with --.`);
      }

      const type = binding.option.type ?? "string";
      if (parsed.negated && type !== "boolean") {
        throw new InvocationParseError(`--no-${parsed.name} can only be used with boolean workflow options.`);
      }

      if (type === "boolean") {
        if (parsed.value !== undefined) {
          args[binding.field] = coerceValue(parsed.value, type, parsed.name);
        } else if (parsed.negated) {
          args[binding.field] = false;
        } else if (tokens[index + 1] !== undefined && isBooleanLiteral(tokens[index + 1])) {
          args[binding.field] = coerceValue(tokens[++index], type, parsed.name);
        } else {
          args[binding.field] = true;
        }
        continue;
      }

      const value = parsed.value ?? tokens[index + 1];
      if (value === undefined || (parsed.value === undefined && isLongFlag(value))) {
        throw new InvocationParseError(`Workflow option --${parsed.name} requires a ${type} value.`);
      }

      if (parsed.value === undefined) index += 1;
      args[binding.field] = coerceValue(value, type, parsed.name);
      continue;
    }

    primaryParts.push(token);
  }

  if (primaryParts.length > 0) {
    args[primaryField] = primaryParts.join(" ");
  }

  validateRequired(descriptor, args, primaryField);
  return args;
}

function heredocMarker(token: string): string | undefined {
  if (!token.startsWith("<<")) return undefined;
  const marker = token.slice(2).trim();
  if (!marker) throw new InvocationParseError("Heredoc marker cannot be empty.");
  if (/\s/.test(marker)) throw new InvocationParseError(`Invalid heredoc marker: ${marker}`);
  return marker;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new InvocationParseError(`Invalid workflow JSON arguments: ${message}`);
  }
}

function buildOptionLookup(options: Record<string, WorkflowInvocationOption>): Map<string, OptionBinding> {
  const lookup = new Map<string, OptionBinding>();

  for (const [field, option] of Object.entries(options)) {
    const names = [option.flag ?? camelToKebab(field), ...(option.aliases ?? [])];
    for (const name of names) {
      const normalized = normalizeFlagName(name);
      const existing = lookup.get(normalized);
      if (existing && existing.field !== field) {
        throw new InvocationParseError(`Invalid workflow invocation metadata: option --${normalized} maps to both ${existing.field} and ${field}.`);
      }
      lookup.set(normalized, { field, option });
    }
  }

  return lookup;
}

function validateRequired(descriptor: WorkflowInvocationDescriptor, args: Record<string, unknown>, primaryField: string): void {
  if (descriptor.primary?.required && isMissing(args[primaryField])) {
    throw new InvocationParseError(`Missing required workflow input: ${primaryField}.`);
  }

  for (const [field, option] of Object.entries(descriptor.options ?? {})) {
    if (option.required && isMissing(args[field])) {
      throw new InvocationParseError(`Missing required workflow option: --${option.flag ?? camelToKebab(field)}.`);
    }
  }
}

function coerceValue(value: string, type: InvocationValueType, flagName: string): unknown {
  switch (type) {
    case "boolean":
      return coerceBoolean(value, flagName);
    case "number": {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) throw new InvocationParseError(`Workflow option --${flagName} expects a number.`);
      return numeric;
    }
    case "string":
    case "path":
    case "text":
      return value;
    default:
      throw new InvocationParseError(`Unsupported workflow option type for --${flagName}: ${String(type)}`);
  }
}

function coerceBoolean(value: string, flagName: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) return true;
  if (["false", "no", "0"].includes(normalized)) return false;
  throw new InvocationParseError(`Workflow option --${flagName} expects a boolean value: true, false, yes, no, 1, or 0.`);
}

function isBooleanLiteral(value: string): boolean {
  return ["true", "false", "yes", "no", "1", "0"].includes(value.trim().toLowerCase());
}

function isLongFlag(value: string): boolean {
  return /^--[^-\s].*/.test(value) && value !== "--";
}

function parseFlagToken(token: string): { name: string; value?: string; negated: boolean } {
  const body = token.slice(2);
  const equals = body.indexOf("=");
  const rawName = equals >= 0 ? body.slice(0, equals) : body;
  const value = equals >= 0 ? body.slice(equals + 1) : undefined;
  const negated = rawName.startsWith("no-");
  const name = negated ? rawName.slice(3) : rawName;

  if (!name) throw new InvocationParseError(`Invalid workflow option: ${token}`);
  return { name, value, negated };
}

function normalizeFlagName(value: string): string {
  return value.replace(/^--?/, "").trim().replace(/_/g, "-").toLowerCase();
}

function camelToKebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/_/g, "-").toLowerCase();
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}
