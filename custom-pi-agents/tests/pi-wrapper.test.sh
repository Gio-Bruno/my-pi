#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PI_WRAPPER="$ROOT_DIR/bin/pi"

fail() {
  printf 'not ok - %s\n' "$1" >&2
  exit 1
}

assert_exists() {
  [[ -e "$1" ]] || fail "expected $1 to exist"
}

assert_dir() {
  [[ -d "$1" ]] || fail "expected $1 to be a directory"
}

assert_empty_file() {
  [[ -f "$1" ]] || fail "expected $1 to be a file"
  [[ ! -s "$1" ]] || fail "expected $1 to be empty"
}

assert_file_contains() {
  local file="$1"
  local expected="$2"
  grep -F -- "$expected" "$file" >/dev/null || {
    printf -- '--- %s ---\n' "$file" >&2
    sed -n '1,200p' "$file" >&2 || true
    fail "expected $file to contain: $expected"
  }
}

assert_file_not_contains() {
  local file="$1"
  local unexpected="$2"
  if grep -F -- "$unexpected" "$file" >/dev/null; then
    printf -- '--- %s ---\n' "$file" >&2
    sed -n '1,200p' "$file" >&2 || true
    fail "expected $file not to contain: $unexpected"
  fi
}

make_fake_pi() {
  local dir="$1"
  mkdir -p "$dir"
  cat >"$dir/pi-real" <<'FAKE_PI'
#!/usr/bin/env bash
set -euo pipefail

printf 'PI_CODING_AGENT_DIR=%s\n' "${PI_CODING_AGENT_DIR:-}" >"$PI_FAKE_CAPTURE/env"
printf 'PI_CODING_AGENT_SESSION_DIR=%s\n' "${PI_CODING_AGENT_SESSION_DIR:-}" >>"$PI_FAKE_CAPTURE/env"
for arg in "$@"; do
  printf '<%s>\n' "$arg" >>"$PI_FAKE_CAPTURE/args"
done
FAKE_PI
  chmod +x "$dir/pi-real"
}

with_temp_home() {
  local name="$1"
  shift
  local tmp
  tmp="$(mktemp -d)"
  mkdir -p "$tmp/home/.pi/agent" "$tmp/capture"
  printf '{"defaultProvider":"openai-codex","defaultModel":"gpt-5.5"}\n' >"$tmp/home/.pi/agent/settings.json"
  printf '{"kind":"fake-auth"}\n' >"$tmp/home/.pi/agent/auth.json"
  printf '{"models":[]}\n' >"$tmp/home/.pi/agent/models.json"
  make_fake_pi "$tmp/bin"

  HOME="$tmp/home" \
  PI_AGENTS_HOME="$tmp/agents" \
  PI_AGENT_PACKS_HOME="$tmp/packs" \
  PI_SHARED_HOME="$tmp/shared" \
  PI_REAL_BIN="$tmp/bin/pi-real" \
  PI_FAKE_CAPTURE="$tmp/capture" \
  "$@"

  rm -rf "$tmp"
  printf 'ok - %s\n' "$name"
}

with_temp_home_without_agent_env() {
  local name="$1"
  shift
  local tmp
  tmp="$(mktemp -d)"
  mkdir -p "$tmp/home/.pi/agent" "$tmp/capture"
  printf '{"defaultProvider":"openai-codex","defaultModel":"gpt-5.5"}\n' >"$tmp/home/.pi/agent/settings.json"
  printf '{"kind":"fake-auth"}\n' >"$tmp/home/.pi/agent/auth.json"
  printf '{"models":[]}\n' >"$tmp/home/.pi/agent/models.json"
  make_fake_pi "$tmp/bin"

  PI_AGENTS_HOME="" \
  PI_AGENT_PACKS_HOME="$tmp/packs" \
  PI_SHARED_HOME="$tmp/shared" \
  HOME="$tmp/home" \
  PI_REAL_BIN="$tmp/bin/pi-real" \
  PI_FAKE_CAPTURE="$tmp/capture" \
  TEST_TMP="$tmp" \
  "$@"

  rm -rf "$tmp"
  printf 'ok - %s\n' "$name"
}

make_test_pack() {
  local pack="$PI_AGENT_PACKS_HOME/test-mcp"
  mkdir -p "$pack" "$PI_SHARED_HOME/extensions" "$PI_SHARED_HOME/prompts"
  cat >"$pack/pack.json" <<'JSON'
{
  "description": "test MCP pack",
  "sharedFiles": {
    "extensions/pi-mcp-adapter.ts": "extensions/pi-mcp-adapter.ts",
    "prompts/review.md": "prompts/review.md"
  },
  "config": {
    "extensionTools": ["mcp"]
  },
  "settings": {
    "enableSkillCommands": true
  },
  "dependencies": {
    "pi-mcp-adapter": "file:../fake-adapter"
  },
  "mcp": {
    "settings": {
      "toolPrefix": "server"
    },
    "mcpServers": {
      "demo": {
        "command": "node",
        "args": ["demo.js"],
        "lifecycle": "lazy"
      }
    }
  }
}
JSON
  printf 'export default function() {}\n' >"$PI_SHARED_HOME/extensions/pi-mcp-adapter.ts"
  printf -- '---\ndescription: Review changes\n---\nReview.\n' >"$PI_SHARED_HOME/prompts/review.md"
}

