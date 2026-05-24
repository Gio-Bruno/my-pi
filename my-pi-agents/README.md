# my-pi-agents

Portable Pi profile root used by `custom-pi-agents/bin/pi`.

Each direct child folder is a named Pi profile. Example:

```text
mr-default/
  config.json
  settings.json
  APPEND_SYSTEM.md
  skills/
  prompts/
  tools/
  extensions/
  themes/
```

Local-only files are ignored and should be recreated per machine:

- `auth.json` -> `~/.pi/agent/auth.json`
- `models.json` -> `~/.pi/agent/models.json`
- `sessions/`

Run the top-level bootstrap script after cloning:

```sh
../bootstrap.sh
```

Create another profile with:

```sh
pi create <profile-name>
```

Create a profile by pulling reusable resources from packs:

```sh
pi create my-mcp --tools "" --pack mcp-adapter
pi create my-agent --pack mcp-adapter --pack team-prompts
```
