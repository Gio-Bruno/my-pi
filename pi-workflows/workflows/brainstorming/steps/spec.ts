import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Approach, ContextSummary, DesignDraft, ScopeAssessment } from "../schemas.js";
import type { QuestionAnswer } from "./input.js";

export interface VisualDecision {
  offered: boolean;
  accepted: boolean;
  note: string;
}

export interface BuildSpecInput {
  source: string;
  idea: string;
  scopedIdea: string;
  selectedSubproject?: string;
  context: ContextSummary;
  scope: ScopeAssessment;
  visual: VisualDecision;
  clarifications: readonly QuestionAnswer[];
  selectedApproach: Approach;
  design: DesignDraft;
  designFeedback: readonly string[];
}

export interface ResolvedSpecPath {
  absolutePath: string;
  relativePath: string;
}

export interface WriteSpecResult extends ResolvedSpecPath {
  bytes: number;
}

export function defaultSpecRelativePath(date = new Date()): string {
  return `docs/superpowers/specs/${date.toISOString().slice(0, 10)}--design.md`;
}

export function resolveSpecPath(cwd: string, requestedPath: string): ResolvedSpecPath {
  const root = path.resolve(cwd);
  const absolutePath = path.resolve(root, requestedPath);
  const relativePath = path.relative(root, absolutePath);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Spec path must resolve inside the workflow cwd: ${requestedPath}`);
  }

  return { absolutePath, relativePath: normalizePath(relativePath) };
}

export async function writeSpecFile(target: ResolvedSpecPath, markdown: string): Promise<WriteSpecResult> {
  const content = ensureTrailingNewline(markdown);
  await mkdir(path.dirname(target.absolutePath), { recursive: true });
  await writeFile(target.absolutePath, content, "utf8");
  return { ...target, bytes: Buffer.byteLength(content, "utf8") };
}

export function defaultCommitMessage(relativePath: string): string {
  return `Add design spec ${relativePath}`;
}

export function gitCommitCommand(relativePath: string, message: string): string {
  return `git add -- ${shellQuote(relativePath)} && git commit -m ${shellQuote(message)}`;
}

export function buildSpecMarkdown(input: BuildSpecInput): string {
  const selectedApproach = input.selectedApproach;
  const design = input.design;

  return ensureTrailingNewline(`# ${design.title || "Design"}

_Source: ${input.source}_

_Generated: ${new Date().toISOString()}_

## Original idea

${input.idea.trim()}

## Scoped goal

${input.scopedIdea.trim()}
${input.selectedSubproject ? `\n\nSelected first sub-project: ${input.selectedSubproject}` : ""}

## Project context

Project type: ${input.context.projectType}

### Important files

${formatFileList(input.context.importantFiles)}

### Existing patterns to follow

${formatList(input.context.existingPatterns)}

### Recent activity

${formatList(input.context.recentActivity)}

### Constraints

${formatList(input.context.constraints)}

## Scope assessment

Status: ${input.scope.status}

${input.scope.rationale}

${input.scope.subprojects.length > 0 ? `### Decomposition notes\n\n${input.scope.subprojects
    .map((subproject) => `- **${subproject.name}** — ${subproject.description}${subproject.dependencies.length ? ` Dependencies: ${subproject.dependencies.join(", ")}.` : ""}`)
    .join("\n")}` : ""}

## Visual companion

- Offered: ${input.visual.offered ? "yes" : "no"}
- Accepted: ${input.visual.accepted ? "yes" : "no"}
- Notes: ${input.visual.note}

## Clarifying answers

${formatQuestionAnswers(input.clarifications)}

## Selected approach

### ${selectedApproach.id}: ${selectedApproach.title}

${selectedApproach.summary}

#### Trade-offs

${formatList(selectedApproach.tradeoffs)}

#### Risks

${formatList(selectedApproach.risks)}

## Design summary

${design.summary}

${design.sections.map((section) => `## ${section.heading}\n\n${section.content.trim()}`).join("\n\n")}

## Acceptance criteria

${formatList(design.acceptanceCriteria)}

## Error handling

${formatList(design.errorHandling)}

## Testing strategy

${formatList(design.testingStrategy)}

## Design review feedback addressed

${formatList(input.designFeedback, "- No design-section revisions requested.")}

## Implementation handoff

${design.implementationHandoff}

Do not start implementation directly from this document. Invoke the writing-plans skill/workflow next to create a detailed implementation plan.
`);
}

function formatList(items: readonly string[], fallback = "- None."): string {
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length === 0) return fallback;
  return cleaned.map((item) => `- ${indentContinuation(item)}`).join("\n");
}

function formatFileList(files: readonly { path: string; relevance: string }[]): string {
  if (files.length === 0) return "- None identified.";
  return files.map((file) => `- \`${file.path}\` — ${indentContinuation(file.relevance)}`).join("\n");
}

function formatQuestionAnswers(answers: readonly QuestionAnswer[]): string {
  if (answers.length === 0) return "- No clarifying questions were needed.";
  return answers.map((item) => `- **${item.question}**\n  ${indentContinuation(item.answer)}`).join("\n");
}

function indentContinuation(value: string): string {
  return value.trim().replace(/\n/g, "\n  ");
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}
