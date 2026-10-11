/**
 * Controlled concurrency queue execution.
 *
 * Runs async tasks with a strict concurrency ceiling.
 * Errors in individual items are isolated and never halt or abort remaining items.
 */

export type QueueItemStatus = "queued" | "running" | "completed" | "error";

export interface QueueItemState<T, R> {
  item: T;
  index: number;
  status: QueueItemStatus;
  result?: R;
  error?: unknown;
}

export type QueueWorker<T, R> = (item: T, index: number) => Promise<R>;

export type QueueUpdateCallback<T, R> = (
  state: QueueItemState<T, R>,
  allStates: QueueItemState<T, R>[]
) => void;

/**
 * Executes a list of items across worker promises with bounded concurrency.
 *
 * @param items - List of items to process.
 * @param worker - Async function to process each item.
 * @param concurrency - Maximum number of items processed concurrently.
 * @param onUpdate - Optional callback fired when an item's status changes.
 * @returns Array of final states for each item in original input order.
 */
export async function runQueue<T, R>(
  items: T[],
  worker: QueueWorker<T, R>,
  concurrency: number,
  onUpdate?: QueueUpdateCallback<T, R>
): Promise<QueueItemState<T, R>[]> {
  if (items.length === 0) {
    return [];
  }

  const states: QueueItemState<T, R>[] = items.map((item, index) => ({
    item,
    index,
    status: "queued",
  }));

  // Emit initial queued status
  for (const s of states) {
    onUpdate?.(s, states);
  }

  const effectiveConcurrency = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  async function runner(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      const current = states[idx];

      current.status = "running";
      onUpdate?.(current, states);

      try {
        const result = await worker(current.item, idx);
        current.status = "completed";
        current.result = result;
      } catch (err: unknown) {
        current.status = "error";
        current.error = err;
      } finally {
        onUpdate?.(current, states);
      }
    }
  }

  const runners = Array.from({ length: effectiveConcurrency }, () => runner());
  await Promise.all(runners);

  return states;
}
