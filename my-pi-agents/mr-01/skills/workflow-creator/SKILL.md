---
name: workflow-creator
description: Convert a custom prompt, Pi skill, or natural-language capability description into a pi-workflows workflow bundle under pi-workflows/workflows/. Use when the user says /workflow-creator, asks to turn a prompt/skill into a workflow, or wants reusable workflow generation.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash(node *)
  - Bash(mkdir *)
  - Bash(mktemp *)
  - Bash(npm run *)
---

# Workflow Creator

Create a `pi-workflows` workflow bundle from a source prompt, skill, or natural-language capability description.

## Non-negotiable output target

V1 emits **workflow bundles only**:

```text
pi-workflows/workflows/<slug>.workflow.ts
pi-workflows/workflows/<slug>/prompts/*.md
pi-workflows/workflows/<slug>/steps/*.ts
pi-workflows/workflows/<slug>/schemas.ts
pi-workflows/workflows/<slug>/manifest.json
```

Do not emit standalone script bundles in v1.

## Invocation

Expected user form:

```text
/workflow-creator <path-or-description> [--name <slug>] [--force]
```

- `<path-or-description>` may be a prompt file, a skill directory containing `SKILL.md`, a `SKILL.md` file, a URL-like source note already present in the conversation, or plain natural language.
- `--name <slug>` overrides the inferred output slug.
- `--force` permits overwriting an existing generated bundle.

If no source is provided, ask for it.

## Announce

Start by saying briefly:

```text
I'm using the workflow-creator skill to generate a pi-workflows bundle.
```

## Source ingestion rules

Be bounded and explicit.

```text
prompt file     read full file + frontmatter
skill dir       read SKILL.md first, then selectively inspect reference/ and scripts/
plain NL        treat as a new capability description
```

Never ingest or copy:

```text
node_modules/
dist/
build/
sessions/
.git/
.env*
auth.json
models.json
secrets/
private keys/certs
hidden credential files
```

For large skills, read `SKILL.md` first. Only inspect referenced files that materially affect workflow generation.

## Decomposition rubric

Treat the source as raw material, not a runtime dependency. Break it into:

```text
deterministic steps    parse, fetch, transform, validate, write, shell gates
small prompts          classify, decide, summarize, review
schemas/contracts      TypeBox schemas for structured agent output
workflow glue          declared phases, ordering, retries, budgets, stop conditions
safety policy          human gates, branch/worktree guards, overwrite rules
verification           commands or checks that prove the workflow works
```

Prefer deterministic code over prompts whenever behavior is mechanical.

## Current workflow API to generate

Generate against the current `pi-workflows` API:

```ts
import { compact, prompt, readOnlyAgent, workflow } from "../src/index.js";

export default workflow("Human readable name", {
  description: "...",
  phases: ["inspect", "prepare", "decide", "execute", "validate", "report"],
  agents: {
    analyst: readOnlyAgent("Role-specific concise instructions."),
  },
  async run($, args: { input?: string } = {}) {
    const prepared = await $.phase("prepare", () => $.run("prepare input", () => ({ input: args.input })));
    return $.phase("report", () => $.text("analyst", prompt`Summarize: ${compact(prepared)}`));
  },
});
```

Use:

- `workflow("Name", { ... })`, not `defineWorkflow`.
- `agents`, not `profiles`.
- Declared `phases`, then `$.phase("phase", () => ...)`.
- `$.run` for deterministic JS.
- `$.sh` for deterministic CLI/shell gates.
- `$.text`, `$.json`, `$.structured` for agent calls.
- `$.request` only when metadata is needed.
- `$.approve`, `$.confirm`, `$.ask`, `$.choose` for explicit human gates inside generated workflows when the source requires stopping/asking.
- `$.workflow` only for a real child workflow that already exists.
- `prompt` and `compact` for safe prompt composition.

Do not generate old API names:

```text
defineWorkflow
runWorkflow
profiles:
$.agent
$.agentRaw
$.phaseLog
```

## Agent defaults

Default to portable inline preset agents:

```ts
readOnlyAgent(...)
codeSearchAgent(...)
editAgent(...)
```

Use `profile("name")` only when the source requires profile-local skills, tools, extensions, or MCP servers.

For CLI-wrapper skills, make the workflow script-heavy:

```text
steps/*.ts + $.sh(...)
minimal prompts
optional read-only summarizer only when needed
```

## Import rules

Generated workflows live under `pi-workflows/workflows/`, so imports should usually look like:

```ts
import { compact, prompt, readOnlyAgent, workflow } from "../src/index.js";
import { SomeSchema } from "./<slug>/schemas.js";
import { helper } from "./<slug>/steps/helper.js";
```

Generated asset files are `.ts`, but NodeNext imports must use `.js` specifiers.

Prompt files should hold stable instructions. Dynamic data belongs in workflow code via `prompt` and `compact`.

## Safe writer: required

Do **not** write final workflow files directly with normal file tools. Create a JSON manifest and invoke the deterministic writer:

```bash
node "$PI_CODING_AGENT_DIR/skills/workflow-creator/scripts/write-bundle.mjs" \
  --manifest /path/to/manifest.json \
  [--force]
```

The writer enforces:

- slug validation
- default `pi-workflows/workflows/` output root
- no custom output root unless explicitly test-enabled via environment
- no path traversal
- fail-if-exists unless `--force`
- manifest writing

Manifest shape:

```json
{
  "slug": "example-workflow",
  "name": "Example workflow",
  "source": "path-or-description",
  "files": [
    { "path": "example-workflow.workflow.ts", "content": "..." },
    { "path": "example-workflow/prompts/decide.md", "content": "..." },
    { "path": "example-workflow/steps/prepare.ts", "content": "..." },
    { "path": "example-workflow/schemas.ts", "content": "..." }
  ]
}
```

Use `--force` only if the user passed `--force`.

## Generation process

1. Parse arguments: source, optional `--name`, optional `--force`.
2. Locate repo root containing `pi-workflows/package.json`.
3. Ingest source using the bounded rules above.
4. Infer or validate slug: lowercase letters, numbers, dashes; starts with a letter/number.
5. Decompose into phases, deterministic steps, small prompts, schemas, agents, safety gates, and verification.
6. Build the manifest with all generated files.
7. Run `write-bundle.mjs`.
8. Run a quick static check when practical:
   - no old API names
   - imports use `.js` specifiers for generated assets
   - declared phases match used phases
9. Report created/updated paths and how to run:

```text
/workflow <slug>
```

## Recommended phase patterns

General prompt/skill:

```text
inspect -> prepare -> decide -> execute -> validate -> report
```

Plan-execution skill:

```text
load -> guard -> review -> execute -> finish
```

CLI-wrapper skill:

```text
input -> prepare -> execute/scrape -> validate -> report
```

## Stop conditions

Stop and report instead of guessing when:

- The source is missing or unreadable.
- Required semantics cannot be inferred.
- The source asks for a tool/profile/MCP server that is unavailable and no safe substitute is obvious.
- The target exists and `--force` was not provided.
- The writer rejects the manifest.
