import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const MAX_FILES = 240;
const MAX_DEPTH = 4;
const MAX_SNIPPETS = 16;
const MAX_SNIPPET_CHARS = 4_000;
const MAX_TOTAL_SNIPPET_CHARS = 24_000;

const SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "sessions",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "secrets",
]);

const SENSITIVE_FILE_PATTERNS = [
  /^\.env(?:\..*)?$/i,
  /(?:^|\/)auth\.json$/i,
  /(?:^|\/)models\.json$/i,
  /(?:^|\/).*secret.*$/i,
  /\.(?:pem|key|p12|pfx|crt|cer)$/i,
];

export interface ProjectDocSnippet {
  path: string;
  text: string;
}

export interface ProjectSnapshot {
  cwd: string;
  files: string[];
  docSnippets: ProjectDocSnippet[];
  omittedFileCount: number;
}

export async function collectProjectSnapshot(cwd: string): Promise<ProjectSnapshot> {
  const root = path.resolve(cwd);
  const files: string[] = [];
  let omittedFileCount = 0;

  await walk(root, "", 0, files, () => {
    omittedFileCount += 1;
  });

  files.sort((a, b) => a.localeCompare(b));
  const docSnippets = await readDocSnippets(root, files);
  return { cwd: root, files, docSnippets, omittedFileCount };
}

async function walk(root: string, relativeDir: string, depth: number, files: string[], onOmitted: () => void): Promise<void> {
  if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;

  const absoluteDir = path.join(root, relativeDir);
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const relativePath = normalizePath(path.join(relativeDir, entry.name));
    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".superpowers")) continue;
      await walk(root, relativePath, depth + 1, files, onOmitted);
      continue;
    }

    if (!entry.isFile()) continue;
    if (isSensitive(relativePath)) continue;
    if (files.length >= MAX_FILES) {
      onOmitted();
      continue;
    }
    files.push(relativePath);
  }
}

async function readDocSnippets(root: string, files: readonly string[]): Promise<ProjectDocSnippet[]> {
  const snippets: ProjectDocSnippet[] = [];
  let total = 0;

  for (const file of files) {
    if (!isDocCandidate(file)) continue;
    if (snippets.length >= MAX_SNIPPETS || total >= MAX_TOTAL_SNIPPET_CHARS) break;

    try {
      const text = await readFile(path.join(root, file), "utf8");
      const snippet = text.slice(0, Math.min(MAX_SNIPPET_CHARS, MAX_TOTAL_SNIPPET_CHARS - total));
      if (!snippet.trim()) continue;
      snippets.push({ path: file, text: snippet });
      total += snippet.length;
    } catch {
      // Ignore unreadable or non-UTF8 files.
    }
  }

  return snippets;
}

function isDocCandidate(file: string): boolean {
  const lower = file.toLowerCase();
  if (lower === "readme.md" || lower === "package.json" || lower === "pyproject.toml" || lower === "cargo.toml") return true;
  if (lower.startsWith("docs/") && lower.endsWith(".md")) return true;
  if (lower.endsWith(".md") && file.split("/").length <= 2) return true;
  return false;
}

function isSensitive(relativePath: string): boolean {
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(relativePath));
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}
