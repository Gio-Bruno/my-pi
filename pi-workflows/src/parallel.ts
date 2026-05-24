export function createLimiter(concurrency: number): <T>(fn: () => Promise<T> | T) => Promise<T> {
  const max = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active--;
    queue.shift()?.();
  };

  return async function limit<T>(fn: () => Promise<T> | T): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }

    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}

export async function mapWithConcurrency<TItem, TResult>(
  items: readonly TItem[],
  concurrency: number,
  worker: (item: TItem, index: number) => Promise<TResult> | TResult,
): Promise<TResult[]> {
  const limit = createLimiter(concurrency);
  const results = new Array<TResult>(items.length);

  await Promise.all(
    items.map((item, index) =>
      limit(async () => {
        results[index] = await worker(item, index);
      }),
    ),
  );

  return results;
}

export async function runNamedParallel<T extends Record<string, () => Promise<unknown> | unknown>>(
  tasks: T,
  concurrency: number,
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const entries = Object.entries(tasks) as Array<[keyof T, T[keyof T]]>;
  const limit = createLimiter(concurrency);
  const result = {} as { [K in keyof T]: Awaited<ReturnType<T[K]>> };

  await Promise.all(
    entries.map(([key, task]) =>
      limit(async () => {
        result[key] = (await task()) as Awaited<ReturnType<T[typeof key]>>;
      }),
    ),
  );

  return result;
}
