# Pi SDK Workflow Scripts Plan

## Context

We want deterministic, scriptable workflows that use Pi SDK agents created with the existing `pi create` profile wrapper. The workflow should look closer to a `workflow.js` file than a one-off script: small readable steps, named agent profiles, deterministic JS/shell gates, and isolated SDK sessions per agent run.

Current repo findings:
- `custom-pi-agents/bin/pi` owns profile creation/running and already maps `config.json`, profile resource folders, `APPEND_SYSTEM.md`, `auth.json`, and `models.json` into an isolated Pi CLI invocation.
- Profile config already supports `builtinTools`, `extensionTools`, `extensionPackages`, `extraArgs`, `systemPrompt`, and `appendSystemPrompt`.
- `my-pi-agents/` is the portable profile root; `pi agent-path` / `PI_AGENTS_HOME` choose the active root.
- There is no root TypeScript project/package yet; scripts currently are shell-only under `scripts/`.
- User preference: make this mostly reusable, in its own sub-folder project, with configurable agent output formats such as text, JSON, and stronger structured outputs.

## Approach

Create a reusable TypeScript sub-project named `pi-workflows/` that exports a small SDK workflow kit and ships example workflows. Keep it independent from the repo root: its own `package.json`, `tsconfig.json`, dependencies, and npm scripts.

The goal is a Claude-workflow-like authoring model, adapted to Pi profiles and the Pi SDK:

```txt
workflow file
  |
  +-- meta                 name/description/phases/defaults
  +-- profile map          logical role -> `pi create` profile name or inlineProfile(config)
  +-- schemas/formats      text/json/structured output contracts
  +-- run($)               deterministic JS orchestration
        |
        +-- $.phaseLog     phase/status logging
        +-- $.run          deterministic JS step
        +-- $.sh           deterministic shell/process step
        +-- $.agent        isolated Pi profile or inline-config agent call
        +-- $.parallel     Promise.all-style fan-out
        +-- $.mapParallel  list fan-out with concurrency cap
        +-- $.pipeline     staged async queue, stage N starts per item ASAP
        +-- $.budget       token/cost/time guardrails
```

```txt
pi-workflows/
  src/
    index.ts          # public API
    workflow.ts       # defineWorkflow/runWorkflow/context
    profiles.ts       # load existing `pi create` profiles
    formats.ts        # text/json/structured output helpers
    parallel.ts       # parallel/mapParallel helpers
    pipeline.ts       # staged queue primitive
    budget.ts         # budget + usage aggregation
    logging.ts        # phaseLog/event sink
    cli.ts            # optional runner for workflow files
  examples/
    fix-tests.workflow.ts
```

The workflow API should stay close to the Claude-style `workflow.js` idea, but use normal TypeScript functions for deterministic steps:

```txt
workflow.ts
  -> metadata and phases
  -> deterministic JS steps: $.run(name, fn)
  -> deterministic shell steps: $.sh(name, command)
  -> Pi profile agent steps: $.agent("role", prompt, { output })
  -> orchestration primitives: $.parallel(), $.mapParallel(), $.pipeline()
```

The helper will load existing `pi create` profiles directly from the profile root, mirror the wrapper's isolation rules, and create an in-memory SDK `AgentSession` for each agent call.

Agent outputs should be configurable by format and schema, similar to Claude workflow schema enforcement:

```ts
const notes = await $.agent("scout", prompt, { output: text() });
const triage = await $.agent("scout", prompt, { output: json(TriageSchema) });
const review = await $.agent("reviewer", prompt, { output: structured(ReviewSchema) });
```

A workflow authoring example should look like:

