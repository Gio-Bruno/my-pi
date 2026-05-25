#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { InvocationParseError, parseInvocationTokens, type WorkflowInvocationDescriptor } from "./invocation.js";
import { run } from "./workflow.js";
import type { Workflow } from "./types.js";

interface CliArgs {
  workflowPath?: string;
  json?: unknown;
  invocationTokens: string[];
  cwd?: string;
  profileRoot?: string;
}

interface WorkflowManifest {
  invocation?: WorkflowInvocationDescriptor;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.workflowPath) {
    usage();
    process.exit(1);
  }

  const workflowPath = resolve(args.workflowPath);
  const workflowModule = await import(pathToFileURL(workflowPath).href);
  const workflow = (workflowModule.default ?? workflowModule.workflow) as Workflow | undefined;
  if (!workflow?.run || !workflow.profiles || !workflow.meta) {
    throw new Error(`Workflow module must export default workflow(name, options)`);
  }

  const invocation = loadInvocationDescriptor(workflowPath);
  const workflowArgs = args.json !== undefined ? args.json : parseInvocationTokens(args.invocationTokens, { descriptor: invocation }).args;

  const result = await run(workflow, {
    args: workflowArgs,
    cwd: args.cwd,
    profileRoot: args.profileRoot,
  });

  if (result !== undefined) {
    if (typeof result === "string") console.log(result);
    else console.log(JSON.stringify(result, null, 2));
  }
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { invocationTokens: [] };
  let workflowSeen = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (workflowSeen && arg === "--") {
      parsed.invocationTokens.push(...argv.slice(i));
      break;
    }

    switch (arg) {
      case "-h":
      case "--help":
        usage();
        process.exit(0);
      case "--json":
        parsed.json = JSON.parse(requireValue(argv, ++i, "--json"));
        continue;
      case "--cwd":
        parsed.cwd = requireValue(argv, ++i, "--cwd");
        continue;
      case "--profile-root":
        parsed.profileRoot = requireValue(argv, ++i, "--profile-root");
        continue;
      default:
        if (!workflowSeen) {
          if (arg.startsWith("-")) throw new Error(`Unknown option before workflow path: ${arg}`);
          parsed.workflowPath = arg;
          workflowSeen = true;
        } else {
          parsed.invocationTokens.push(arg);
        }
    }
  }

  return parsed;
}

function loadInvocationDescriptor(workflowPath: string): WorkflowInvocationDescriptor | undefined {
  const manifestPath = manifestPathForWorkflow(workflowPath);
  if (!manifestPath || !existsSync(manifestPath)) return undefined;

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as WorkflowManifest;
    return manifest.invocation;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new InvocationParseError(`Invalid workflow manifest ${manifestPath}: ${message}`);
  }
}

function manifestPathForWorkflow(workflowPath: string): string | undefined {
  const file = basename(workflowPath);
  if (!file.endsWith(".workflow.ts") && !file.endsWith(".workflow.js")) return undefined;
  const stem = file.replace(/\.workflow\.[tj]s$/, "");
  return join(dirname(workflowPath), stem, "manifest.json");
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function usage() {
  console.log(`Usage:
  pi-workflow <workflow.ts> [inline input and flags] [--json '{"key":"value"}'] [--cwd path] [--profile-root path]

Examples:
  npm run workflow -- examples/fix-tests.workflow.ts
  npm run workflow -- examples/fix-tests.workflow.ts --json '{"maxLoops":2}'
  npm run workflow -- workflows/brainstorming.workflow.ts Design a cleaner workflow invocation UX --max-questions 3 --skip-commit
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
