import { readFileSync } from "node:fs";

export function readPrompt(name: string): string {
  if (!/^[a-z0-9-]+$/i.test(name)) throw new Error(`Invalid prompt name: ${name}`);
  return readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), "utf8").trim();
}
