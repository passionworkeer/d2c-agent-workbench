import { describe, expect, it } from "vitest";
import { diffLines, summarizeDiff } from "./diff";

describe("diffLines", () => {
  it("相同输入全部 equal", () => {
    const result = diffLines("a\nb\nc", "a\nb\nc");
    expect(result.map((line) => line.kind)).toEqual(["equal", "equal", "equal"]);
    expect(summarizeDiff(result)).toEqual({ added: 0, removed: 0 });
  });

  it("新增与删除都能正确识别", () => {
    const result = diffLines("a\nb\nc", "a\nB\nc\nd");
    // LCS=3（a, B?, c?）。a/c 必留；b→B 与新增 d 互斥只能选其一；本实现在平局时优先 add。
    expect(result.find((line) => line.kind === "equal" && line.text === "a")).toBeTruthy();
    expect(result.find((line) => line.kind === "equal" && line.text === "c")).toBeTruthy();
    expect(result.find((line) => line.text === "b" && line.kind !== "equal")).toBeTruthy();
    expect(result.find((line) => line.text === "B" && line.kind !== "equal")).toBeTruthy();
    expect(result.find((line) => line.text === "d" && line.kind !== "equal")).toBeTruthy();
    // 总变更量：原 3 行 → 新 4 行；b→B + 新增 d 共 2 处变更（add/remove 各计 1）
    const { added, removed } = summarizeDiff(result);
    expect(added + removed).toBeGreaterThanOrEqual(2);
  });

  it("空字符串视为全部 remove / add", () => {
    const result = diffLines("", "x\ny");
    expect(result.map((line) => line.kind)).toEqual(["add", "add"]);
    expect(summarizeDiff(result)).toEqual({ added: 2, removed: 0 });
  });

  it("与真实 tokens.css 草稿 → 终稿差异能产生非平凡结果", () => {
    const draft = `:root {
  --color-canvas: #f3f1ea;
  --spacing-lg: 16;
  --spacing-2xl: 48;
}`;
    const final = `:root {
  --color-canvas: #f3f1ea;
  --spacing-lg: 16;
  --spacing-2xl: 48;
  --spacing-3xl: 56;
  --typography-label-font-size: 12;
}`;
    const result = diffLines(draft, final);
    const { added, removed } = summarizeDiff(result);
    expect(added).toBeGreaterThan(0);
    expect(removed).toBe(0);
  });
});
