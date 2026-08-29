import "@testing-library/jest-dom/vitest";

// Puck 等编辑器组件依赖 ResizeObserver，jsdom 不提供；测试环境用空实现兜底。
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// 同理，Puck 用 matchMedia 感知视口；jsdom 缺省没有。
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Puck 拖拽层在 pointer move 时调用 elementsFromPoint；jsdom 未实现，返回空命中。
if (typeof document !== "undefined" && typeof document.elementsFromPoint !== "function") {
  document.elementsFromPoint = () => [];
}
