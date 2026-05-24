import { pathToFileURL } from "node:url";
import { defineWorkflow, json, runWorkflow } from "../src/index.js";
import { Type } from "typebox";

const SmokeSchema = Type.Object({
  ok: Type.Boolean(),
  summary: Type.String(),
  profile: Type.String(),
});

const workflow = defineWorkflow({
  meta: {
    name: "mr-01 agent smoke",
    description: "Exercises a real Pi SDK agent call through the mr-01 profile.",
    phases: ["agent"],
  },
  profiles: {
    smoke: "mr-01",
  },
  defaults: {
    budget: { maxCostUsd: 1, maxTokens: 100_000, timeoutMs: 180_000 },
  },
  async run($) {
    $.phaseLog.start("agent", "calling mr-01 through the SDK");
    return $.agent(
      "smoke",
      `This is a smoke test for the pi-workflows SDK runner.
Return a tiny JSON object with:
- ok: true
- summary: one sentence
- profile: "mr-01"`,
      { output: json(SmokeSchema) },
    );
  },
});

export default workflow;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runWorkflow(workflow, { args: {} });
}
