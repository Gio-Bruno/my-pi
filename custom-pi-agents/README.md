# Custom Pi Agents

Small wrapper for running isolated Pi Coding Agent profiles.

It is designed to shadow the real `pi` binary:

```sh
export PATH="/path/to/my-pi/custom-pi-agents/bin:$PATH"
```

In this monorepo, run `./bootstrap.sh` from the repository root to set
`my-pi-agents/` as the persistent profile root.

The wrapper keeps normal Pi behavior for commands it does not own. For example,
`pi --help`, `pi install`, and `pi "prompt"` are passed through to the real Pi
binary.

## Commands

Create a profile:

```sh
pi create researcher
```

Create a read-only profile:

```sh
pi create searcher --tools read,grep,find,ls
```

Run a profile:

```sh
pi researcher
pi researcher -p "Inspect this repo"
```

List managed profiles:

```sh
pi agents
```

Set the persistent profile root:

```sh
pi agent-path /path/to/my-pi/my-pi-agents
```

Call the real Pi binary directly:

```sh
pi raw --help
```

Show wrapper help:

```sh
pi help
```

## Profile Layout

Profiles are created under `~/.pi-agents/<agent-name>` by default:

```text
~/.pi-agents/researcher/
  config.json
  .gitignore
  APPEND_SYSTEM.md
  settings.json
  auth.json -> ~/.pi/agent/auth.json
  models.json -> ~/.pi/agent/models.json
  skills/
  prompts/
  tools/
  extensions/
  sessions/
```

Override the root with:

```sh
export PI_AGENTS_HOME="$HOME/.my-pi-agents"
```

Or set it persistently:

```sh
pi agent-path "$HOME/.my-pi-agents"
```

`PI_AGENTS_HOME` wins over the stored `agent-path` value when both are set.

## Isolation

When a profile runs, the wrapper sets:

```sh
PI_CODING_AGENT_DIR="<profile-dir>"
PI_CODING_AGENT_SESSION_DIR="<profile-dir>/sessions"
```

It also runs Pi with:

```sh
--no-context-files
--no-skills --skill "<profile-dir>/skills"
--no-prompt-templates --prompt-template "<profile-dir>/prompts"
--no-extensions
--extension "<profile-dir>/tools/<tool-name>.ts"
--extension "<profile-dir>/extensions/<extension-name>.ts"
--append-system-prompt "<profile-dir>/APPEND_SYSTEM.md"
--tools "<enabled built-in and custom tool names>"
```

This prevents project/global `AGENTS.md`, `CLAUDE.md`, `~/.agents/skills`, and
discovered extensions from leaking into that profile. Profile-local resources
are opted back in explicitly.

## Customization

Edit `config.json` inside a profile:

```json
{
  "builtinTools": ["read", "grep", "find", "ls"],
  "extensionTools": [],
  "extraArgs": ["--thinking", "high"]
}
```

`builtinTools` defines the built-in Pi tools the agent starts with.

Put custom tool files in `tools/`. Files ending in `.js`, `.mjs`, `.cjs`, or
`.ts` are loaded explicitly as Pi extensions. The filename without extension is
treated as the custom tool name and is added to the `--tools` allowlist:

```text
tools/mr_search.ts -> mr_search
```

Put broader Pi extensions in `extensions/`. Those files are loaded explicitly
too. If an extension registers LLM-callable tools, add those tool names to
`extensionTools` so Pi keeps them enabled when the wrapper passes `--tools`.

The created `auth.json` and `models.json` are symlinks to the default Pi files
under `~/.pi/agent` so profiles are usable without duplicating credentials or
model registry state. Both are ignored by the profile `.gitignore`.

`APPEND_SYSTEM.md` is created empty by default. Put profile-specific appended
system instructions there.

To replace Pi's system prompt with a custom file, add `systemPrompt` to
`config.json`. This is intentionally not included in the default template:

```json
{
  "builtinTools": ["read"],
  "extensionTools": [],
  "extraArgs": [],
  "systemPrompt": "STRICT_SYSTEM.md"
}
```

Relative prompt paths are resolved from the profile directory. You can also set
`appendSystemPrompt` to a different file or `null` to disable the default append
file.
