import { compact, profile, prompt, workflow, type ShellResult } from "../src/index.js";
import { Type } from "typebox";

const TriageSchema = Type.Object({
  failedFiles: Type.Array(Type.String()),
  likelyCause: Type.String(),
  suggestedFocus: Type.Array(Type.String()),
});

const FindingSchema = Type.Object({
  file: Type.String(),
  finding: Type.String(),
  confidence: Type.String(),
});

const ReviewSchema = Type.Object({
  status: Type.String({ description: "PASS or CONCERN" }),
  notes: Type.Array(Type.String()),
});

interface Args {
  maxLoops?: number;
}

export default workflow("Fix failing tests", {
  description: "Run tests, triage failures, fix, validate, and review the final diff.",
  phases: ["test", "triage", "fix", "validate", "review"],
  maxIterations: 2,
  concurrency: 3,
  budget: { maxCostUsd: 3, maxTokens: 300_000 },
  agents: {
    scout: profile("test-scout"),
    fixer: profile("test-fixer"),
    reviewer: profile("test-reviewer"),
  },

  async run($, args: Args = {}) {
    const maxLoops = args.maxLoops ?? $.defaults.maxIterations;
    let lastTest: ShellResult | undefined;
    let triage: unknown;

    for (let loop = 1; loop <= maxLoops; loop++) {
      lastTest = await $.phase("test", () => $.sh(`unit tests ${loop}/${maxLoops}`, "npm test -- --runInBand"));
      if (lastTest.ok) break;

      const failure = lastTest.output.slice(-40_000);

      const parsed = await $.phase("triage", () => $.run("parse failure output", () => parseFailureOutput(failure)));

      triage = await $.phase("triage", () => $.json("scout", TriageSchema, makeTriagePrompt(failure, parsed)));

      // Pipeline example: each failed file is analyzed by scout, then reviewed by reviewer
      // as soon as its scout result is ready. Keep this read-only.
      if (parsed.failedFiles.length > 0) {
        await $.phase("triage", () =>
          $.pipeline("read-only per-file scout/review", parsed.failedFiles.slice(0, 4))
            .stage(
              "scout file",
              (file) => $.json("scout", FindingSchema, `Analyze likely test failure causes in ${file}.`),
              { concurrency: 3 },
            )
            .stage(
              "review finding",
              (finding) =>
                $.text(
                  "reviewer",
                  prompt`
                    Review this finding for plausibility:
                    ${compact(finding)}
                  `,
                ),
              { concurrency: 2 },
            )
            .run(),
        );
      }

      await $.phase("fix", () => $.text("fixer", makeFixPrompt(failure, triage)));
      $.budget.throwIfExceeded();
    }

    const checks = await $.phase("validate", () =>
      $.parallel(
        "validation",
        {
          tests: () => $.sh("unit tests", "npm test -- --runInBand"),
          types: () => $.sh("typecheck", "npm run typecheck"),
        },
        { concurrency: 2 },
      ),
    );

    if (!checks.tests.ok) {
      throw new Error(`Tests still fail after ${maxLoops} loop(s).\n${checks.tests.output.slice(-4000)}`);
    }

    return $.phase("review", async () => {
      const diff = await $.sh("git diff", "git diff");
      return $.structured("reviewer", ReviewSchema, makeReviewPrompt(diff.output, checks));
    });
  },
});

function parseFailureOutput(output: string) {
  const failedFiles = Array.from(
    new Set(
      output
        .split("\n")
        .map((line) => line.match(/([\w./-]+\.(?:test|spec)\.[tj]sx?)/)?.[1])
        .filter((file): file is string => Boolean(file)),
    ),
  );

  return {
    failedFiles,
    tail: output.slice(-12_000),
  };
}

function makeTriagePrompt(failure: string, parsed: ReturnType<typeof parseFailureOutput>) {
  return `Tests failed. Do read-only triage. Identify likely root cause and files to inspect.

Failed files detected:
${parsed.failedFiles.map((file) => `- ${file}`).join("\n") || "(none detected)"}

Failure output:
${failure}`;
}

function makeFixPrompt(failure: string, triage: unknown) {
  return `Make the smallest code change needed to fix these failing tests.

Rules:
- Keep scope tight.
- Preserve public behavior unless the test clearly expects a change.
- Do not refactor unrelated code.

Triage:
${compact(triage)}

Failure output:
${failure}`;
}

function makeReviewPrompt(diff: string, checks: Record<string, ShellResult>) {
  return `Review the final diff and validation results.

Return PASS if the diff is safe and tests/typecheck are acceptable. Return CONCERN if there are risks.

Validation:
${Object.entries(checks)
  .map(([name, result]) => `- ${name}: ${result.ok ? "ok" : "failed"}`)
  .join("\n")}

Diff:
${diff}`;
}
