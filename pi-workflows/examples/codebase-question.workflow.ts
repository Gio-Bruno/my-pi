import { codeSearchAgent, compact, prompt, readOnlyAgent, workflow } from "../src/index.js";
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

export default workflow("Codebase question", {
  description: "Search the codebase, compress the answer, validate it, and return the shortest useful response.",
  phases: ["question", "search", "validate"],
  concurrency: 2,
  // Optional guardrail when desired:
  // budget: { maxCostUsd: 2, maxTokens: 200_000, timeoutMs: 300_000 },
  agents: {
    searcher: codeSearchAgent("Answer with minimum tokens and strongest evidence.", {
      name: "codebase-searcher",
    }),
    validator: readOnlyAgent("Validate evidence and compress the final answer.", {
      name: "codebase-answer-validator",
    }),
  },

  async run($, args: Args = {}) {
    const question = await $.phase("question", () =>
      $.run("read question", () => {
        const q = args.question?.trim();
        if (!q) throw new Error('Provide a question with --json "{\\"question\\":\\"...\\"}"');
        return q;
      }),
    );

    const answer = await $.phase("search", () =>
      $.json(
        "searcher",
        SearchAnswerSchema,
        prompt`
          Question: ${question}

          Search the codebase and return the shortest complete answer. Include only the strongest evidence.
        `,
      ),
    );

    const validation = await $.phase("validate", () =>
      $.structured(
        "validator",
        ValidationSchema,
        prompt`
          Question:
          ${question}

          Candidate answer:
          ${compact(answer)}

          Validate against the codebase. If correct, preserve the answer but make it even shorter if possible. If incomplete, return a corrected short answer.
        `,
      ),
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
