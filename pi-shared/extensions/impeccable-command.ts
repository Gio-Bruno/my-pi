import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = resolve(__dirname, "..");
const SKILL_DIR = resolve(PROFILE_DIR, "skills", "impeccable");
const SKILL_FILE = resolve(SKILL_DIR, "SKILL.md");

function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith("---")) return markdown;
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return markdown;
  const after = markdown.indexOf("\n", end + 4);
  return after === -1 ? "" : markdown.slice(after + 1);
}

function expandImpeccable(args: string): string {
  const body = stripFrontmatter(readFileSync(SKILL_FILE, "utf8")).trim();
  const trimmedArgs = args.trim();

  const piCompatibility = [
    "Pi compatibility note:",
    `- The impeccable skill directory is ${SKILL_DIR}.`,
    `- The active Pi profile directory is ${PROFILE_DIR}.`,
    "- In this profile, run helper scripts as `node \"$PI_CODING_AGENT_DIR/skills/impeccable/scripts/<file>\"`.",
    `- If you need to read a relative reference such as \`reference/live.md\`, resolve it under ${SKILL_DIR}.`,
    "- Pi's native skill command is /skill:impeccable; this profile also accepts /impeccable for compatibility.",
  ].join("\n");

  const skillBlock = `<skill name="impeccable" location="${SKILL_FILE}">\nReferences are relative to ${SKILL_DIR}.\n\n${piCompatibility}\n\n${body}\n</skill>`;
  return trimmedArgs ? `${skillBlock}\n\nUser: ${trimmedArgs}` : skillBlock;
}

export default function (pi: ExtensionAPI) {
  pi.on("input", async (event) => {
    const text = event.text.trimStart();
    if (text === "/impeccable" || text.startsWith("/impeccable ")) {
      const args = text.slice("/impeccable".length).trim();
      return { action: "transform", text: expandImpeccable(args), images: event.images };
    }
    return { action: "continue" };
  });
}
