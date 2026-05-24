import { createLimiter } from "./parallel.js";
import type { PipelineBuilder, PipelineStageOptions, WorkflowLogger } from "./types.js";

interface Stage<TIn = unknown, TOut = unknown> {
  name: string;
  concurrency: number;
  worker: (item: TIn, index: number) => Promise<TOut> | TOut;
}

export class DefaultPipelineBuilder<TInput, TCurrent> implements PipelineBuilder<TInput, TCurrent> {
  constructor(
    private readonly name: string | (() => string),
    private readonly items: readonly TInput[],
    private readonly logger: WorkflowLogger,
    private readonly stages: Stage[] = [],
    private readonly defaultConcurrency = 4,
  ) {}

  stage<TNext>(
    name: string,
    worker: (item: TCurrent, index: number) => Promise<TNext> | TNext,
    options: PipelineStageOptions = {},
  ): PipelineBuilder<TInput, TNext> {
    return new DefaultPipelineBuilder<TInput, TNext>(
      this.name,
      this.items,
      this.logger,
      [
        ...this.stages,
        {
          name,
          concurrency: options.concurrency ?? this.defaultConcurrency,
          worker: worker as Stage["worker"],
        },
      ],
      this.defaultConcurrency,
    );
  }

  async run(): Promise<TCurrent[]> {
    const name = this.label();
    this.logger.stepStart?.("pipeline", name);

    if (this.stages.length === 0) {
      this.logger.stepEnd?.("pipeline", name);
      return [...this.items] as unknown as TCurrent[];
    }

    const limiters = this.stages.map((stage) => createLimiter(stage.concurrency));
    const results = new Array<TCurrent>(this.items.length);

    const runStage = async (stageIndex: number, value: unknown, itemIndex: number): Promise<unknown> => {
      const stage = this.stages[stageIndex];
      const nextValue = await limiters[stageIndex](() => stage.worker(value, itemIndex));
      if (stageIndex === this.stages.length - 1) return nextValue;
      return runStage(stageIndex + 1, nextValue, itemIndex);
    };

    await Promise.all(
      this.items.map(async (item, index) => {
        results[index] = (await runStage(0, item, index)) as TCurrent;
      }),
    );

    this.logger.stepEnd?.("pipeline", name);
    return results;
  }

  private label(): string {
    return typeof this.name === "function" ? this.name() : this.name;
  }
}
