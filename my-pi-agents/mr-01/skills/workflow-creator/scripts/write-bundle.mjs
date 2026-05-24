#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, unlink, writeFile, lstat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `Usage:
  node write-bundle.mjs --manifest manifest.json [--force]
  WORKFLOW_CREATOR_ALLOW_CUSTOM_ROOT=1 node write-bundle.mjs --manifest manifest.json --workflows-root path

Manifest shape:
  {
    "slug": "my-workflow",
    "name": "My workflow",
    "source": "optional source path or URL",
    "files": [
      { "path": "my-workflow.workflow.ts", "content": "..." },
      { "path": "my-workflow/prompts/decide.md", "content": "..." }
    ]
  }
`;

const args = parseArgs(process.argv.slice(2));
if (!args.manifest) die(USAGE);

if (args.workflowsRoot && process.env.WORKFLOW_CREATOR_ALLOW_CUSTOM_ROOT !== "1") {
  die("--workflows-root is reserved for tests. Set WORKFLOW_CREATOR_ALLOW_CUSTOM_ROOT=1 to use it.");
}

const manifestPath = resolve(args.manifest);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const slug = validateSlug(manifest.slug);
const force = Boolean(args.force ?? manifest.force);
const workflowsRoot = args.workflowsRoot
  ? resolve(args.workflowsRoot)
  : join(findRepoRoot(process.cwd()) ?? findRepoRoot(dirname(fileURLToPath(import.meta.url))) ?? process.cwd(), "pi-workflows", "workflows");

if (!existsSync(workflowsRoot)) {
  await mkdir(workflowsRoot, { recursive: true });
}

const workflowPath = join(workflowsRoot, `${slug}.workflow.ts`);
const assetDir = join(workflowsRoot, slug);
const bundleExists = existsSync(workflowPath) || existsSync(assetDir);

if (bundleExists && !force) {
  die(`Workflow bundle already exists for slug "${slug}". Re-run with --force to overwrite.`);
}

const files = validateFiles(manifest.files, slug, workflowsRoot);
const manifestFile = {
  path: `${slug}/manifest.json`,
  content: JSON.stringify(
    {
      slug,
      name: typeof manifest.name === "string" ? manifest.name : slug,
      source: typeof manifest.source === "string" ? manifest.source : undefined,
      files: files.map((file) => file.path),
    },
    null,
    2,
  ) + "\n",
};

const allFiles = [...files, validateFile(manifestFile, slug, workflowsRoot)];

if (force) {
  await removeIfExists(workflowPath);
  await removeIfExists(assetDir);
}

const written = [];
for (const file of allFiles) {
  await mkdir(dirname(file.absolutePath), { recursive: true });
  await writeFile(file.absolutePath, file.content, "utf8");
  written.push(file.relativePath);
}

console.log(JSON.stringify({ ok: true, slug, workflowsRoot, written }, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") {
      parsed.force = true;
    } else if (arg === "--manifest") {
      parsed.manifest = requireValue(argv, ++i, arg);
    } else if (arg === "--workflows-root") {
      parsed.workflowsRoot = requireValue(argv, ++i, arg);
    } else if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      process.exit(0);
    } else {
      die(`Unknown argument: ${arg}\n\n${USAGE}`);
    }
  }
  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) die(`${flag} requires a value.`);
  return value;
}

function validateSlug(value) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    die(`Invalid slug ${JSON.stringify(value)}. Use lowercase letters, numbers, and dashes; start with a letter or number.`);
  }
  if (value === "fixtures") die('Slug "fixtures" is reserved.');
  return value;
}

function validateFiles(value, slug, root) {
  if (!Array.isArray(value) || value.length === 0) die("manifest.files must be a non-empty array.");
  const seen = new Set();
  return value.map((file) => {
    const validated = validateFile(file, slug, root);
    if (seen.has(validated.relativePath)) die(`Duplicate file path in manifest: ${validated.relativePath}`);
    seen.add(validated.relativePath);
    return validated;
  });
}

function validateFile(file, slug, root) {
  if (!file || typeof file !== "object") die("Each manifest file must be an object.");
  const relativePath = normalizeRelativePath(file.path);
  if (typeof file.content !== "string") die(`File ${relativePath} content must be a string.`);

  const allowedWorkflow = `${slug}.workflow.ts`;
  const allowedPrefix = `${slug}/`;
  if (relativePath !== allowedWorkflow && !relativePath.startsWith(allowedPrefix)) {
    die(`File path ${relativePath} must be ${allowedWorkflow} or live under ${allowedPrefix}`);
  }

  if (relativePath.endsWith("/") || relativePath.includes("//")) die(`Invalid file path: ${relativePath}`);
  if (relativePath.split("/").some((part) => part === "." || part === ".." || part === "")) {
    die(`Invalid file path segment: ${relativePath}`);
  }

  const absolutePath = resolve(root, relativePath);
  assertInside(root, absolutePath, relativePath);
  return { relativePath, path: relativePath, absolutePath, content: file.content };
}

function normalizeRelativePath(value) {
  if (typeof value !== "string" || value.trim() === "") die("File path must be a non-empty string.");
  if (value.includes("\0")) die("File path contains a NUL byte.");
  if (value.includes("\\")) die(`Use forward slashes in file paths: ${value}`);
  if (isAbsolute(value)) die(`File path must be relative: ${value}`);
  return value.replace(/^\.\//, "");
}

function assertInside(root, target, display) {
  const resolvedRoot = resolve(root);
  const rel = target.slice(resolvedRoot.length);
  if (target !== resolvedRoot && !rel.startsWith(sep)) {
    die(`Refusing to write outside workflows root: ${display}`);
  }
}

async function removeIfExists(path) {
  if (!existsSync(path)) return;
  const stat = await lstat(path);
  if (stat.isDirectory() && !stat.isSymbolicLink()) await rm(path, { recursive: true, force: true });
  else await unlink(path);
}

function findRepoRoot(start) {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, "pi-workflows", "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function die(message) {
  console.error(message);
  process.exit(1);
}
