import { Type, type Static } from "typebox";

export const ImportantFileSchema = Type.Object({
  path: Type.String({ description: "Repository-relative path." }),
  relevance: Type.String({ description: "Why this file matters for the design." }),
});

export const ContextSummarySchema = Type.Object({
  projectType: Type.String({ description: "Short description of the project or stack." }),
  importantFiles: Type.Array(ImportantFileSchema),
  existingPatterns: Type.Array(Type.String({ description: "Patterns the design should follow." })),
  recentActivity: Type.Array(Type.String({ description: "Relevant recent commits or working-tree signals." })),
  constraints: Type.Array(Type.String({ description: "Technical, product, repo, or process constraints." })),
  questionsRaisedByCodebase: Type.Array(Type.String({ description: "Questions suggested by current code/docs." })),
});

export const SubprojectSchema = Type.Object({
  name: Type.String(),
  description: Type.String(),
  dependencies: Type.Array(Type.String()),
});

export const ScopeAssessmentSchema = Type.Object({
  status: Type.Union([Type.Literal("single-spec"), Type.Literal("needs-decomposition")]),
  rationale: Type.String(),
  visualQuestionsLikely: Type.Boolean(),
  suggestedFirstSubproject: Type.Optional(Type.String()),
  subprojects: Type.Array(SubprojectSchema),
});

export const ClarifyingQuestionSchema = Type.Object({
  done: Type.Boolean({ description: "True only when enough information exists to propose approaches." }),
  question: Type.String({ description: "Exactly one clarifying question. Empty when done is true." }),
  choices: Type.Array(Type.String({ description: "Concise multiple-choice options when helpful." })),
  rationale: Type.String({ description: "Why this question matters." }),
  defaultAnswer: Type.Optional(Type.String({ description: "Optional safe default or likely answer." })),
});

export const ApproachSchema = Type.Object({
  id: Type.String({ description: "Short stable id such as A, B, or C." }),
  title: Type.String(),
  summary: Type.String(),
  tradeoffs: Type.Array(Type.String()),
  risks: Type.Array(Type.String()),
});

export const ApproachSetSchema = Type.Object({
  recommendationId: Type.String({ description: "id of the recommended approach." }),
  approaches: Type.Array(ApproachSchema),
});

export const DesignSectionSchema = Type.Object({
  heading: Type.String(),
  content: Type.String({ description: "Clear design text scaled to section complexity; avoid implementation steps." }),
});

export const DesignDraftSchema = Type.Object({
  title: Type.String(),
  summary: Type.String(),
  sections: Type.Array(DesignSectionSchema),
  acceptanceCriteria: Type.Array(Type.String()),
  testingStrategy: Type.Array(Type.String()),
  errorHandling: Type.Array(Type.String()),
  implementationHandoff: Type.String({ description: "What writing-plans should receive next." }),
});

export const SpecIssueSchema = Type.Object({
  category: Type.Union([
    Type.Literal("placeholder"),
    Type.Literal("consistency"),
    Type.Literal("scope"),
    Type.Literal("ambiguity"),
    Type.Literal("other"),
  ]),
  severity: Type.Union([Type.Literal("minor"), Type.Literal("major")]),
  description: Type.String(),
  fix: Type.String(),
});

export const SpecReviewSchema = Type.Object({
  passes: Type.Boolean(),
  issues: Type.Array(SpecIssueSchema),
  revisedSpecMarkdown: Type.String({ description: "The complete revised spec markdown. Return the original markdown if no fixes are needed." }),
});

export const SpecRevisionSchema = Type.Object({
  changeSummary: Type.String(),
  revisedSpecMarkdown: Type.String({ description: "The complete revised spec markdown after applying requested changes." }),
});

export type ImportantFile = Static<typeof ImportantFileSchema>;
export type ContextSummary = Static<typeof ContextSummarySchema>;
export type Subproject = Static<typeof SubprojectSchema>;
export type ScopeAssessment = Static<typeof ScopeAssessmentSchema>;
export type ClarifyingQuestion = Static<typeof ClarifyingQuestionSchema>;
export type Approach = Static<typeof ApproachSchema>;
export type ApproachSet = Static<typeof ApproachSetSchema>;
export type DesignSection = Static<typeof DesignSectionSchema>;
export type DesignDraft = Static<typeof DesignDraftSchema>;
export type SpecIssue = Static<typeof SpecIssueSchema>;
export type SpecReview = Static<typeof SpecReviewSchema>;
export type SpecRevision = Static<typeof SpecRevisionSchema>;
