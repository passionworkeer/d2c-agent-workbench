import type { EvaluationReport, TraceEvent } from "@d2c/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockRun, playMockWorkflow } from "./mock-run";

describe("浏览器端 Mock 工作流", () => {
  afterEach(() => vi.useRealTimers());

  it("播放完整的十二步评测修复闭环", async () => {
    vi.useFakeTimers();
    const received: TraceEvent[] = [];

    const playback = playMockWorkflow((event) => received.push(event), { delayMs: 10 });
    await vi.runAllTimersAsync();
    await playback.done;

    expect(createMockRun().uiSpec.name).toBe("动感商品网格");
    expect(received).toHaveLength(12);
    expect(
      received
        .filter((event) => event.state === "EVALUATED")
        .map((event) => (event.data?.evaluation as EvaluationReport).overall),
    ).toEqual([72, 94]);
    expect(received.at(-1)?.state).toBe("COMPLETED");
    expect(received.at(-1)?.data?.scoreDelta).toBe(22);
  });

  it("取消后不再发送剩余事件", async () => {
    vi.useFakeTimers();
    const received: TraceEvent[] = [];
    const playback = playMockWorkflow((event) => received.push(event), { delayMs: 10 });

    await vi.advanceTimersByTimeAsync(10);
    playback.cancel();
    await vi.runAllTimersAsync();
    await playback.done;

    expect(received).toHaveLength(1);
  });
});
