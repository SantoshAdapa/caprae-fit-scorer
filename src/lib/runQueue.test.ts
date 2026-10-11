import { describe, it, expect } from "vitest";
import { runQueue } from "./runQueue";

describe("runQueue", () => {
  it("never exceeds specified maximum concurrency", async () => {
    let activeWorkers = 0;
    let maxObservedConcurrency = 0;

    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const concurrencyLimit = 3;

    await runQueue(
      items,
      async () => {
        activeWorkers++;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, activeWorkers);

        // Simulate async task
        await new Promise((resolve) => setTimeout(resolve, 20));

        activeWorkers--;
        return true;
      },
      concurrencyLimit
    );

    expect(maxObservedConcurrency).toBeLessThanOrEqual(concurrencyLimit);
    expect(maxObservedConcurrency).toBe(concurrencyLimit);
    expect(activeWorkers).toBe(0);
  });

  it("ensures all items reach a final state in original order", async () => {
    const items = ["a", "b", "c", "d"];

    const results = await runQueue(
      items,
      async (item) => {
        return item.toUpperCase();
      },
      2
    );

    expect(results).toHaveLength(4);
    expect(results.map((r) => r.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
    expect(results.map((r) => r.result)).toEqual(["A", "B", "C", "D"]);
  });

  it("isolates throwing workers so other items complete successfully", async () => {
    const items = [1, 2, 3, 4, 5];

    const results = await runQueue(
      items,
      async (n) => {
        if (n === 2 || n === 4) {
          throw new Error(`Failed on item ${n}`);
        }
        return n * 10;
      },
      2
    );

    expect(results[0].status).toBe("completed");
    expect(results[0].result).toBe(10);

    expect(results[1].status).toBe("error");
    expect((results[1].error as Error).message).toBe("Failed on item 2");

    expect(results[2].status).toBe("completed");
    expect(results[2].result).toBe(30);

    expect(results[3].status).toBe("error");
    expect((results[3].error as Error).message).toBe("Failed on item 4");

    expect(results[4].status).toBe("completed");
    expect(results[4].result).toBe(50);
  });

  it("calls onUpdate callback as items progress", async () => {
    const events: string[] = [];

    await runQueue(
      [10],
      async (item) => {
        return item * 2;
      },
      1,
      (state) => {
        events.push(`${state.item}:${state.status}`);
      }
    );

    expect(events).toContain("10:queued");
    expect(events).toContain("10:running");
    expect(events).toContain("10:completed");
  });
});
