# My Ghostty Configs

Personal Ghostty config notes and reusable setup snippets.

## Install

```sh
cd /path/to/my-pi
./my-ghostty-configs/install.sh
```

The installer:

- writes `~/.config/ghostty/my-ghostty-configs.ghostty`
- adds a marked `config-file` include block to your Ghostty config
- validates the final Ghostty config when the Ghostty CLI is available

Reload Ghostty config or restart Ghostty after installing.

## Update

```sh
cd /path/to/my-pi
git pull
./my-ghostty-configs/install.sh
```

Run the installer again after pulling updates. It is idempotent and updates the same managed block.

## Uninstall

```sh
./my-ghostty-configs/uninstall.sh
```

The uninstaller removes only the managed include block and generated config file.

## Config Location

By default the scripts use:

- macOS: `~/Library/Application Support/com.mitchellh.ghostty/config.ghostty`
- Linux/BSD: `${XDG_CONFIG_HOME:-~/.config}/ghostty/config.ghostty`

Override this with `GHOSTTY_CONFIG_FILE`:

```sh
GHOSTTY_CONFIG_FILE=/path/to/config.ghostty ./install.sh
```

## Focus Border

This setup cycles split focus with `Ctrl+Tab` and keeps a persistent blue border on the focused split.

### Files

- `ghostty/focus-border.ghostty.template`: Ghostty config snippet used by the installer.
- `ghostty/shaders/focus-border.glsl`: Custom shader that highlights the focused split.

```ini
keybind = ctrl+tab=goto_split:next
keybind = cmd+t=new_tab
keybind = cmd+d=new_split:right
keybind = cmd+shift+d=new_split:down
# Prompt you to rename the focused pane/split
keybind = ctrl+shift+r=prompt_surface_title

# Shell/text editing keybindings.
keybind = cmd+arrow_left=text:\x01
keybind = cmd+arrow_right=text:\x05
keybind = shift+enter=csi:13;2u
keybind = alt+backspace=text:\x17
keybind = cmd+backspace=text:\x15
keybind = cmd+shift+backspace=text:\x15\x0b

custom-shader = "/absolute/path/to/ghostty/shaders/focus-border.glsl"
custom-shader-animation = false
```
