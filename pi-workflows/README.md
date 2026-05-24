# pi-workflows

Readable TypeScript workflows for Pi SDK profile agents.

A workflow keeps deterministic orchestration in JavaScript and delegates fuzzy work to Pi agents:

```txt
human-readable workflow file
  -> small ergonomic API
  -> stable workflow engine
  -> Pi SDK sessions + JS/shell/HITL gates
```

## Install/run

```sh
cd pi-workflows
npm install
npm run workflow -- examples/smoke.workflow.ts
npm run workflow -- examples/composed-smoke.workflow.ts
npm run workflow -- examples/codebase-question.workflow.ts --json '{"question":"Where is the workflow command registered?"}'
npm run example:fix-tests -- --json '{"maxLoops":2}'
```

CLI options:

```sh
pi-workflow <workflow.ts> [--json '{"key":"value"}'] [--cwd path] [--profile-root path]
```

## Simple API

```ts
import { codeSearchAgent, compact, prompt, readOnlyAgent, workflow } from "pi-workflows";
import { Type } from "typebox";

const Answer = Type.Object({
  answer: Type.String(),
  evidence: Type.Array(Type.Object({ file: Type.String(), reason: Type.String() })),
});

const Validation = Type.Object({
  status: Type.String(),
  finalAnswer: Type.String(),
  concerns: Type.Array(Type.String()),
});

export default workflow("Codebase question", {
  phases: ["search", "validate"],
  // Optional guardrail when desired:
  // budget: { maxCostUsd: 2, maxTokens: 200_000 },
  agents: {
    searcher: codeSearchAgent("Answer with minimum tokens and strongest evidence."),
    validator: readOnlyAgent("Validate evidence and compress the final answer."),
  },

  async run($, { question }: { question: string }) {
    const answer = await $.phase("search", () =>
      $.json("searcher", Answer, prompt`
        Question: ${question}
        Search the codebase and return the shortest complete answer.
      `),
    );

    return $.phase("validate", () =>
      $.structured("validator", Validation, prompt`
        Question: ${question}
        Candidate: ${compact(answer)}
        Validate and return the shortest corrected final answer.
      `),
    );
  },
});
```

Required:
- workflow name
- `phases` with at least one phase
- `run`

Optional:
- `description`
- `agents` for deterministic/no-agent workflows
- `budget`, `concurrency`, `maxIterations`
- `prompt` tag; plain strings are accepted too
- `schema` aliases; TypeBox can be used directly

`$.phase(name, fn?)` only accepts declared phases. Declared phases can be reused in loops/retries. Work outside a phase is allowed and logged as root/unphased workflow work.

## Agents

```ts
agents: {
  existing: profile("test-scout"),
  inline: inlineAgent({ tools: ["read"], instructions: "Be concise." }),
  reader: readOnlyAgent("Read files only."),
  searcher: codeSearchAgent(),
  fixer: editAgent("Make minimal safe edits."),
}
```

Agent names are workflow-local aliases/roles. `$.json("searcher", ...)` resolves through the workflow's `agents` map.

Preset helpers are inline-profile wrappers. Pass options to override tools, model, thinking level, extensions, skills, prompts, themes, system prompts, or context behavior.

## Context methods

```ts
$.phase("name", fn?)
$.run(name, fn)
$.sh(name, command, options?)
$.text(agent, prompt)
$.json(agent, prompt)              // unvalidated JSON
$.json(agent, schema, prompt)      // schema-validated JSON
$.structured(agent, schema, prompt)
$.request(agent, prompt, { output: format.json(Schema) }) // metadata-rich advanced call
$.workflow(childWorkflow, args?, options?)
$.approve(message, options?)
$.confirm(message, options?)
$.ask(message, options?)
$.choose(message, choices, options?)
$.parallel(name, tasks, options?)
$.mapParallel(name, items, worker, options?)
$.pipeline(name, items).stage(...).run()
$.budget
```

`$.request()` returns value plus metadata: raw text, messages, usage, tool calls, stop reason, error message, and profile.

## Human-in-the-loop gates

HITL is explicit workflow code, not hidden agent behavior:

```ts
const approval = await $.phase("approve", () =>
  $.approve("Apply this fix plan?", {
    details: compact(triage),
    default: false,
  }),
);

if (!approval.approved) {
  return { status: "not-approved", reason: approval.reason };
}
```

The runner accepts an injectable `human` provider for tests/CI/UI integrations. The CLI prompts on a TTY. In non-interactive mode it uses provided defaults or fails clearly.

## Workflow composition

Use a child workflow explicitly inside a parent phase:

```ts
const answer = await $.phase("answer-risk-question", () =>
  $.workflow(codebaseQuestion, { question: args.question }),
);
```

Child workflows keep their own declared phases. Parent logs show the child as nested workflow work, not as ad-hoc parent subphases. Child runs inherit `cwd`, `profileRoot`, logger, budget accounting, and human provider by default.

## Parallel and pipeline

```ts
const checks = await $.phase("validate", () =>
  $.parallel("validation", {
    tests: () => $.sh("unit tests", "npm test -- --runInBand"),
    types: () => $.sh("typecheck", "npm run typecheck"),
  }, { concurrency: 2 }),
);
```

```ts
const reviewed = await $.phase("triage", () =>
  $.pipeline("scout then review", failedFiles)
    .stage("scout", (file) => $.json("scout", Finding, `Analyze ${file}`), { concurrency: 4 })
    .stage("review", (finding) => $.text("reviewer", compact(finding)), { concurrency: 2 })
    .run(),
);
```

Safety rule: use parallel/pipeline freely for JS, shell checks, and read-only agents. Avoid multiple edit-capable agents writing to the same worktree in parallel unless they operate on known-disjoint files.

## Programmatic run

```ts
import workflow from "./examples/smoke.workflow.js";
import { run } from "pi-workflows";

const result = await run(workflow, {
  args: {},
  cwd: process.cwd(),
  profileRoot: process.env.PI_AGENTS_HOME,
  budget: { timeoutMs: 60_000 },
  human: fakeHumanProvider,
});
```

## Advanced formats

Common calls should use `$.text()`, `$.json()`, and `$.structured()`. For metadata or custom output control, use `$.request()` with `format.*`:

```ts
const raw = await $.request("scout", prompt, { output: format.json(Finding) });
console.log(raw.value, raw.usage, raw.toolCalls, raw.messages);
```

## Profile config fields used by SDK workflows

Formal `profile("name")` agents read the existing Pi profile layout:

```json
{
  "builtinTools": ["read", "grep", "find", "ls"],
  "extensionTools": [],
  "extensionPackages": [],
  "extraArgs": [],
  "model": { "provider": "anthropic", "id": "claude-sonnet-4-5" },
  "thinkingLevel": "high",
  "systemPrompt": null,
  "appendSystemPrompt": "APPEND_SYSTEM.md"
}
```

Notes:
- `extraArgs` is CLI-only in v1; use explicit `model` and `thinkingLevel` for SDK workflows.
- `systemPrompt: null` disables profile/system prompt discovery.
- `appendSystemPrompt: null` disables appended system prompts.
