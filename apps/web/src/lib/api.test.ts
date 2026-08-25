import type { TraceEvent } from "@d2c/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeToRun } from "./api";

interface EventSourceStub {
  url: string;
  readyState: number;
  source: MockEventSource;
  listeners: Record<string, Array<(event: MessageEvent | Event) => void>>;
  emit(type: "message" | "error", data?: unknown): void;
  close(): void;
}

const stubs: EventSourceStub[] = [];

class MockEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  url: string;
  readyState = MockEventSource.CONNECTING;
  private listeners: Record<string, Array<(event: MessageEvent | Event) => void>> = {};
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    const stub: EventSourceStub = {
      url,
      readyState: 0,
      source: this,
      listeners: this.listeners,
      emit: (type, data) => {
        if (type === "message") {
          const message = new MessageEvent("message", { data: typeof data === "string" ? data : JSON.stringify(data) });
          (this.onmessage ?? this.bound("message"))(message);
          return;
        }
        (this.onerror ?? this.bound("error"))(new Event("error"));
      },
      close: () => {
        this.readyState = MockEventSource.CLOSED;
      },
    };
    stubs.push(stub);
  }
  addEventListener(type: "message" | "error", listener: (event: MessageEvent | Event) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  removeEventListener(type: "message" | "error", listener: (event: MessageEvent | Event) => void) {
    const list = this.listeners[type];
    if (!list) return;
    const index = list.indexOf(listener);
    if (index >= 0) list.splice(index, 1);
  }
  close() {
    this.readyState = MockEventSource.CLOSED;
  }
  private bound(type: "message" | "error") {
    return (event: MessageEvent | Event) => {
      for (const listener of this.listeners[type] ?? []) listener(event);
    };
  }
}

beforeEach(() => {
  stubs.length = 0;
  vi.stubGlobal("EventSource", MockEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function emit(stub: EventSourceStub, type: "message" | "error", data?: unknown) {
  stub.emit(type, data);
}

function makeEvent(state: TraceEvent["state"]): TraceEvent {
  return {
    id: `evt-${state}`,
    runId: "run-1",
    timestamp: new Date().toISOString(),
    state,
    title: state,
  };
}

describe("subscribeToRun", () => {
  it("forwards events and treats an error after a terminal event as normal completion", () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    subscribeToRun("run-1", onEvent, onError);

    const stub = stubs[0]!;
    emit(stub, "message", makeEvent("EVALUATED"));
    emit(stub, "message", makeEvent("COMPLETED"));
    // WHATWG：服务端正常 end() 后浏览器仍会触发 onerror，不能把"已完成"的连接当故障。
    emit(stub, "error");

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  it("calls onError when the stream errors before reaching a terminal state", () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    subscribeToRun("run-1", onEvent, onError);

    const stub = stubs[0]!;
    emit(stub, "message", makeEvent("EVALUATED"));
    emit(stub, "error");

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("treats NEEDS_REVIEW as a terminal state", () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    subscribeToRun("run-1", onEvent, onError);

    const stub = stubs[0]!;
    emit(stub, "message", makeEvent("EVALUATED"));
    emit(stub, "message", makeEvent("NEEDS_REVIEW"));
    emit(stub, "error");

    expect(onError).not.toHaveBeenCalled();
  });

  it("treats a non-JSON payload as a stream error", () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    subscribeToRun("run-1", onEvent, onError);

    const stub = stubs[0]!;
    emit(stub, "message", "not-json{");

    expect(onEvent).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("returns a cleanup function that closes the underlying source", () => {
    const onEvent = vi.fn();
    const onError = vi.fn();
    const cleanup = subscribeToRun("run-1", onEvent, onError);

    const stub = stubs[0]!;
    cleanup();

    // 服务端正常 end() 关闭后浏览器仍可能再触发一次 onerror：cleanup 必须把 readyState
    // 切到 CLOSED，确保 mock 的 EventSource 不会再 dispatch 任何后续事件。
    expect(stub.source.readyState).toBe(MockEventSource.CLOSED);
  });
});
