import { stdin, stdout } from "node:process";
import { codeSearchAgent, compact, prompt, readOnlyAgent, workflow } from "../src/index.js";
import {
  ApproachSetSchema,
  ClarifyingQuestionSchema,
  ContextSummarySchema,
  DesignDraftSchema,
  ScopeAssessmentSchema,
  SpecReviewSchema,
  SpecRevisionSchema,
} from "./brainstorming/schemas.js";
import {
  approachChoiceLabels,
  normalizeArgs,
  requireIdea,
  selectApproachByLabel,
  summarizeClarifications,
  type BrainstormingArgs,
  type QuestionAnswer,
} from "./brainstorming/steps/input.js";
import { collectProjectSnapshot } from "./brainstorming/steps/project.js";
import { readPrompt } from "./brainstorming/steps/prompts.js";
import {
  buildSpecMarkdown,
  defaultCommitMessage,
  defaultSpecRelativePath,
  gitCommitCommand,
  resolveSpecPath,
  writeSpecFile,
} from "./brainstorming/steps/spec.js";

const SOURCE = "https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md";

const VISUAL_COMPANION_OFFER =
  "Some of what we're working on might be easier to explain if I can show it to you in a web browser. I can put together mockups, diagrams, comparisons, and other visuals as we go. This feature is still new and can be token-intensive. Want to try it? (Requires opening a local URL)";

