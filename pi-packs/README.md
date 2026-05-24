# Pi profile packs

Reusable building blocks for `custom-pi-agents/bin/pi` managed profiles.

Packs are copy/apply templates. They do not make resources shared at runtime; they copy selected resources into each agent profile when the profile is created or when a pack is applied.

Create an agent from one or more packs:

```sh
pi create my-mcp --tools "" --pack mcp-adapter
pi create my-agent --pack mcp-adapter --pack team-prompts --pack review-skills
pi create my-firecrawl --pack firecrawl
```

Add one or more packs to an existing agent:

```sh
pi apply-pack my-agent mcp-adapter team-prompts review-skills
pi apply-pack my-agent firecrawl
```

List packs:

```sh
pi packs
```

A pack has a `pack.json` manifest plus optional files under `files/` that are copied into the profile root. It can also pull files/directories from `../pi-shared/` through `sharedFiles`.

Example:

```json
{
  "description": "Team prompts and review skill",
  "sharedFiles": {
    "prompts/review.md": "prompts/review.md",
    "skills/code-review": "skills/code-review"
  },
  "config": {
    "extensionTools": ["mcp"],
    "extensionPackages": ["npm:@scope/pi-package"]
  },
  "settings": {
    "enableSkillCommands": true
  },
  "dependencies": {
    "some-extension-dependency": "^1.0.0"
  }
}
```

Manifest fields merged into the target profile:

- `sharedFiles`: copy files/directories from `pi-shared/` into the profile
- `files/`: copy pack-local files/directories into the profile
- `config.builtinTools`, `config.extensionTools`, `config.extensionPackages`, `config.extraArgs`
- `config.systemPrompt`, `config.appendSystemPrompt`
- `settings`: profile `settings.json` object entries
- `dependencies` / `devDependencies` / `peerDependencies` / `optionalDependencies`
- `mcp.settings` and `mcp.mcpServers`

Common destination folders:

- `extensions/` - broader Pi extensions; add their LLM-callable tool names to `config.extensionTools`
- `tools/` - single-tool extension files; filename is enabled automatically
- `skills/` - copied skills are loaded by the wrapper
- `prompts/` - copied prompt templates are loaded by the wrapper
- `themes/` - copied theme JSON files are loaded by the wrapper

When a pack adds package dependencies, the wrapper runs `npm install` in the target profile by default. Use `--no-install` to skip it.

## Available packs

- `mcp-adapter` - MCP adapter extension with only the gateway tool enabled.
- `rtk` - RTK command rewriting/token-saving extension hook.
- `firecrawl` - Firecrawl MCP server exposed as direct scrape/search/map/crawl/extract tools. Requires `FIRECRAWL_API_KEY` in the local environment.
- `plannotator` - Plannotator Pi package for visual plan/code review and annotations. Upstream: https://github.com/backnotprop/plannotator
- `impeccable` - Impeccable frontend design skill and CLI. Upstream: https://github.com/pbakaus/impeccable