```ts
import { defineWorkflow, json, structured, text } from "pi-workflows";
import { Type } from "typebox";

const TriageSchema = Type.Object({
  failedFiles: Type.Array(Type.String()),
  likelyCause: Type.String(),
});

const ReviewSchema = Type.Object({
  status: Type.Union([Type.Literal("PASS"), Type.Literal("CONCERN")]),
  notes: Type.Array(Type.String()),
});

export default defineWorkflow({
  meta: {
    name: "Fix failing tests",
    description: "Scout, fix, validate, and review test failures.",
    phases: ["test", "triage", "fix", "validate", "review"],
  },
  profiles: {
    scout: "test-scout",
    fixer: "test-fixer",
    reviewer: "test-reviewer",
  },
  defaults: {
    maxIterations: 2,
    budget: { maxCostUsd: 3, maxTokens: 300_000 },
  },
  async run($, args) {
    for (let loop = 1; loop <= $.defaults.maxIterations; loop++) {
      $.phaseLog.start("test", `Run ${loop}`);
      const test = await $.sh("unit tests", "npm test -- --runInBand");
      if (test.ok) break;

      const triage = await $.agent("scout", makeTriagePrompt(test), { output: json(TriageSchema) });
      await $.agent("fixer", makeFixPrompt(triage), { output: text() });
      $.budget.throwIfExceeded();
    }

    const checks = await $.parallel("validation", {
      tests: () => $.sh("unit tests", "npm test -- --runInBand"),
      types: () => $.sh("typecheck", "npm run typecheck"),
    });

    const diff = await $.sh("diff", "git diff");
    return $.agent("reviewer", diff.output, { output: structured(ReviewSchema) });
  },
});
```

V1 implementation scope:
- `meta`, `profiles`, `defaults`, and `run($, args)` workflow structure.
- `text()` returns final assistant text.
- `json(schema?)` asks for JSON text and parses/validates it; useful for simple machine-readable outputs.
- `structured(schema)` registers a temporary terminating SDK custom tool for that agent session and returns the tool `details`; useful when we need stronger schema-shaped output than plain text.
- `$.agent()` returns the derived value by default.
- `$.agentRaw()` exposes `{ value, rawText, messages, usage, toolCalls, stopReason }` without making simple workflows noisy.
- `$.parallel()` runs independent named tasks concurrently and returns a keyed object.
- `$.mapParallel()` runs the same deterministic/agent step across a list with a concurrency cap.
- `$.pipeline()` is included in v1 as a basic staged async queue with per-stage concurrency caps.
- `$.phaseLog` and `$.budget` are included in v1 with a console/event-sink implementation.

## Proposed API shape

```txt
defineWorkflow({...})
        |
        v
runWorkflow(workflow, options?)
        |
        v
WorkflowContext $
  |
  +-- $.phase(name)
  |
  +-- $.phaseLog.start/info/success/warn/error(name?, message)
  |      Claude-like phase/status logging
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

Minimal workflow shape:

```ts
const workflow = defineWorkflow({
  meta: {
    name: "fix-tests",
    description: "Fix failing tests with deterministic validation gates.",
    phases: ["test", "triage", "fix"],
  },
  profiles: {
    scout: "test-scout",
    fixer: "test-fixer",
    reviewer: "test-reviewer",
  },
  async run($) {
    const test = await $.sh("test", "npm test -- --runInBand");
    const parsed = await $.run("parse failures", () => parseFailures(test.output));
    const triage = await $.agent("scout", makeScoutPrompt(parsed), { output: json(TriageSchema) });
    await $.agent("fixer", makeFixPrompt(triage), { output: text() });
  },
});
```

Parallel examples:

```ts
// Named parallel tasks: good for independent checks/recon.
const checks = await $.parallel("validation", {
  tests: () => $.sh("unit tests", "npm test -- --runInBand"),
  types: () => $.sh("typecheck", "npm run typecheck"),
  lint: () => $.sh("lint", "npm run lint"),
}, { concurrency: 3 });

// Parallel read-only agents: good for decomposed scouting.
const findings = await $.parallel("scout domains", {
  auth: () => $.agent("scout", "Find auth-related failures", { output: json(FindingSchema) }),
  api: () => $.agent("scout", "Find API-related failures", { output: json(FindingSchema) }),
  ui: () => $.agent("scout", "Find UI-related failures", { output: json(FindingSchema) }),
}, { concurrency: 3 });

// Map parallel: good for many independent files/items.
const fileFindings = await $.mapParallel(
  "scout failed files",
  failedFiles,
  (file) => $.agent("scout", `Analyze ${file}`, { output: json(FindingSchema) }),
  { concurrency: 4 },
);

