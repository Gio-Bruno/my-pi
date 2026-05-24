import { workflow } from "../src/index.js";
import smoke from "./smoke.workflow.js";

export default workflow("Composed smoke test", {
  description: "Runs another workflow as one declared parent phase.",
  phases: ["child", "summarize"],

  async run($) {
    const child = await $.phase("child", () => $.workflow(smoke, {}));

    return $.phase("summarize", () =>
      $.run("summarize child result", () => ({
        ok: child.ok,
        childWorkflowBudget: child.budget,
      })),
    );
  },
});
