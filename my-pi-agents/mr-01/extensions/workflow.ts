import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { InvocationParseError, tokenizeInvocation } from "../../../pi-workflows/src/invocation.js";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(extensionDir, "..", "..", "..");
const workflowsDir = join(repoRoot, "pi-workflows");
const examplesDir = join(workflowsDir, "examples");
const generatedDir = join(workflowsDir, "workflows");

interface WorkflowMatch {
  kind: "path" | "example" | "generated";
  path: string;
}

export default function workflowCommand(pi: ExtensionAPI) {
  pi.registerCommand("workflow", {
    description: "Run a pi-workflows workflow file, example, or generated workflow",
    handler: async (args, ctx) => {
      const parsed = parseWorkflowArgs(args);

      if (parsed.error) {
        pi.sendMessage({
          customType: "workflow",
          display: true,
          content: `${parsed.error}\n\n${workflowHelp()}`,
        });
        return;
      }

      if (!parsed.workflow) {
        pi.sendMessage({
          customType: "workflow",
          display: true,
          content: workflowHelp(),
        });
        return;
      }

      const resolved = resolveWorkflowPath(parsed.workflow);
      if (resolved.error || !resolved.match) {
        pi.sendMessage({
          customType: "workflow",
          display: true,
          content: `${resolved.error ?? `Unknown workflow: ${parsed.workflow}`}\n\n${workflowHelp()}`,
        });
        return;
      }

      const workflowPath = resolved.match.path;
      ctx.ui.setStatus("workflow", `workflow:${parsed.workflow}`);
      ctx.ui.notify(`Running workflow: ${parsed.workflow}`, "info");

      try {
        const cliArgs = ["run", "workflow", "--", workflowPath];
        cliArgs.push(...parsed.invocationArgs);

        const result = await pi.exec("npm", cliArgs, {
          cwd: workflowsDir,
          timeout: 30 * 60 * 1000,
        });

        const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
        const content = [
          `Workflow: ${parsed.workflow}`,
          `Kind: ${resolved.match.kind}`,
          `Exit code: ${result.code}`,
          "",
          truncate(output || "(no output)", 20_000),
        ].join("\n");

        pi.sendMessage({
          customType: "workflow",
          display: true,
          content,
          details: {
            workflow: parsed.workflow,
            workflowPath,
            kind: resolved.match.kind,
            code: result.code,
            killed: result.killed,
          },
        });

        ctx.ui.notify(result.code === 0 ? "Workflow completed" : `Workflow failed: ${result.code}`, result.code === 0 ? "info" : "error");
      } finally {
        ctx.ui.setStatus("workflow", undefined);
      }
    },
  });
}

function parseWorkflowArgs(args: string): { workflow?: string; invocationArgs: string[]; error?: string } {
  const trimmed = args.trim();
  if (!trimmed) return { invocationArgs: [] };

  const workflowMatch = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const workflow = workflowMatch?.[1];
  const rest = workflowMatch?.[2]?.trim() ?? "";
  if (!workflow) return { invocationArgs: [] };
  if (!rest) return { workflow, invocationArgs: [] };

  try {
    if (rest.startsWith("--json")) {
      const json = rest.replace(/^--json(?:\s+|=)?/, "").trim();
      if (!json) return { workflow, invocationArgs: [], error: "--json requires a JSON value." };
      return { workflow, invocationArgs: ["--json", stripOuterQuotes(json)] };
    }

    if (rest.startsWith("{") || rest.startsWith("[")) {
      return { workflow, invocationArgs: ["--json", rest] };
    }

    return { workflow, invocationArgs: tokenizeInvocation(rest) };
  } catch (error) {
    const message = error instanceof InvocationParseError || error instanceof Error ? error.message : String(error);
    return { workflow, invocationArgs: [], error: message };
  }
}

function stripOuterQuotes(value: string): string {
  const quote = value[0];
  if ((quote === "'" || quote === '"') && value[value.length - 1] === quote) {
    return value.slice(1, -1);
  }
  return value;
}

function resolveWorkflowPath(nameOrPath: string): { match?: WorkflowMatch; error?: string } {
  const expanded = nameOrPath.endsWith(".ts") ? nameOrPath : `${nameOrPath}.workflow.ts`;
  const direct = resolve(repoRoot, expanded);
  if (existsSync(direct)) return { match: { kind: "path", path: direct } };

  if (nameOrPath.includes("/") || nameOrPath.includes("\\")) {
    return { error: `Unknown workflow path: ${nameOrPath}` };
  }

  const stem = nameOrPath.replace(/\.workflow\.ts$/, "");
  const candidates: WorkflowMatch[] = [];

  const example = join(examplesDir, `${stem}.workflow.ts`);
  if (existsSync(example)) candidates.push({ kind: "example", path: example });

  const generated = join(generatedDir, `${stem}.workflow.ts`);
  if (existsSync(generated)) candidates.push({ kind: "generated", path: generated });

  if (candidates.length === 1) return { match: candidates[0] };
  if (candidates.length > 1) {
    return {
      error: `Ambiguous workflow "${nameOrPath}" exists as both an example and generated workflow. Use an explicit path such as examples/${stem}.workflow.ts or workflows/${stem}.workflow.ts.`,
    };
  }

  return { error: `Unknown workflow: ${nameOrPath}` };
}

function listWorkflowStems(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".workflow.ts"))
    .map((file) => file.replace(/\.workflow\.ts$/, ""))
    .sort();
}

function workflowHelp(): string {
  const examples = listWorkflowStems(examplesDir);
  const generated = listWorkflowStems(generatedDir);
  return [
    "# /workflow",
    "",
    "Run a pi-workflows workflow from the mr-01 profile.",
    "",
    "Usage:",
    "  /workflow                         # list workflows",
    "  /workflow smoke                   # no-LLM smoke test",
    "  /workflow brainstorming Design a clearer workflow UX --max-questions 3 --skip-commit",
    "  /workflow codebase-question {\"question\":\"Where is the workflow command registered?\"}",
    "  /workflow <generated-slug> {\"key\":\"value\"}",
    "  /workflow path/to/custom.workflow.ts --json {\"key\":\"value\"}",
    "",
    "Inline args:",
    "  Free text becomes the workflow's primary input when metadata is available, or input otherwise.",
    "  Metadata-aware workflows can use flags such as --name value, --name=value, --bool, and --no-bool.",
    "  Use -- before literal text that starts with --.",
    "",
    "Available example workflows:",
    ...(examples.length ? examples.map((name) => `  - ${name}`) : ["  (none found)"]),
    "",
    "Available generated workflows:",
    ...(generated.length ? generated.map((name) => `  - ${name}`) : ["  (none found)"]),
    "",
    `Workflow project: ${workflowsDir}`,
  ].join("\n");
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[workflow output truncated: ${text.length - maxChars} chars omitted]`;
}
