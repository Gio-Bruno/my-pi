# my-pi

Portable, safe-by-default setup for Pi Coding Agent profiles and related terminal config.

This repository is meant to be cloneable on any machine, including work/corporate machines. It stores reusable configuration and code, but **not credentials, tokens, sessions, or machine-local state**.

## Layout

- `custom-pi-agents/` - `pi` wrapper that runs isolated named Pi profiles.
- `my-pi-agents/` - portable Pi profile root used by the wrapper.
- `my-ghostty-configs/` - reusable Ghostty config installer/snippets.
- `scripts/audit-secrets.sh` - quick pre-commit safety check.

## Bootstrap a new machine

```sh
git clone <this-repo-url> my-pi
cd my-pi
./bootstrap.sh
```

Then put the wrapper first in your shell `PATH`:

```sh
export PATH="$PWD/custom-pi-agents/bin:$PATH"
```

Persist that line in `~/.zshrc`, `~/.bashrc`, or your shell profile.

Verify:

```sh
pi agent-path   # should print .../my-pi/my-pi-agents
pi agents       # should list mr-default
pi mr-default
```

`PI_AGENTS_HOME` overrides the stored `pi agent-path`. If you set `PI_AGENTS_HOME`, unset it or point it at this repo's `my-pi-agents/`.

## Credentials policy

Do **not** commit machine credentials or session data.

Ignored local-only files include:

- `auth.json`
- `models.json`
- `sessions/`
- `.env*` except `.env.example`
- private key/certificate files
- `secrets/`

Pi credentials should live per machine in the normal Pi location (`~/.pi/agent/auth.json`) or environment variables. `./bootstrap.sh` creates ignored profile-local symlinks to the machine's default Pi files when needed.

Authenticate on each machine with normal Pi flows, for example run `pi raw` and use `/login` interactively, or configure provider environment variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.

Before committing, run:

```sh
./scripts/audit-secrets.sh
```

## Ghostty

Install the Ghostty snippets on a machine with:

```sh
./my-ghostty-configs/install.sh
```

Uninstall with:

```sh
./my-ghostty-configs/uninstall.sh
```