export default workflow("Brainstorming design", {
  description:
    "Interactively turns an idea into an approved design spec using the Superpowers brainstorming flow before implementation planning.",
  phases: ["input", "inspect", "scope", "visual", "clarify", "approaches", "design", "write", "validate", "review", "report"],
  budget: { timeoutMs: 1_800_000 },
  agents: {
    context: codeSearchAgent("Explore current project context before any design work. Read only; do not modify files.", {
      name: "brainstorming-context",
    }),
    designer: readOnlyAgent(
      "Act as a collaborative product and technical designer. Do not implement. Ask one question at a time, prefer concise multiple-choice options, and keep designs scoped for a single implementation plan.",
      { name: "brainstorming-designer", thinkingLevel: "medium" },
    ),
    reviewer: readOnlyAgent(
      "Review written design specs for placeholders, contradictions, scope creep, and ambiguous requirements. Do not implement.",
      { name: "brainstorming-spec-reviewer" },
    ),
  },

  async run($, args: BrainstormingArgs = {}) {
    const prompts = {
      context: readPrompt("context"),
      scope: readPrompt("scope"),
      clarifyingQuestion: readPrompt("clarifying-question"),
      approaches: readPrompt("approaches"),
      design: readPrompt("design"),
      specReview: readPrompt("spec-review"),
    };

    const preparedInput = await $.phase("input", async () => {
      const normalized = normalizeArgs(args);
      if (normalized.idea) return normalized;

      const idea = await $.ask("What idea should we brainstorm into a design/spec?", {
        id: "brainstorming-idea",
        default: "",
      });
      return normalizeArgs({ ...args, idea });
    });

    if (!preparedInput.idea) {
      return $.phase("report", () =>
        $.run("missing idea", () => ({
          status: "missing-input",
          source: SOURCE,
          message: "Provide an idea before running the brainstorming workflow.",
          example: `/workflow brainstorming --json '{"idea":"Design the feature/change you want to brainstorm"}'`,
          budget: $.budget.usage,
        })),
      );
    }

    const input = requireIdea(preparedInput);

    const inspected = await $.phase("inspect", async () => {
      const fsSnapshot = await $.run("collect project files and docs", () => collectProjectSnapshot($.cwd));
      const gitSnapshot = await $.sh(
        "recent git context",
        "git status --short 2>/dev/null; printf '\nRecent commits:\n'; git log --oneline -5 2>/dev/null",
        { rejectOnFailure: false, timeoutMs: 30_000 },
      );

      const context = await $.structured(
        "context",
        ContextSummarySchema,
        prompt`
          ${prompts.context}

          Source skill: ${SOURCE}
          User idea:
          ${input.idea}

          Deterministic filesystem snapshot:
          ${compact(fsSnapshot)}

          Git snapshot:
          ${gitSnapshot.output.slice(0, 12_000)}
        `,
      );

      return { fsSnapshot, gitSnapshot: gitSnapshot.output.slice(0, 12_000), context };
    });

    const scopeAssessment = await $.phase("scope", () =>
      $.structured(
        "designer",
        ScopeAssessmentSchema,
        prompt`
          ${prompts.scope}

          User idea:
          ${input.idea}

          Project context:
          ${compact(inspected.context)}
        `,
      ),
    );

    let scopedIdea = input.idea;
    let selectedSubproject: string | undefined;
    if (scopeAssessment.status === "needs-decomposition" && scopeAssessment.subprojects.length > 0) {
      const subprojectChoices = scopeAssessment.subprojects.map((subproject) => `${subproject.name} — ${subproject.description}`);
      const defaultSubproject =
        subprojectChoices.find((choice) => choice.startsWith(`${scopeAssessment.suggestedFirstSubproject ?? ""} —`)) ??
        subprojectChoices[0];

      selectedSubproject = await $.phase("scope", () =>
        $.choose("This looks too large for one spec. Which sub-project should we brainstorm first?", subprojectChoices, {
          id: "brainstorming-subproject",
          details: scopeAssessment.rationale,
          default: defaultSubproject,
        }),
      );

      const selected = scopeAssessment.subprojects.find(
        (subproject) => selectedSubproject?.startsWith(`${subproject.name} —`) || selectedSubproject === subproject.name,
      );
      scopedIdea = `${input.idea}\n\nFocus this workflow on the first sub-project: ${selected?.name ?? selectedSubproject}\n${
        selected?.description ?? ""
      }`;
    }

    const visual = await $.phase("visual", async () => {
      const shouldOffer = input.visualCompanion === "offer" || (input.visualCompanion === "auto" && scopeAssessment.visualQuestionsLikely);
      if (!shouldOffer) {
        return {
          offered: false,
          accepted: false,
          note: "Visual companion was not offered because the workflow did not detect upcoming visual questions.",
        };
      }

      const accepted = await $.confirm(VISUAL_COMPANION_OFFER, {
        id: "brainstorming-visual-companion",
        default: false,
      });

      return {
        offered: true,
        accepted,
        note: accepted
          ? "User consented to visual support. This portable workflow records the consent; use an external visual companion integration for browser mockups/diagrams when available, otherwise continue text-only."
          : "User declined visual support; continue text-only.",
      };
    });

    const clarifications = await $.phase("clarify", async () => {
      const answers: QuestionAnswer[] = [];

      for (let index = 0; index < input.maxQuestions; index += 1) {
        const next = await $.structured(
          "designer",
          ClarifyingQuestionSchema,
          prompt`
            ${prompts.clarifyingQuestion}

            Scoped idea:
            ${scopedIdea}

            Project context:
            ${compact(inspected.context)}

            Scope assessment:
            ${compact(scopeAssessment)}

            Visual companion status:
            ${compact(visual)}

            Answers so far:
            ${summarizeClarifications(answers)}
          `,
        );

        if (next.done || !next.question.trim()) break;

        const choices = next.choices.map((choice) => choice.trim()).filter(Boolean).slice(0, 6);
        const questionText = choices.length
          ? `${next.question}\n\nOptions:\n${choices.map((choice) => `- ${choice}`).join("\n")}`
          : next.question;

        const answer = await $.ask(questionText, {
          id: `brainstorming-clarify-${index + 1}`,
          details: next.rationale,
          default: next.defaultAnswer ?? "",
        });

        answers.push({
          question: next.question.trim(),
          answer: answer.trim() || next.defaultAnswer?.trim() || "(no answer provided)",
        });
      }

      return answers;
    });

    const approachSet = await $.phase("approaches", () =>
      $.structured(
        "designer",
        ApproachSetSchema,
        prompt`
          ${prompts.approaches}

          Scoped idea:
          ${scopedIdea}

          Project context:
          ${compact(inspected.context)}

          Clarifying answers:
          ${summarizeClarifications(clarifications)}
        `,
      ),
    );

    const selectedApproach = await $.phase("approaches", async () => {
      const labels = approachChoiceLabels(approachSet);
      if (labels.length === 0) throw new Error("The approaches agent returned no approaches.");
      const defaultChoice = labels.find((label) => label.startsWith(`${approachSet.recommendationId} —`)) ?? labels[0];
      const choice = await $.choose("Which approach should the design use?", labels, {
        id: "brainstorming-approach",
        details: compact(approachSet),
        default: defaultChoice,
      });
      return selectApproachByLabel(approachSet, choice);
    });

    const designResult = await $.phase("design", async () => {
      let draft = await $.structured(
        "designer",
        DesignDraftSchema,
        prompt`
          ${prompts.design}

          Scoped idea:
          ${scopedIdea}

          Project context:
          ${compact(inspected.context)}

          Clarifying answers:
          ${summarizeClarifications(clarifications)}

          Selected approach:
          ${compact(selectedApproach)}
        `,
      );

      const feedback: string[] = [];
      for (let pass = 0; pass < 3; pass += 1) {
        let rejected: { heading: string; reason?: string } | undefined;

        for (const section of draft.sections) {
          const approval = await $.approve(`Design section: ${section.heading}`, {
            id: `brainstorming-design-${pass + 1}-${section.heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`,
            details: section.content,
            default: canPromptHuman() ? true : false,
          });

          if (!approval.approved) {
            rejected = { heading: section.heading, reason: approval.reason };
            break;
          }
        }

        if (!rejected) return { draft, feedback, approved: true, warning: undefined };

        if (!canPromptHuman() && !rejected.reason?.trim()) {
          return {
            draft,
            feedback,
            approved: false,
            warning: "Design draft generated, but the workflow stopped before writing a spec because stdin is non-interactive and design approval is required.",
          };
        }

        const changeRequest =
          rejected.reason?.trim() ||
          (await $.ask(`What should change in "${rejected.heading}" before I present the design again?`, {
            id: `brainstorming-design-feedback-${pass + 1}`,
            default: "",
          }));
        if (!changeRequest.trim()) {
          return { draft, feedback, approved: false, warning: "Design was rejected, but no change request was provided." };
        }
        feedback.push(`${rejected.heading}: ${changeRequest}`);

        draft = await $.structured(
          "designer",
          DesignDraftSchema,
          prompt`
            Revise the design draft to address the user's feedback, then return the complete updated design.

            Original scoped idea:
            ${scopedIdea}

            Selected approach:
            ${compact(selectedApproach)}

            Previous draft:
            ${compact(draft)}

            Feedback:
            ${feedback.join("\n")}
          `,
        );
      }

      return { draft, feedback, approved: false, warning: "Design reached the revision limit; review the latest draft before writing the spec." };
    });

    if (!designResult.approved) {
      return $.phase("report", () =>
        $.run("design review pending", () => ({
          status: "needs-design-review",
          source: SOURCE,
          scopedIdea,
          selectedSubproject,
          selectedApproach,
          clarifications,
          design: designResult.draft,
          nextAction: "Review and approve the generated design before writing the spec or implementation plan.",
          warning: designResult.warning,
          budget: $.budget.usage,
        })),
      );
    }

    let specState = await $.phase("write", async () => {
      const target = resolveSpecPath($.cwd, input.specPath ?? defaultSpecRelativePath());
      const markdown = buildSpecMarkdown({
        source: SOURCE,
        idea: input.idea,
        scopedIdea,
        selectedSubproject,
        context: inspected.context,
        scope: scopeAssessment,
        visual,
        clarifications,
        selectedApproach,
        design: designResult.draft,
        designFeedback: designResult.feedback,
      });
      const written = await $.run("write initial spec", () => writeSpecFile(target, markdown));
      return { target, markdown, written };
    });

    const validation = await $.phase("validate", async () => {
      const review = await $.structured(
        "reviewer",
        SpecReviewSchema,
        prompt`
          ${prompts.specReview}

          Current spec markdown:
          ${specState.markdown}
        `,
      );

      const reviewedMarkdown = review.revisedSpecMarkdown.trim() ? review.revisedSpecMarkdown : specState.markdown;
      if (reviewedMarkdown.trim() !== specState.markdown.trim()) {
        const written = await $.run("apply self-review fixes", () => writeSpecFile(specState.target, reviewedMarkdown));
        specState = { ...specState, markdown: reviewedMarkdown, written };
      }

      return { review, finalMarkdown: specState.markdown };
    });

    const reviewResult = await $.phase("review", async () => {
      const commits: string[] = [];

      if (!input.skipCommit) {
        const commit = await $.sh(
          "commit spec",
          gitCommitCommand(specState.target.relativePath, input.commitMessage ?? defaultCommitMessage(specState.target.relativePath)),
          { rejectOnFailure: false, timeoutMs: 60_000 },
        );
        commits.push(commit.ok ? commit.output.trim() || "Committed spec." : `Commit failed or was skipped: ${commit.output.trim()}`);
      }

      for (let round = 0; round < 3; round += 1) {
        const approval = await $.approve(
          `Spec written${input.skipCommit ? "" : " and commit attempted"} to ${specState.target.relativePath}. Please review it and let me know if you want to make any changes before we start writing out the implementation plan.`,
          {
            id: `brainstorming-spec-review-${round + 1}`,
            details: {
              path: specState.target.relativePath,
              selfReview: validation.review,
              commit: commits.at(-1) ?? "Commit skipped by input option.",
            },
            default: false,
          },
        );

        if (approval.approved) {
          return { approved: true, revisionRounds: round, commits };
        }

        if (!canPromptHuman() && !approval.reason?.trim()) {
          return {
            approved: false,
            revisionRounds: round,
            commits,
            reason: `Spec review is pending human approval, but stdin is non-interactive. Review ${specState.target.relativePath} before invoking writing-plans.`,
          };
        }

        const changeRequest =
          approval.reason?.trim() ||
          (await $.ask("What changes should I make to the spec before implementation planning?", {
            id: `brainstorming-spec-change-${round + 1}`,
            default: "",
          }));

        if (!changeRequest.trim()) {
          return { approved: false, revisionRounds: round, commits, reason: "Spec was not approved, but no change request was provided." };
        }

        const revision = await $.structured(
          "designer",
          SpecRevisionSchema,
          prompt`
            Revise the written spec according to the user's requested changes. Return the full revised markdown.

            Current spec path: ${specState.target.relativePath}
            Current spec markdown:
            ${specState.markdown}

            Requested changes:
            ${changeRequest}
          `,
        );

        const revisedMarkdown = revision.revisedSpecMarkdown.trim();
        if (!revisedMarkdown) {
          return { approved: false, revisionRounds: round, commits, reason: "Revision produced empty markdown." };
        }

        const written = await $.run("write requested spec changes", () => writeSpecFile(specState.target, revisedMarkdown));
        specState = { ...specState, markdown: revisedMarkdown, written };

        if (!input.skipCommit) {
          const commit = await $.sh(
            `commit requested spec changes ${round + 1}`,
            gitCommitCommand(specState.target.relativePath, `Revise design spec ${specState.target.relativePath}`),
            { rejectOnFailure: false, timeoutMs: 60_000 },
          );
          commits.push(commit.ok ? commit.output.trim() || "Committed requested spec changes." : `Commit failed or was skipped: ${commit.output.trim()}`);
        }
      }

      return { approved: false, revisionRounds: 3, commits, reason: "Spec review loop reached its revision limit." };
    });

    return $.phase("report", () =>
      $.run("summarize outcome", () => ({
        status: reviewResult.approved ? "ready-for-writing-plans" : "needs-spec-review",
        source: SOURCE,
        specPath: specState.target.relativePath,
        selectedSubproject,
        selectedApproach,
        clarifications,
        selfReviewPassed: validation.review.passes,
        reviewResult,
        nextAction: reviewResult.approved
          ? "Invoke the writing-plans skill/workflow next. Do not start implementation directly."
          : "Resolve the remaining spec review feedback before writing an implementation plan.",
        warning: designResult.warning,
        budget: $.budget.usage,
      })),
    );
  },
});

function canPromptHuman(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}
