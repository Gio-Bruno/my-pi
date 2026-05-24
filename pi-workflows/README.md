# pi-workflows

Reusable deterministic workflow scripts for Pi SDK profile agents.

`pi-workflows` lets a TypeScript workflow use profiles created by the existing `pi create` wrapper. The JavaScript controls deterministic ordering, branching, shell gates, parallelism, and budgets. Pi SDK agents handle fuzzy reasoning or edits inside isolated in-memory sessions.

## Overview

```txt
workflow file
  |
  +-- meta                 name/description/phases/defaults
  +-- profile map          logical role -> `pi create` profile name
  +-- schemas/formats      text/json/structured output contracts
  +-- run($)               deterministic JS orchestration
        |
        +-- $.phaseLog     phase/status logging
        +-- $.run          deterministic JS step
        +-- $.sh           deterministic shell/process step
        +-- $.agent        isolated Pi profile agent call
        +-- $.parallel     Promise.all-style fan-out
        +-- $.mapParallel  list fan-out with concurrency cap
        +-- $.pipeline     staged async queue, next stage starts per item ASAP
        +-- $.budget       token/cost/time guardrails
```

```txt
$.agent("fixer", prompt)
        |
        v
profile key: fixer
        |
        v
profiles.fixer = "test-fixer"
        |
        v
<profile-root>/test-fixer/
  config.json
  APPEND_SYSTEM.md
  tools/
  extensions/
  skills/
  prompts/
        |
        v
Pi SDK createAgentSession({ SessionManager.inMemory(), tools, model, prompts })
        |
        v
formatted result: text/json/structured
```

## Setup

Create profiles with the existing wrapper:

```sh
pi create test-scout --tools read,grep,find,ls
pi create test-fixer --tools read,grep,find,ls,edit,write,bash
pi create test-reviewer --tools read,grep,find,ls,bash
```

Add instructions to each profile's `APPEND_SYSTEM.md`, for example:

```txt
You are a read-only scout. Analyze failures and return concise findings. Do not edit files.
```

Install workflow project dependencies:

```sh
cd pi-workflows
npm install
```

Run an example from the repo root or from `pi-workflows/`:

```sh
cd pi-workflows

# No-LLM smoke test for JS/shell/parallel/pipeline primitives:
npm run workflow -- examples/smoke.workflow.ts

# Real mr-01 SDK agent smoke test:
npm run workflow -- examples/mr-01-agent-smoke.workflow.ts

# Inline-profile codebase Q&A workflow:
npm run workflow -- examples/codebase-question.workflow.ts --json '{"question":"Where is the workflow command registered?"}'

# Fix-tests workflow:
npm run example:fix-tests

# Or pass workflow JSON args:
npm run workflow -- examples/fix-tests.workflow.ts --json '{"maxLoops":2}'
```

From the `mr-01` Pi profile, the profile-local extension adds a slash command:

```txt
/workflow                         # list workflows
/workflow smoke                   # no-LLM smoke test
/workflow mr-01-agent-smoke       # real mr-01 SDK agent smoke test
/workflow codebase-question {"question":"Where is the workflow command registered?"}
/workflow fix-tests {"maxLoops":1}
```

## Workflow API

```txt
WorkflowContext $
  |
  +-- $.phase(name)
  |
  +-- $.phaseLog.start/info/success/warn/error(name?, message)
  |
  +-- $.run(name, jsFn)
  |      deterministic JS step
  |
  +-- $.sh(name, command, options?)
  |      deterministic process step
  |
  +-- $.agent(role, prompt, { output })
  |      Pi SDK profile call -> formatted value
  |
  +-- $.agentRaw(role, prompt, { output })
  |      Pi SDK profile call -> value + metadata
  |
  +-- $.parallel(name, { key: () => step }, { concurrency? })
  |      independent named tasks -> keyed results
  |
  +-- $.mapParallel(name, items, (item) => step, { concurrency? })
  |      independent list tasks -> ordered results
  |
  +-- $.pipeline(name, items)
  |      .stage(stageName, worker, { concurrency? })
  |      .run()
  |      staged queue -> preserves per-item flow, maximizes throughput
  |
  +-- $.budget
         usage/cost/time guardrails from all agent calls
```