// Pipeline: stage 2 starts on each item as soon as its stage 1 result is ready.
const reviewed = await $.pipeline("scout then review", failedFiles)
  .stage("scout", (file) => $.agent("scout", `Analyze ${file}`, { output: json(FindingSchema) }), {
    concurrency: 4,
  })
  .stage("review", (finding) => $.agent("reviewer", JSON.stringify(finding), { output: structured(ReviewSchema) }), {
    concurrency: 2,
  })
  .run();
```

Parallel safety rule for v1: use parallel/pipeline freely for JS, shell checks, and read-only agents. Avoid multiple edit-capable agents writing to the same worktree in parallel unless they operate on known-disjoint files or a future worktree isolation mode is added.

Profile config mapping for SDK v1:
- Use `builtinTools`, tool filenames, `extensionTools`, and `extensionPackages` for tool/resource loading.
- Add/read explicit SDK-friendly fields: `model: { provider, id }` and `thinkingLevel`.
- Treat `extraArgs` as CLI-only in SDK v1; do not try to parse arbitrary CLI flags into SDK options.

First real workflow example: `fix-tests.workflow.ts`.

```txt
npm test
  -> JS parses/shapes failure output
  -> scout profile analyzes cause, returns JSON triage
  -> fixer profile edits, returns text summary
  -> npm test again
  -> reviewer profile reviews diff, returns structured PASS/CONCERN
