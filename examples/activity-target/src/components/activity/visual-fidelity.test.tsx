import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SummerGameFestivalExperience } from "./SummerGameFestivalExperience";
import { PetRedPacketExperience } from "./PetRedPacketExperience";
import { ArtworkSlice } from "./shared";
import { CommerceFeedExperience } from "./CommerceFeedExperience";

const node = (id: string) => document.querySelector(`[data-d2c-node-id="${id}"]`)!;

describe("真实原图的可编辑视觉边界", () => {
  it("商城横幅文案、领券按钮和相机入口可编辑可交互", () => {
    render(<CommerceFeedExperience atlasUrl="/commerce-feed/reference.jpg" texts={{ "product-tissue-title": "可编辑商品标题" }} />);
    expect(node("banner-title")).toBeVisible();
    expect(node("product-tissue-title")).toHaveTextContent("可编辑商品标题");
    expect(screen.getByRole("button", { name: "拍照搜索" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "去领取" }));
    expect(screen.getByRole("status")).toHaveTextContent("消费券");
  });
  it("裁切映射不对整张 atlas 再执行 cover，避免带入邻近文字", () => {
    render(<ArtworkSlice nodeId="crop-test" atlasUrl="/reference.jpg" crop={{ x: .2, y: .3, width: .1, height: .2 }} alt="道具" style={{ width: 28, height: 32 }} />);
    expect(node("crop-test").querySelector("img")).toHaveStyle({ objectFit: "fill" });
  });
  it("宠物页收入精度、更多入口与任务区位置以原图为准", () => {
    render(<PetRedPacketExperience atlasUrl="/pet-red-packet/reference.jpg" />);
    expect(node("level-income")).toHaveTextContent("0.1000元");
    expect(screen.getByRole("button", { name: "更多" })).toBeVisible();
    expect(node("pet-task-section")).toHaveStyle({ top: "703px" });
    expect(node("pet-feed-button")).toHaveStyle({ height: "84px" });
  });
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
