#!/usr/bin/env bash
set -euo pipefail

begin_marker="# BEGIN my-ghostty-configs"
end_marker="# END my-ghostty-configs"

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
generated_dir="$config_home/ghostty"
generated_config="$generated_dir/my-ghostty-configs.ghostty"
template="$repo_dir/ghostty/focus-border.ghostty.template"
shader="$repo_dir/ghostty/shaders/focus-border.glsl"

ghostty_config_path() {
    if [[ -n "${GHOSTTY_CONFIG_FILE:-}" ]]; then
        printf '%s\n' "$GHOSTTY_CONFIG_FILE"
        return
    fi

    if [[ "${OSTYPE:-}" == darwin* ]]; then
        printf '%s\n' "$HOME/Library/Application Support/com.mitchellh.ghostty/config.ghostty"
        return
    fi

    printf '%s\n' "$config_home/ghostty/config.ghostty"
}

quote_ghostty_value() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    printf '"%s"' "$value"
}

find_ghostty() {
    if command -v ghostty >/dev/null 2>&1; then
        command -v ghostty
        return
    fi

    if [[ -x /Applications/Ghostty.app/Contents/MacOS/ghostty ]]; then
        printf '%s\n' /Applications/Ghostty.app/Contents/MacOS/ghostty
        return
    fi

    return 1
}

remove_managed_block() {
    local source="$1"
    local target="$2"

    if [[ -f "$source" ]]; then
        awk -v begin="$begin_marker" -v end="$end_marker" '
            $0 == begin { skipping = 1; next }
            $0 == end { skipping = 0; next }
            !skipping { print }
        ' "$source" > "$target"
    else
        : > "$target"
    fi
}

trim_trailing_blank_lines() {
    local source="$1"
    local target="$2"

    awk '
        { lines[NR] = $0 }
        END {
            last = NR
            while (last > 0 && lines[last] == "") {
                last--
            }
            for (i = 1; i <= last; i++) {
                print lines[i]
            }
        }
    ' "$source" > "$target"
}

user_config="$(ghostty_config_path)"
include_line="config-file = $(quote_ghostty_value "$generated_config")"
shader_value="$(quote_ghostty_value "$shader")"

if [[ ! -f "$template" ]]; then
    echo "Missing template: $template" >&2
    exit 1
fi

if [[ ! -f "$shader" ]]; then
    echo "Missing shader: $shader" >&2
    exit 1
fi

mkdir -p "$generated_dir" "$(dirname "$user_config")"

while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s\n' "${line//'{{FOCUS_BORDER_SHADER}}'/$shader_value}"
done < "$template" > "$generated_config"

tmp_config="$(mktemp)"
trap 'rm -f "$tmp_config" "$tmp_config.cleaned" "$tmp_config.trimmed"' EXIT

remove_managed_block "$user_config" "$tmp_config.cleaned"
trim_trailing_blank_lines "$tmp_config.cleaned" "$tmp_config.trimmed"

{
    cat "$tmp_config.trimmed"
    if [[ -s "$tmp_config.trimmed" ]]; then
        printf '\n'
    fi
    printf '%s\n%s\n%s\n' "$begin_marker" "$include_line" "$end_marker"
} > "$tmp_config"

if ghostty_bin="$(find_ghostty)"; then
    "$ghostty_bin" +validate-config --config-file="$tmp_config" >/dev/null
fi

cp "$tmp_config" "$user_config"

if [[ -n "${ghostty_bin:-}" ]]; then
    echo "Installed and validated Ghostty config."
else
    echo "Installed. Skipped validation because Ghostty was not found on PATH."
fi

echo "User config: $user_config"
echo "Generated config: $generated_config"
echo "Reload Ghostty config or restart Ghostty."
