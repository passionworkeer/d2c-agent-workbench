import type { TraceEvent } from "@d2c/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildLocalBundle, createLocalRunEvents, playEvents } from "./local-run";

describe("浏览器内真实执行（与 server SSE 路径同源）", () => {
  afterEach(() => vi.useRealTimers());

  it("product-grid fixture 走完整 runReplayWorkflow，产出 12 步评测修复闭环", async () => {
    const events = await createLocalRunEvents("product-grid");
    expect(events).toHaveLength(12);
    expect(events.map((event) => event.state)).toEqual([
      "VALIDATED",
      "NORMALIZED",
      "ASSETS_INDEXED",
      "COMPONENTS_MAPPED",
      "CODE_PLANNED",
      "GENERATED",
      "BUILT",
      "EVALUATED",
      "REPAIRING",
      "BUILT",
      "EVALUATED",
      "COMPLETED",
    ]);
    const scores = events
      .filter((event) => event.state === "EVALUATED")
      .map((event) => (event.data?.evaluation as { overall: number }).overall);
    expect(scores).toEqual([72, 94]);
    expect(events.at(-1)?.data?.scoreDelta).toBe(22);
  });

  it("buildLocalBundle 产出 zip 可被 figma-importer 完整解析并含 5 个入口", () => {
    const bytes = buildLocalBundle("product-grid");
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(bytes.byteLength).toBeLessThan(20_000);
  });

  it("playEvents 按 setTimeout 节奏逐步发送事件，可中途取消", async () => {
    // createLocalRunEvents 内部走 Promise.resolve() 微任务；必须用真实定时器，
    // 否则 fake timers 也会冻结微任务队列，promise 永远 hang。
    const events = await createLocalRunEvents("product-grid");
    vi.useFakeTimers();
    const received: TraceEvent[] = [];
    const playback = playEvents(events, (event) => received.push(event), { delayMs: 10 });
    await vi.advanceTimersByTimeAsync(10);
    expect(received).toHaveLength(1);
    playback.cancel();
    await vi.runAllTimersAsync();
    await playback.done;
    expect(received.length).toBeLessThan(events.length);
  });
});
