import { pathToFileURL } from "node:url";
import { defineWorkflow, inlineProfile, json, runWorkflow, structured } from "../src/index.js";
import { Type } from "typebox";

const SearchAnswerSchema = Type.Object({
  answer: Type.String({ description: "Shortest complete answer possible, ideally <= 120 words." }),
  evidence: Type.Array(
    Type.Object({
      file: Type.String(),
      reason: Type.String(),
    }),
    { description: "Only the strongest code references needed to support the answer." },
  ),
  uncertainty: Type.Optional(Type.String()),
});

const ValidationSchema = Type.Object({
  status: Type.String({ description: "PASS or CONCERN" }),
  finalAnswer: Type.String({ description: "Final shortest complete answer, <= 120 words if possible." }),
  concerns: Type.Array(Type.String()),
});

interface Args {
  question?: string;
}

const workflow = defineWorkflow({
  meta: {
    name: "Codebase question",
    description: "Search the codebase, compress the answer, validate it, and return the shortest useful response.",
    phases: ["question", "search", "validate"],
  },
  profiles: {
    searcher: inlineProfile({
      name: "codebase-searcher",
      tools: ["read", "grep", "find", "ls", "bash"],
      thinkingLevel: "low",
      instructions: `You are a codebase search agent. Use read-only tools to answer the user's question.
Optimize for minimum output tokens while preserving key evidence.
Prefer file paths and specific symbols over long prose.
Do not edit files.`,
    }),
    validator: inlineProfile({
      name: "codebase-answer-validator",
      tools: ["read", "grep", "find", "ls"],
      thinkingLevel: "low",
      instructions: `You validate concise codebase answers against the repository.
Check that cited files support the answer and that important caveats are not omitted.
Return the shortest corrected answer possible. Do not edit files.`,
    }),
  },
  defaults: {
    concurrency: 2,
    budget: { maxCostUsd: 2, maxTokens: 200_000, timeoutMs: 300_000 },
  },

  async run($, args: Args = {}) {
    const question = await $.run("read question", () => {
      const q = args.question?.trim() || argsToQuestion(process.argv.slice(2));
      if (!q) {
        throw new Error('Provide a question with --json "{\\"question\\":\\"...\\"}"');
      }
      return q;
    });

    $.phaseLog.start("search", "codebase search and compression");
    const answer = await $.agent(
      "searcher",
      `Question: ${question}

Search the codebase and return the shortest complete answer. Include only the strongest evidence.`,
      { output: json(SearchAnswerSchema) },
    );

    $.phaseLog.start("validate", "verify concise answer");
    const validation = await $.agent(
      "validator",
      `Question:
${question}

Candidate answer:
${JSON.stringify(answer, null, 2)}

Validate against the codebase. If correct, preserve the answer but make it even shorter if possible. If incomplete, return a corrected short answer.`,
      { output: structured(ValidationSchema) },
    );

    return {
      status: validation.status,
      answer: validation.finalAnswer,
      concerns: validation.concerns,
      evidence: answer.evidence,
      uncertainty: answer.uncertainty,
      budget: $.budget.usage,
    };
  },
});

export default workflow;

function argsToQuestion(argv: string[]): string {
  const marker = argv.indexOf("--question");
  if (marker >= 0) return argv.slice(marker + 1).join(" ").trim();
  return "";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runWorkflow(workflow, { args: {} });
}