test_create_profile() {
  "$PI_WRAPPER" create researcher >/tmp/pi-wrapper-create.out

  local profile="$PI_AGENTS_HOME/researcher"
  assert_dir "$profile"
  assert_dir "$profile/skills"
  assert_dir "$profile/prompts"
  assert_dir "$profile/tools"
  assert_dir "$profile/extensions"
  assert_dir "$profile/themes"
  assert_dir "$profile/sessions"
  assert_exists "$profile/.gitignore"
  assert_empty_file "$profile/APPEND_SYSTEM.md"
  [[ ! -e "$profile/system-prompt.md" ]] || fail "default profile should not create system-prompt.md"
  assert_exists "$profile/config.json"
  assert_exists "$profile/settings.json"
  [[ -L "$profile/auth.json" ]] || fail "expected auth.json to be linked from the default Pi profile"
  [[ -L "$profile/models.json" ]] || fail "expected models.json to be linked from the default Pi profile"
  [[ "$(readlink "$profile/auth.json")" == "$HOME/.pi/agent/auth.json" ]] || fail "expected auth.json to derive from home .pi"
  [[ "$(readlink "$profile/models.json")" == "$HOME/.pi/agent/models.json" ]] || fail "expected models.json to derive from home .pi"
  assert_file_contains "$profile/config.json" '"builtinTools"'
  assert_file_not_contains "$profile/config.json" '"systemPrompt"'
  assert_file_contains "$profile/.gitignore" "sessions/"
  assert_file_contains "$profile/.gitignore" "auth.json"
  assert_file_contains "$profile/.gitignore" "models.json"
  assert_file_contains "$profile/.gitignore" "settings.json"
  assert_file_contains /tmp/pi-wrapper-create.out "Created Pi agent profile: researcher"
}

test_run_profile_isolated() {
  "$PI_WRAPPER" create researcher >/dev/null
  mkdir -p "$PI_AGENTS_HOME/researcher/tools"
  mkdir -p "$PI_AGENTS_HOME/researcher/extensions"
  printf 'export default function() {}\n' >"$PI_AGENTS_HOME/researcher/tools/mr_search.ts"
  printf 'export default function() {}\n' >"$PI_AGENTS_HOME/researcher/extensions/session-log.ts"
  cat >"$PI_AGENTS_HOME/researcher/config.json" <<'CONFIG'
{
  "builtinTools": ["read", "grep", "find", "ls"],
  "extensionTools": ["session_log"],
  "extraArgs": ["--thinking", "high"]
}
CONFIG

  "$PI_WRAPPER" researcher -p "inspect only"

  assert_file_contains "$PI_FAKE_CAPTURE/env" "PI_CODING_AGENT_DIR=$PI_AGENTS_HOME/researcher"
  assert_file_contains "$PI_FAKE_CAPTURE/env" "PI_CODING_AGENT_SESSION_DIR=$PI_AGENTS_HOME/researcher/sessions"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--no-context-files>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--no-skills>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--skill>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<$PI_AGENTS_HOME/researcher/skills>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--no-prompt-templates>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--prompt-template>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<$PI_AGENTS_HOME/researcher/prompts>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--no-themes>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--theme>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<$PI_AGENTS_HOME/researcher/themes>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--no-extensions>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--extension>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<$PI_AGENTS_HOME/researcher/tools/mr_search.ts>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<$PI_AGENTS_HOME/researcher/extensions/session-log.ts>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--append-system-prompt>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<$PI_AGENTS_HOME/researcher/APPEND_SYSTEM.md>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--tools>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<read,grep,find,ls,mr_search,session_log>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--thinking>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<high>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<-p>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<inspect only>"
}

test_custom_system_prompt_can_be_defined_in_config() {
  "$PI_WRAPPER" create reviewer >/dev/null
  printf 'You are strict.\n' >"$PI_AGENTS_HOME/reviewer/STRICT_SYSTEM.md"
  cat >"$PI_AGENTS_HOME/reviewer/config.json" <<'CONFIG'
{
  "builtinTools": ["read"],
  "extensionTools": [],
  "extraArgs": [],
  "systemPrompt": "STRICT_SYSTEM.md"
}
CONFIG

  "$PI_WRAPPER" reviewer -p "review"

  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--system-prompt>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<$PI_AGENTS_HOME/reviewer/STRICT_SYSTEM.md>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--append-system-prompt>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<$PI_AGENTS_HOME/reviewer/APPEND_SYSTEM.md>"
}

