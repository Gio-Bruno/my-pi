import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";
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
