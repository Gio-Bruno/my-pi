#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$root"

fail=0

note_fail() {
  printf 'audit-secrets: %s\n' "$*" >&2
  fail=1
}

has_git=0
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  has_git=1
fi

check_forbidden_tracked_paths() {
  local path
  while IFS= read -r path; do
    case "$path" in
      */auth.json|auth.json|*/models.json|models.json|*/sessions/*|sessions/*|.env|*/.env|.env.*|*/.env.*|*.pem|*.key|*.p12|*.pfx|*/secrets/*|secrets/*)
        [[ "$path" == ".env.example" || "$path" == */.env.example ]] && continue
        note_fail "forbidden path is tracked: $path"
        ;;
    esac
  done
}

if ((has_git)); then
  git ls-files | check_forbidden_tracked_paths
else
  # No git repo yet: check files that are not under .git and are not ignored by name.
  find . -path './.git' -prune -o -type f -print | sed 's#^./##' | check_forbidden_tracked_paths
fi

scan_file_list="$(mktemp)"
trap 'rm -f "$scan_file_list"' EXIT

if ((has_git)); then
  while IFS= read -r -d '' path; do
    [[ "$path" == "scripts/audit-secrets.sh" ]] && continue
    printf '%s\0' "$path"
  done < <(git ls-files -co --exclude-standard -z) > "$scan_file_list"
else
  find . \
    \( -path './.git' -o -path '*/sessions' -o -path './scripts/audit-secrets.sh' \) -prune -o \
    -type f -print0 > "$scan_file_list"
fi

# High-confidence credential patterns only. This intentionally excludes generic
# words like "token" or "credential" to keep docs readable.
secret_regex='(sk-(ant|proj|live|test|or|[A-Za-z0-9]{2,})-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|"(access|refresh|id_token)"[[:space:]]*:[[:space:]]*"[A-Za-z0-9._~+/=-]{20,}")'

if [[ -s "$scan_file_list" ]]; then
  scanner=(rg -l --hidden --no-messages -i)
  if ! command -v rg >/dev/null 2>&1; then
    scanner=(grep -E -I -i -l)
  fi

  if xargs -0 "${scanner[@]}" "$secret_regex" < "$scan_file_list"; then
    note_fail "possible credential material found in file(s) listed above"
  fi
fi

if ((fail)); then
  exit 1
fi

echo "audit-secrets: ok"