## Inline profiles

You can run agent steps without creating a formal `pi create` profile by using `inlineProfile()`:

```ts
import { defineWorkflow, inlineProfile, json } from "pi-workflows";

export default defineWorkflow({
  meta: { name: "inline demo" },
  profiles: {
    searcher: inlineProfile({
      tools: ["read", "grep", "find", "ls"],
      thinkingLevel: "low",
      instructions: "Search the codebase. Do not edit files. Be concise.",
    }),
  },
  async run($, args: { question: string }) {
    return $.agent("searcher", args.question, { output: json() });
  },
});
```

You can also pass an inline profile directly for one-off steps:

```ts
const answer = await $.agent(
  inlineProfile({ tools: ["read", "grep", "find", "ls"], instructions: "Read-only. Be brief." }),
  prompt,
  { output: json() },
);
```

Inline profiles use the default Pi auth/model registry, not a profile-local `auth.json`/`models.json`. Use formal profiles when you want persistent profile resources, extensions, skills, or profile-local settings.

## Minimal workflow

```ts
import { defineWorkflow, json, text } from "pi-workflows";
import { Type } from "typebox";

const TriageSchema = Type.Object({
  failedFiles: Type.Array(Type.String()),
  likelyCause: Type.String(),
});

export default defineWorkflow({
  meta: {
    name: "fix-tests",
    description: "Fix failing tests with deterministic gates.",
    phases: ["test", "triage", "fix"],
  },
  profiles: {
    scout: "test-scout",
    fixer: "test-fixer",
  },
  defaults: {
    maxIterations: 2,
    budget: { maxCostUsd: 3, maxTokens: 300_000 },
  },
  async run($) {
    const test = await $.sh("test", "npm test -- --runInBand");
    if (test.ok) return "already passing";

    const triage = await $.agent("scout", test.output.slice(-40_000), {
      output: json(TriageSchema),
    });

    return $.agent("fixer", JSON.stringify(triage, null, 2), {
      output: text(),
    });
  },
});
```

## Output formats

```ts
const notes = await $.agent("scout", prompt, { output: text() });
const triage = await $.agent("scout", prompt, { output: json(TriageSchema) });
const review = await $.agent("reviewer", prompt, { output: structured(ReviewSchema) });
```

- `text()` returns final assistant text.
- `json(schema?)` asks for JSON text, parses it, and optionally validates it.
- `structured(schema)` registers a temporary terminating SDK tool and returns the tool details. Prefer object-shaped TypeBox schemas.

Use `$.agentRaw()` when you need metadata:

```ts
const raw = await $.agentRaw("scout", prompt, { output: json(TriageSchema) });
console.log(raw.value, raw.usage, raw.toolCalls, raw.messages);
```

## Parallel examples

```ts
const checks = await $.parallel("validation", {
  tests: () => $.sh("unit tests", "npm test -- --runInBand"),
  types: () => $.sh("typecheck", "npm run typecheck"),
  lint: () => $.sh("lint", "npm run lint"),
}, { concurrency: 3 });
```

```ts
const findings = await $.mapParallel(
  "scout failed files",
  failedFiles,
  (file) => $.agent("scout", `Analyze ${file}`, { output: json(FindingSchema) }),
  { concurrency: 4 },
);
```

## Pipeline example

`pipeline()` starts the next stage for each item as soon as that item is ready; it does not wait for the whole previous stage to finish.

```ts
const reviewed = await $.pipeline("scout then review", failedFiles)
  .stage("scout", (file) => $.agent("scout", `Analyze ${file}`, { output: json(FindingSchema) }), {
    concurrency: 4,
  })
  .stage("review", (finding) => $.agent("reviewer", JSON.stringify(finding), { output: structured(ReviewSchema) }), {
    concurrency: 2,
  })
  .run();
```

Safety rule: use parallel/pipeline freely for JS, shell checks, and read-only agents. Avoid multiple edit-capable agents writing to the same worktree in parallel unless they operate on known-disjoint files.

## Profile config fields used by SDK workflows

`pi-workflows` mirrors the wrapper's profile layout and reads:

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
