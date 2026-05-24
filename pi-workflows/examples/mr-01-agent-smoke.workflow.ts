import { profile, workflow } from "../src/index.js";
import { Type } from "typebox";

const SmokeSchema = Type.Object({
  ok: Type.Boolean(),
  summary: Type.String(),
  profile: Type.String(),
});

export default workflow("mr-01 agent smoke", {
  description: "Exercises a real Pi SDK agent call through the mr-01 profile.",
  phases: ["agent"],
  budget: { maxCostUsd: 1, maxTokens: 100_000, timeoutMs: 180_000 },
  agents: {
    smoke: profile("mr-01"),
  },

  async run($) {
    return $.phase("agent", () =>
      $.json(
        "smoke",
        SmokeSchema,
        `This is a smoke test for the pi-workflows SDK runner.
Return a tiny JSON object with:
- ok: true
- summary: one sentence
- profile: "mr-01"`,
      ),
    );
  },
});
