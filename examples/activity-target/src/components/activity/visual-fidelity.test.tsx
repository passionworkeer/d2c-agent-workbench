import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SummerGameFestivalExperience } from "./SummerGameFestivalExperience";

const node = (id: string) => document.querySelector(`[data-d2c-node-id="${id}"]`)!;

describe("真实原图的可编辑视觉边界", () => {
  it("游戏账户和侧入口可见可操作，联动标题不依赖烘焙文字", () => {
    render(<SummerGameFestivalExperience atlasUrl="/game-festival/reference.jpg" />);
    expect(node("star-balance-label")).toBeVisible();
    expect(node("collab-header")).toBeVisible();
    expect(node("hero-rule-entry")).toBeVisible();
    fireEvent.click(node("hero-rule-entry"));
    expect(screen.getByRole("status")).toHaveTextContent("活动规则");
    fireEvent.click(node("task-install-action"));
    expect(node("star-balance-label")).toHaveTextContent("200");
    expect(node("task-install-action")).toBeDisabled();
  });

  it("游戏底部 Tab 有可切换的语义选中状态", () => {
    render(<SummerGameFestivalExperience atlasUrl="/game-festival/reference.jpg" />);
    expect(node("tab-tasks")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(node("tab-rank"));
    expect(node("tab-rank")).toHaveAttribute("aria-selected", "true");
    expect(node("tab-tasks")).toHaveAttribute("aria-selected", "false");
  });
});
