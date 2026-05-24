#!/usr/bin/env bash
set -euo pipefail

begin_marker="# BEGIN my-ghostty-configs"
end_marker="# END my-ghostty-configs"

config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
generated_config="$config_home/ghostty/my-ghostty-configs.ghostty"

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

if [[ -f "$user_config" ]]; then
    tmp_config="$(mktemp)"
    trap 'rm -f "$tmp_config" "$tmp_config.trimmed"' EXIT

    awk -v begin="$begin_marker" -v end="$end_marker" '
        $0 == begin { skipping = 1; next }
        $0 == end { skipping = 0; next }
        !skipping { print }
    ' "$user_config" > "$tmp_config"

    trim_trailing_blank_lines "$tmp_config" "$tmp_config.trimmed"

    if ghostty_bin="$(find_ghostty)"; then
        "$ghostty_bin" +validate-config --config-file="$tmp_config.trimmed" >/dev/null
    fi

    cp "$tmp_config.trimmed" "$user_config"
fi

rm -f "$generated_config"

if [[ -n "${ghostty_bin:-}" ]]; then
    echo "Uninstalled and validated Ghostty config."
else
    echo "Uninstalled. Skipped validation because Ghostty was not found on PATH."
fi

echo "User config: $user_config"
echo "Removed generated config: $generated_config"
echo "Reload Ghostty config or restart Ghostty."