test_agent_path_sets_profile_root_when_env_is_unset() {
  local custom_root="$TEST_TMP/custom-agents"
  mkdir -p "$custom_root"
  custom_root="$(cd "$custom_root" && pwd -P)"

  "$PI_WRAPPER" agent-path "$custom_root" >/tmp/pi-wrapper-agent-path.out
  "$PI_WRAPPER" create researcher >/dev/null
  "$PI_WRAPPER" researcher -p "path check"

  assert_file_contains /tmp/pi-wrapper-agent-path.out "Pi agent path: $custom_root"
  assert_dir "$custom_root/researcher"
  assert_file_contains "$PI_FAKE_CAPTURE/env" "PI_CODING_AGENT_DIR=$custom_root/researcher"
  assert_file_contains "$PI_FAKE_CAPTURE/env" "PI_CODING_AGENT_SESSION_DIR=$custom_root/researcher/sessions"
}

test_empty_builtin_tools_still_enables_custom_tools() {
  "$PI_WRAPPER" create searcher --tools "" >/dev/null
  printf 'export default function() {}\n' >"$PI_AGENTS_HOME/searcher/tools/mr_search.ts"

  "$PI_WRAPPER" searcher -p "custom only"

  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--tools>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<mr_search>"
  assert_file_not_contains "$PI_FAKE_CAPTURE/args" "<read,write,edit,bash>"
}

test_create_with_pack() {
  make_test_pack
  "$PI_WRAPPER" create packed --tools "" --pack test-mcp --no-install >/tmp/pi-wrapper-create-pack.out

  local profile="$PI_AGENTS_HOME/packed"
  assert_exists "$profile/extensions/pi-mcp-adapter.ts"
  assert_exists "$profile/prompts/review.md"
  assert_exists "$profile/package.json"
  assert_exists "$profile/mcp.json"
  assert_file_contains "$profile/config.json" '"extensionTools": ['
  assert_file_contains "$profile/config.json" '"mcp"'
  assert_file_contains "$profile/package.json" '"pi-mcp-adapter": "file:../fake-adapter"'
  assert_file_contains "$profile/mcp.json" '"demo"'
  assert_file_contains "$profile/settings.json" '"enableSkillCommands": true'
  assert_file_contains /tmp/pi-wrapper-create-pack.out "Applied profile pack: test-mcp"

  "$PI_WRAPPER" packed -p "pack run"

  assert_file_contains "$PI_FAKE_CAPTURE/args" "<$profile/extensions/pi-mcp-adapter.ts>"
  assert_file_contains "$PI_FAKE_CAPTURE/args" "<mcp>"
  assert_file_not_contains "$PI_FAKE_CAPTURE/args" "<read,write,edit,bash>"
}

test_apply_pack_to_existing_profile() {
  make_test_pack
  "$PI_WRAPPER" create existing --tools read --no-install >/dev/null
  "$PI_WRAPPER" apply-pack existing test-mcp --no-install >/tmp/pi-wrapper-apply-pack.out

  local profile="$PI_AGENTS_HOME/existing"
  assert_exists "$profile/extensions/pi-mcp-adapter.ts"
  assert_file_contains "$profile/config.json" '"read"'
  assert_file_contains "$profile/config.json" '"mcp"'
  assert_exists "$profile/prompts/review.md"
  assert_file_contains /tmp/pi-wrapper-apply-pack.out "Applied profile pack: test-mcp"
}

test_list_packs() {
  make_test_pack
  "$PI_WRAPPER" packs >/tmp/pi-wrapper-packs.out

  assert_file_contains /tmp/pi-wrapper-packs.out "test-mcp - test MCP pack"
}

test_unknown_command_passes_through_to_real_pi() {
  "$PI_WRAPPER" --version

  assert_file_contains "$PI_FAKE_CAPTURE/args" "<--version>"
  assert_file_contains "$PI_FAKE_CAPTURE/env" "PI_CODING_AGENT_DIR="
  assert_file_contains "$PI_FAKE_CAPTURE/env" "PI_CODING_AGENT_SESSION_DIR="
}

with_temp_home "create profile" test_create_profile
with_temp_home "run profile isolated" test_run_profile_isolated
with_temp_home "custom system prompt can be defined in config" test_custom_system_prompt_can_be_defined_in_config
with_temp_home "empty builtin tools still enables custom tools" test_empty_builtin_tools_still_enables_custom_tools
with_temp_home "create with pack" test_create_with_pack
with_temp_home "apply pack to existing profile" test_apply_pack_to_existing_profile
with_temp_home "list packs" test_list_packs
with_temp_home "unknown command passthrough" test_unknown_command_passes_through_to_real_pi
with_temp_home_without_agent_env "agent path sets profile root when env is unset" test_agent_path_sets_profile_root_when_env_is_unset
