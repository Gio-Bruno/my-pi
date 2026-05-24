import { pathToFileURL } from "node:url";
import { defineWorkflow, runWorkflow } from "../src/index.js";

const workflow = defineWorkflow({
  meta: {
    name: "Smoke test",
    description: "Exercises JS, shell, parallel, mapParallel, pipeline, and budget without an LLM call.",
    phases: ["js", "shell", "parallel", "pipeline"],
  },
  profiles: {},
  defaults: {
    concurrency: 2,
    budget: { timeoutMs: 60_000 },
  },
  async run($) {
    $.phaseLog.start("js", "running deterministic step");
    const js = await $.run("compute", () => ({ ok: true, value: 2 + 2 }));

    $.phaseLog.start("shell", "running node command");
    const shell = await $.sh("node version", "node --version");

    $.phaseLog.start("parallel", "running named and mapped parallel tasks");
    const named = await $.parallel("named", {
      a: () => $.run("a", () => "A"),
      b: () => $.run("b", () => "B"),
    });

    const mapped = await $.mapParallel("numbers", [1, 2, 3], async (n) => n * 2, { concurrency: 2 });

    $.phaseLog.start("pipeline", "running staged queue");
    const piped = await $.pipeline("double then stringify", [1, 2, 3])
      .stage("double", async (n) => n * 2, { concurrency: 2 })
      .stage("stringify", async (n) => `n=${n}`, { concurrency: 2 })
      .run();

    return {
      ok: js.ok && shell.ok,
      js,
      shell: shell.output.trim(),
      named,
      mapped,
      piped,
      budget: $.budget.usage,
    };
  },
});

export default workflow;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runWorkflow(workflow, { args: {} });
}
