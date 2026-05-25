import type { Approach, ApproachSet } from "../schemas.js";

export interface BrainstormingArgs {
  /** Alias accepted by generic workflow launchers. */
  input?: string;
  /** The idea, change, feature, or behavior to brainstorm. */
  idea?: string;
  /** Optional repository-relative spec path. Defaults to docs/superpowers/specs/YYYY-MM-DD--design.md. */
  specPath?: string;
  /** Maximum one-at-a-time clarifying questions. Defaults to 6, clamped to 1..12. */
  maxQuestions?: number;
  /** Skip git add/commit for the written spec. */
  skipCommit?: boolean;
  /** auto = offer only when visual questions are likely; offer = always offer; never = never offer. */
  visualCompanion?: "auto" | "offer" | "never";
  /** Optional commit message for the initial spec commit. */
  commitMessage?: string;
}

export interface NormalizedBrainstormingArgs {
  idea?: string;
  specPath?: string;
  maxQuestions: number;
  skipCommit: boolean;
  visualCompanion: "auto" | "offer" | "never";
  commitMessage?: string;
}

export interface ReadyBrainstormingArgs extends NormalizedBrainstormingArgs {
  idea: string;
}

export interface QuestionAnswer {
  question: string;
  answer: string;
}

export function normalizeArgs(args: BrainstormingArgs = {}): NormalizedBrainstormingArgs {
  return {
    idea: firstText(args.idea, args.input),
    specPath: cleanText(args.specPath),
    maxQuestions: clampInteger(args.maxQuestions ?? 6, 1, 12),
    skipCommit: args.skipCommit === true,
    visualCompanion: normalizeVisualCompanion(args.visualCompanion),
    commitMessage: cleanText(args.commitMessage),
  };
}

export function requireIdea(args: NormalizedBrainstormingArgs): ReadyBrainstormingArgs {
  const idea = cleanText(args.idea);
  if (!idea) throw new Error('Provide an idea with --json "{\"idea\":\"...\"}" or answer the workflow prompt.');
  return { ...args, idea };
}

export function summarizeClarifications(answers: readonly QuestionAnswer[]): string {
  if (answers.length === 0) return "No clarifying answers yet.";
  return answers.map((item, index) => `${index + 1}. Q: ${item.question}\n   A: ${item.answer}`).join("\n");
}

export function approachChoiceLabels(set: ApproachSet): string[] {
  return set.approaches.map((approach) => `${approach.id} — ${approach.title}`);
}

export function selectApproachByLabel(set: ApproachSet, label: string): Approach {
  const id = label.split(" — ")[0]?.trim();
  return set.approaches.find((approach) => approach.id === id) ?? set.approaches[0];
}

function firstText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return undefined;
}

function cleanText(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function normalizeVisualCompanion(value: BrainstormingArgs["visualCompanion"]): "auto" | "offer" | "never" {
  if (value === "offer" || value === "never") return value;
  return "auto";
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