```

## Files to modify

Likely files:
- `pi-workflows/package.json` — standalone reusable sub-project with local npm scripts and dependencies (`@earendil-works/pi-coding-agent`, `typebox`; dev runner such as `tsx`).
- `pi-workflows/tsconfig.json` — TS config for the workflow kit.
- `pi-workflows/src/index.ts` — public exports.
- `pi-workflows/src/workflow.ts` — `defineWorkflow`, `runWorkflow`, `WorkflowContext`, `$.run`, `$.sh`, `$.agent`, `$.agentRaw`.
- `pi-workflows/src/profiles.ts` — load existing wrapper profiles and mirror CLI isolation in SDK `DefaultResourceLoader`.
- `pi-workflows/src/formats.ts` — `text()`, `json()`, and `structured()` output format helpers.
- `pi-workflows/src/parallel.ts` — concurrency-limited `parallel` and `mapParallel` primitives.
- `pi-workflows/src/pipeline.ts` — staged async queue primitive.
- `pi-workflows/src/budget.ts` — aggregate usage/cost/time budget tracking.
- `pi-workflows/src/logging.ts` — phase logging and event sink abstraction.
- `pi-workflows/src/cli.ts` — v1 workflow file runner (`pi-workflow path/to/workflow.ts --json '{...}'`).
- `pi-workflows/examples/fix-tests.workflow.ts` — starter deterministic workflow example.
- `pi-workflows/examples/codebase-question.workflow.ts` — inline-profile codebase Q&A example.
- `pi-workflows/README.md` — reusable workflow kit docs, ASCII overview, and examples.
- `custom-pi-agents/README.md` — link to workflow usage and document that profiles are SDK-compatible.
- `my-pi-agents/README.md` — mention profiles can be used by both CLI wrapper and SDK workflows.
- `custom-pi-agents/bin/pi` — optional: add explicit config fields to created profiles (`model`, `thinkingLevel`) if we want better SDK ergonomics.
- `custom-pi-agents/tests/pi-wrapper.test.sh` — optional: update only if `pi create` config shape changes.

## Reuse

Existing code/patterns to reuse:
- Profile root resolution from `custom-pi-agents/bin/pi`: `PI_AGENTS_HOME`, stored `agent-path`, fallback `~/.pi-agents`.
- Profile config semantics from `custom-pi-agents/bin/pi`: `builtinTools`, `extensionTools`, `extensionPackages`, `extraArgs`, `systemPrompt`, `appendSystemPrompt`.
- Profile-local resources already defined by the wrapper: `tools/`, `extensions/`, `skills/`, `prompts/`, `themes/`, `APPEND_SYSTEM.md`.
- Wrapper tests in `custom-pi-agents/tests/pi-wrapper.test.sh` show expected isolation flags and profile layout.
- Pi SDK APIs from docs/examples:
  - `createAgentSession()`
  - `DefaultResourceLoader`
  - `SessionManager.inMemory()`
  - `AuthStorage.create(profile/auth.json)`
  - `ModelRegistry.create(auth, profile/models.json)`
  - `SettingsManager.create(cwd, profileDir)`
  - `defineTool()` + `terminate: true` pattern from `examples/extensions/structured-output.ts` for stronger structured outputs.

## Steps

- [x] Create standalone `pi-workflows/` TypeScript project.
- [x] Define public workflow interfaces: `Workflow`, `WorkflowMeta`, `WorkflowContext`, `ProfileMap`, `ShellResult`, `AgentResult`, `OutputFormat<T>`, `WorkflowBudget`.
- [x] Implement readable primitives: `defineWorkflow`, `runWorkflow`, `$.phase`, `$.phaseLog`, `$.run`, `$.sh`, `$.agent`, `$.agentRaw`.
- [x] Implement parallel primitives: `$.parallel` for named tasks and `$.mapParallel` for item lists, both with optional concurrency limits.
- [x] Implement v1 `$.pipeline` as a basic staged async queue with per-stage concurrency caps.
- [x] Implement output helpers: `text()`, `json(schema?)`, `structured(schema)`.
- [x] Implement workflow CLI runner for loading a workflow module, parsing args, executing it, and printing/logging the final result.
- [x] Implement profile loading from existing profile dirs, including tool files, extension dirs, and `extensionPackages`.
- [x] Mirror wrapper isolation in SDK `DefaultResourceLoader` options.
- [x] Track agent usage from SDK events and expose v1 aggregate `$.budget` guardrails (`maxCostUsd`, `maxTokens`, optional wall-clock timeout).
- [x] Support optional structured profile config fields for SDK: `model`, `thinkingLevel`; keep `extraArgs` as CLI-only in SDK v1.
- [x] Add `examples/fix-tests.workflow.ts` as the starter example, including a parallel validation block and a read-only pipeline example.
- [x] Add `examples/codebase-question.workflow.ts` as an inline-profile workflow that searches the codebase, compresses the answer, validates it, and returns a short final response.
- [x] Add `pi-workflows/README.md` with ASCII architecture, profile setup commands, run command, output format examples, parallel examples, and pipeline examples.
- [x] Update `custom-pi-agents/README.md` and `my-pi-agents/README.md` to mention SDK workflow compatibility.
- [ ] Add deeper tests for profile root/config parsing, output format parsing, parallel ordering, pipeline ordering, and budget checks.

## Verification

Manual verification:
- Create three profiles with `pi create`: scout, fixer, reviewer.
- Add simple instructions to each profile's `APPEND_SYSTEM.md`.
- Run the workflow script from a sample JS/TS project with a failing test.
- Confirm each agent call uses the intended profile tools/resources and does not leak global/project resources.
- Confirm loop stops on passing tests or max loops.
- Confirm a parallel read-only scout example runs independent agent calls and returns keyed/ordered results.
- Confirm parallel shell checks preserve deterministic pass/fail results and do not hide individual failures.

Automated/light verification:
- Add a dry-run or mock mode for `workflow-kit.ts` profile loading if we want tests without live LLM calls.
- Run existing wrapper tests: `custom-pi-agents/tests/pi-wrapper.test.sh`.
- Run formatting/typecheck inside `pi-workflows/`.

## Decisions

- Sub-project name: `pi-workflows/`.
- Agent API: `$.agent()` returns the formatted value by default; `$.agentRaw()` returns richer metadata.
- Parallel API: include `$.parallel()` for named independent tasks and `$.mapParallel()` for list/item fan-out, both with concurrency caps.
- Pipeline API: include `$.pipeline()` in v1 for staged queues so later stages can start as soon as each item is ready.
- Workflow feature target: implement most Claude-style workflow primitives in v1: `meta`, schema/output formats, `agent`, `parallel`, `pipeline`, `phaseLog`, and budget guardrails.
- Output formats for v1: `text()`, `json(schema?)`, and `structured(schema)`.
- Inline agent config: support `inlineProfile({...})` in the profile map and directly as an `$.agent()` target for one-off steps.
- SDK config: use explicit `model` and `thinkingLevel` fields; keep `extraArgs` CLI-only for now.
