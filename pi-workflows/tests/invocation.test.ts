import test from "node:test";
import assert from "node:assert/strict";
import { InvocationParseError, parseInvocationText, parseInvocationTokens, tokenizeInvocation, type WorkflowInvocationDescriptor } from "../src/invocation.js";

const brainstormingInvocation: WorkflowInvocationDescriptor = {
  primary: { field: "idea", required: true },
  options: {
    maxQuestions: { flag: "max-questions", type: "number", default: 6 },
    skipCommit: { flag: "skip-commit", type: "boolean", default: false },
    specPath: { flag: "spec-path", type: "path" },
  },
};

test("tokenizeInvocation handles shell-like quotes and escapes", () => {
  assert.deepEqual(tokenizeInvocation('"hello world" --spec-path ./docs/space\\ path.md'), [
    "hello world",
    "--spec-path",
    "./docs/space path.md",
  ]);
});

test("parseInvocationText preserves JSON compatibility", () => {
  assert.deepEqual(parseInvocationText('{"idea":"hello"}'), { mode: "json", args: { idea: "hello" } });
  assert.deepEqual(parseInvocationText('--json \'{"idea":"hello"}\''), { mode: "json", args: { idea: "hello" } });
});

test("tokenizeInvocation handles heredoc-style values", () => {
  assert.deepEqual(tokenizeInvocation("--context <<'EOF'\nline one\nline two\nEOF"), ["--context", "line one\nline two"]);
});

test("metadata-aware inline parsing maps primary text and flags", () => {
  assert.deepEqual(
    parseInvocationText('Design a nicer UX --max-questions 3 --skip-commit --spec-path "docs/my spec.md"', {
      descriptor: brainstormingInvocation,
    }),
    {
      mode: "inline",
      args: {
        idea: "Design a nicer UX",
        maxQuestions: 3,
        skipCommit: true,
        specPath: "docs/my spec.md",
      },
    },
  );
});

test("boolean flags accept negation and explicit values", () => {
  assert.deepEqual(parseInvocationTokens(["Idea", "--no-skip-commit"], { descriptor: brainstormingInvocation }).args, {
    idea: "Idea",
    maxQuestions: 6,
    skipCommit: false,
  });

  assert.deepEqual(parseInvocationTokens(["Idea", "--skip-commit=false"], { descriptor: brainstormingInvocation }).args, {
    idea: "Idea",
    maxQuestions: 6,
    skipCommit: false,
  });
});

test("delimiter makes flag-like text literal", () => {
  assert.deepEqual(parseInvocationTokens(["--", "Idea", "about", "--json", "APIs"], { descriptor: brainstormingInvocation }).args, {
    idea: "Idea about --json APIs",
    maxQuestions: 6,
    skipCommit: false,
  });
});

test("unknown metadata-aware flags fail clearly", () => {
  assert.throws(
    () => parseInvocationTokens(["Idea", "--unknown", "value"], { descriptor: brainstormingInvocation }),
    (error) => error instanceof InvocationParseError && /Unknown workflow option --unknown/.test(error.message),
  );
});

test("without metadata, inline text remains the input field", () => {
  assert.deepEqual(parseInvocationText("plain text --not-a-flag"), {
    mode: "inline",
    args: { input: "plain text --not-a-flag" },
  });

  assert.deepEqual(parseInvocationTokens(["--", "literal", "--flag"]), {
    mode: "inline",
    args: { input: "literal --flag" },
  });
});
