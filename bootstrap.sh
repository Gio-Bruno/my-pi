#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Bootstrap this repository as the default local Pi setup.

Usage:
  ./bootstrap.sh [--ghostty] [--skip-profile-links]

Options:
  --ghostty             Also run my-ghostty-configs/install.sh.
  --skip-profile-links  Do not create profile-local auth.json/models.json symlinks.
  -h, --help            Show this help.
USAGE
}

run_ghostty=0
link_profiles=1

while (($#)); do
  case "$1" in
    --ghostty)
      run_ghostty=1
      ;;
    --skip-profile-links)
      link_profiles=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
agent_root="$repo_dir/my-pi-agents"
wrapper="$repo_dir/custom-pi-agents/bin/pi"
default_agent_dir="${PI_DEFAULT_AGENT_DIR:-$HOME/.pi/agent}"

if [[ ! -x "$wrapper" ]]; then
  echo "Missing executable wrapper: $wrapper" >&2
  exit 1
fi

mkdir -p "$agent_root" "$default_agent_dir"

"$wrapper" agent-path "$agent_root" >/dev/null

echo "Pi wrapper agent path set to: $agent_root"

link_profile_file() {
  local link_path="$1"
  local target_path="$2"

  mkdir -p "$(dirname "$link_path")" "$(dirname "$target_path")"

  if [[ -e "$link_path" && ! -L "$link_path" ]]; then
    echo "warning: not replacing existing non-symlink: $link_path" >&2
    return 0
  fi

  ln -snf "$target_path" "$link_path"
}

if ((link_profiles)); then
  shopt -s nullglob
  for profile_dir in "$agent_root"/*; do
    [[ -d "$profile_dir" && -f "$profile_dir/config.json" ]] || continue

    mkdir -p \
      "$profile_dir/extensions" \
      "$profile_dir/prompts" \
      "$profile_dir/sessions" \
      "$profile_dir/skills" \
      "$profile_dir/tools"

    link_profile_file "$profile_dir/auth.json" "$default_agent_dir/auth.json"
    link_profile_file "$profile_dir/models.json" "$default_agent_dir/models.json"
    echo "Prepared profile: $(basename "$profile_dir")"
  done
  shopt -u nullglob
fi

if ((run_ghostty)); then
  "$repo_dir/my-ghostty-configs/install.sh"
fi

cat <<EOF

Next steps:
  1. Add the wrapper to your shell PATH:
     export PATH="$repo_dir/custom-pi-agents/bin:\$PATH"

  2. Authenticate this machine if needed:
     pi raw   # then use /login interactively

  3. Verify profiles:
     pi agents
     pi mr-default

Before committing changes:
  ./scripts/audit-secrets.sh
EOF
