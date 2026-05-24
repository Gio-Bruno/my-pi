import { pathToFileURL } from "node:url";
import { defineWorkflow, json, runWorkflow, structured, text, type ShellResult } from "../src/index.js";
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

const workflow = defineWorkflow({
  meta: {
    name: "Fix failing tests",
    description: "Run tests, triage failures, fix, validate, and review the final diff.",
    phases: ["test", "triage", "fix", "validate", "review"],
  },
  profiles: {
    scout: "test-scout",
    fixer: "test-fixer",
    reviewer: "test-reviewer",
  },
  defaults: {
    maxIterations: 2,
    concurrency: 3,
    budget: { maxCostUsd: 3, maxTokens: 300_000 },
  },

  async run($, args: Args = {}) {
    const maxLoops = args.maxLoops ?? $.defaults.maxIterations;
    let lastTest: ShellResult | undefined;
    let triage: unknown;

    for (let loop = 1; loop <= maxLoops; loop++) {
      $.phaseLog.start("test", `run ${loop}/${maxLoops}`);
      lastTest = await $.sh("unit tests", "npm test -- --runInBand");
      if (lastTest.ok) {
        $.phaseLog.success("test", "tests passed");
        break;
      }

      const failure = lastTest.output.slice(-40_000);

      $.phaseLog.start("triage", "parse and scout failures");
      const parsed = await $.run("parse failure output", () => parseFailureOutput(failure));

      triage = await $.agent("scout", makeTriagePrompt(failure, parsed), {
        output: json(TriageSchema),
      });

      // Pipeline example: each failed file is analyzed by scout, then reviewed by reviewer
      // as soon as its scout result is ready. Keep this read-only.
      if (parsed.failedFiles.length > 0) {
        await $.pipeline("read-only per-file scout/review", parsed.failedFiles.slice(0, 4))
          .stage(
            "scout file",
            (file) => $.agent("scout", `Analyze likely test failure causes in ${file}.`, { output: json(FindingSchema) }),
            { concurrency: 3 },
          )
          .stage(
            "review finding",
            (finding) =>
              $.agent("reviewer", `Review this finding for plausibility:\n${JSON.stringify(finding, null, 2)}`, {
                output: text(),
              }),
            { concurrency: 2 },
          )
          .run();
      }

      $.phaseLog.start("fix", "apply minimal fix");
      await $.agent("fixer", makeFixPrompt(failure, triage), { output: text() });
      $.budget.throwIfExceeded();
    }

    $.phaseLog.start("validate", "parallel checks");
    const checks = await $.parallel(
      "validation",
      {
        tests: () => $.sh("unit tests", "npm test -- --runInBand"),
        types: () => $.sh("typecheck", "npm run typecheck"),
      },
      { concurrency: 2 },
    );

    if (!checks.tests.ok) {
      throw new Error(`Tests still fail after ${maxLoops} loop(s).\n${checks.tests.output.slice(-4000)}`);
    }

    $.phaseLog.start("review", "final diff review");
    const diff = await $.sh("git diff", "git diff");
    return $.agent("reviewer", makeReviewPrompt(diff.output, checks), {
      output: structured(ReviewSchema),
    });
  },
});

export default workflow;

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
${JSON.stringify(triage, null, 2)}

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runWorkflow(workflow, { args: {} });
}
