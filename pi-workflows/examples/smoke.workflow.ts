import { workflow } from "../src/index.js";

export default workflow("Smoke test", {
  description: "Exercises JS, shell, parallel, mapParallel, pipeline, and budget without an LLM call.",
  phases: ["js", "shell", "parallel", "pipeline"],
  concurrency: 2,
  budget: { timeoutMs: 60_000 },

  async run($) {
    const js = await $.phase("js", () => $.run("compute", () => ({ ok: true, value: 2 + 2 })));

    const shell = await $.phase("shell", () => $.sh("node version", "node --version"));

    const { named, mapped } = await $.phase("parallel", async () => {
      const named = await $.parallel("named", {
        a: () => $.run("a", () => "A"),
        b: () => $.run("b", () => "B"),
      });

      const mapped = await $.mapParallel("numbers", [1, 2, 3], async (n) => n * 2, { concurrency: 2 });
      return { named, mapped };
    });

    const piped = await $.phase("pipeline", () =>
      $.pipeline("double then stringify", [1, 2, 3])
        .stage("double", async (n) => n * 2, { concurrency: 2 })
        .stage("stringify", async (n) => `n=${n}`, { concurrency: 2 })
        .run(),
    );

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
