import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
        if (parsed.json) cliArgs.push("--json", parsed.json);

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

function parseWorkflowArgs(args: string): { workflow?: string; json?: string } {
  const trimmed = args.trim();
  if (!trimmed) return {};

  const [workflow, ...restParts] = trimmed.split(/\s+/);
  const rest = trimmed.slice(workflow.length).trim();

  if (!rest) return { workflow };
  if (rest.startsWith("--json")) return { workflow, json: rest.replace(/^--json\s*/, "").trim() };
  if (rest.startsWith("{") || rest.startsWith("[")) return { workflow, json: rest };

  return { workflow, json: JSON.stringify({ input: restParts.join(" ") }) };
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
    "  /workflow codebase-question {\"question\":\"Where is the workflow command registered?\"}",
    "  /workflow <generated-slug> {\"key\":\"value\"}",
    "  /workflow path/to/custom.workflow.ts --json {\"key\":\"value\"}",
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
