# Pi shared resource library

This is a source library for reusable profile resources. Resources here are not loaded directly at runtime by the wrapper. Profile packs in `../pi-packs/` copy selected files/directories from here into each agent when you run `pi create --pack ...` or `pi apply-pack ...`.

Suggested layout:

```text
pi-shared/
  extensions/   # reusable Pi extensions
  skills/       # reusable skills or skill directories
  prompts/      # reusable prompt templates
  themes/       # reusable theme JSON files
  tools/        # reusable single-tool extension files, if needed
```

In a pack, reference shared resources with `sharedFiles`:

```json
{
  "sharedFiles": {
    "extensions/pi-mcp-adapter.ts": "extensions/pi-mcp-adapter.ts",
    "prompts/review.md": "prompts/review.md",
    "skills/code-review": "skills/code-review"
  }
}
```

Object keys are destination paths inside the agent profile. Object values are source paths inside this shared library. Directories are copied recursively.
