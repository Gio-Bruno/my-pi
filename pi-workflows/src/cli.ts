#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { run } from "./workflow.js";
import type { Workflow } from "./types.js";

interface CliArgs {
  workflowPath?: string;
  json?: unknown;
  cwd?: string;
  profileRoot?: string;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.workflowPath) {
    usage();
    process.exit(1);
  }

  const workflowModule = await import(pathToFileURL(resolve(args.workflowPath)).href);
  const workflow = (workflowModule.default ?? workflowModule.workflow) as Workflow | undefined;
  if (!workflow?.run || !workflow.profiles || !workflow.meta) {
    throw new Error(`Workflow module must export default workflow(name, options)`);
  }

  const result = await run(workflow, {
    args: args.json,
    cwd: args.cwd,
    profileRoot: args.profileRoot,
  });

  if (result !== undefined) {
    if (typeof result === "string") console.log(result);
    else console.log(JSON.stringify(result, null, 2));
  }
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        usage();
        process.exit(0);
      case "--json":
        parsed.json = JSON.parse(requireValue(argv, ++i, "--json"));
        break;
      case "--cwd":
        parsed.cwd = requireValue(argv, ++i, "--cwd");
        break;
      case "--profile-root":
        parsed.profileRoot = requireValue(argv, ++i, "--profile-root");
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
        if (parsed.workflowPath) throw new Error(`Unexpected extra argument: ${arg}`);
        parsed.workflowPath = arg;
        break;
    }
  }
  return parsed;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function usage() {
  console.log(`Usage:
  pi-workflow <workflow.ts> [--json '{"key":"value"}'] [--cwd path] [--profile-root path]

Examples:
  npm run workflow -- examples/fix-tests.workflow.ts
  npm run workflow -- examples/fix-tests.workflow.ts --json '{"maxLoops":2}'
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
