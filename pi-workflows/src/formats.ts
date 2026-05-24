import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "typebox";
import { Check, Errors } from "typebox/value";
import type { OutputFormat, OutputRuntime } from "./types.js";

export const STRUCTURED_TOOL_NAME = "workflow_structured_output";

export function text(): OutputFormat<string> {
  return {
    name: "text",
    parse(rawText: string) {
      return rawText;
    },
  };
}

export function json<T = unknown>(): OutputFormat<T>;
export function json<const S extends TSchema>(schema: S): OutputFormat<Static<S>>;
export function json(schema?: TSchema): OutputFormat<unknown> {
  return {
    name: "json",
    augmentPrompt(prompt: string) {
      return `${prompt}\n\nReturn only valid JSON. Do not wrap it in markdown fences or explanatory text.`;
    },
    parse(rawText: string) {
      const parsed = JSON.parse(extractJson(rawText));
      validateSchema(schema, parsed, "JSON output");
      return parsed;
    },
  };
}

export function structured<const S extends TSchema>(schema: S): OutputFormat<Static<S>> {
  const tool = defineTool({
    name: STRUCTURED_TOOL_NAME,
    label: "Workflow Structured Output",
    description: "Return the final workflow output as structured data. Use this as your final action.",
    promptSnippet: "Emit the final workflow result as structured data",
    promptGuidelines: [
      `Use ${STRUCTURED_TOOL_NAME} as your final action when the workflow asks for structured output.`,
      `After calling ${STRUCTURED_TOOL_NAME}, do not emit another assistant message.`,
    ],
    parameters: schema,
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: "Structured workflow output captured." }],
        details: params,
        terminate: true,
      };
    },
  });

  return {
    name: "structured",
    customTools: [tool],
    toolNames: [STRUCTURED_TOOL_NAME],
    augmentPrompt(prompt: string) {
      return `${prompt}\n\nReturn your final answer by calling the ${STRUCTURED_TOOL_NAME} tool. Do not return the final structured data as plain text.`;
    },
    parse(_rawText: string, runtime: OutputRuntime) {
      if (runtime.structuredDetails === undefined) {
        throw new Error(`Structured output was requested, but ${STRUCTURED_TOOL_NAME} was not called.`);
      }
      validateSchema(schema, runtime.structuredDetails, "structured output");
      return runtime.structuredDetails as Static<S>;
    },
  };
}

export const format = {
  text,
  json,
  structured,
};

export function prompt(strings: TemplateStringsArray, ...values: unknown[]): string {
  let rendered = "";
  for (let i = 0; i < strings.length; i++) {
    rendered += strings[i];
    if (i < values.length) rendered += String(values[i]);
  }
  return dedent(rendered);
}

export function compact(value: unknown): string {
  const json = JSON.stringify(stable(value));
  return json === undefined ? String(value) : json;
}

export const schema = {
  object: Type.Object,
  array: Type.Array,
  optional: Type.Optional,
  literal: Type.Literal,
  union: Type.Union,
  string(descriptionOrOptions?: string | Parameters<typeof Type.String>[0]) {
    return Type.String(typeof descriptionOrOptions === "string" ? { description: descriptionOrOptions } : descriptionOrOptions);
  },
  number(descriptionOrOptions?: string | Parameters<typeof Type.Number>[0]) {
    return Type.Number(typeof descriptionOrOptions === "string" ? { description: descriptionOrOptions } : descriptionOrOptions);
  },
  boolean(descriptionOrOptions?: string | Parameters<typeof Type.Boolean>[0]) {
    return Type.Boolean(typeof descriptionOrOptions === "string" ? { description: descriptionOrOptions } : descriptionOrOptions);
  },
};

export function extractJson(rawText: string): string {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;

  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  const starts = [objectStart, arrayStart].filter((n) => n >= 0);
  if (starts.length === 0) return trimmed;

  const start = Math.min(...starts);
  const endChar = trimmed[start] === "{" ? "}" : "]";
  const end = trimmed.lastIndexOf(endChar);
  if (end <= start) return trimmed.slice(start);
  return trimmed.slice(start, end + 1);
}

function validateSchema(schema: TSchema | undefined, value: unknown, label: string): void {
  if (!schema) return;
  if (Check(schema, value)) return;
  const errors = Errors(schema, value)
    .slice(0, 5)
    .map((error) => {
      const path = typeof (error as any).path === "string" ? (error as any).path : "/";
      return `${path}: ${error.message}`;
    })
    .join("; ");
  throw new Error(`Invalid ${label}: ${errors}`);
}

function dedent(value: string): string {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

  const indents = lines.filter((line) => line.trim() !== "").map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const minIndent = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(Math.min(minIndent, line.length))).join("\n");
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;

  const object = value as Record<string, unknown>;
  return Object.keys(object)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = stable(object[key]);
      return result;
    }, {});
}
