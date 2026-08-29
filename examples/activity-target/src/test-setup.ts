import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest 未开 globals：RTL 的自动 cleanup 检测不到全局 afterEach，这里显式清理，
// 否则跨测试 DOM 残留会让 document.querySelector 命中上一用例的旧节点。
afterEach(cleanup);
