import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SummerGameFestivalExperience } from "./SummerGameFestivalExperience";
import { PetRedPacketExperience } from "./PetRedPacketExperience";
import { ArtworkSlice } from "./shared";
import { CommerceFeedExperience } from "./CommerceFeedExperience";
import commerceSpec from "../../../../activity-pages/commerce-feed/activity-spec.json";
import petSpec from "../../../../activity-pages/pet-red-packet/activity-spec.json";
import gameSpec from "../../../../activity-pages/summer-game-festival/activity-spec.json";
import commerceAssets from "../../../../activity-pages/commerce-feed/assets/manifest.json";
import petAssets from "../../../../activity-pages/pet-red-packet/assets/manifest.json";
import gameAssets from "../../../../activity-pages/summer-game-festival/assets/manifest.json";

const node = (id: string) => document.querySelector<HTMLElement>(`[data-d2c-node-id="${id}"]`)!;

describe("真实原图的可编辑视觉边界", () => {
  it.each([commerceSpec, petSpec, gameSpec])("$page.name 的根节点保持完整视口，不误用同名素材的裁切尺寸", (spec) => {
    const root = spec.nodes.find((item) => item.id === spec.page.id)!;
    expect(root.sourceBox).toEqual({ x: 0, y: 0, ...spec.page.canonicalViewport });
    for (const item of spec.nodes) {
      if (item.layout.width.mode === "fixed") expect(item.layout.width.value, item.id).toBe(item.sourceBox.width);
      if (item.layout.height.mode === "fixed") expect(item.layout.height.value, item.id).toBe(item.sourceBox.height);
    }
  });

  it.each([
    { name: "商城", Page: CommerceFeedExperience, assets: commerceAssets },
    { name: "宠物", Page: PetRedPacketExperience, assets: petAssets },
    { name: "游戏", Page: SummerGameFestivalExperience, assets: gameAssets },
  ])("$name 的素材裁切与实测清单一致，不扩张到附近文字", ({ Page, assets }) => {
    render(<Page atlasUrl="/reference.jpg" />);
    const aliases: Record<string, string> = { "gift-art": "level-gift-5", "packet-art": "level-gift-10", "dance-art": "benefit-tile-dance-art", "coin-art": "benefit-tile-coin-art", "lingqi-art": "benefit-tile-lingqi-art", "hat-art": "benefit-tile-hat-art" };
    const sourceHeight = assets.atlasSize.height * 390 / assets.atlasSize.width;
    for (const [id, bounds] of Object.entries(assets.frontendCropsCss390)) {
      const [x, y, width, height] = bounds as [number, number, number, number];
      const img = node(aliases[id] ?? id).querySelector("img")!;
      expect(parseFloat(img.style.width), id).toBeCloseTo(390 / width * 100, 1);
      expect(parseFloat(img.style.height), id).toBeCloseTo(sourceHeight / height * 100, 1);
      expect(parseFloat(img.style.left), id).toBeCloseTo(-x / width * 100, 1);
      expect(parseFloat(img.style.top), id).toBeCloseTo(-y / height * 100, 1);
    }
  });

  it("商城横幅文案、领券按钮和相机入口可编辑可交互", () => {
    render(<CommerceFeedExperience atlasUrl="/commerce-feed/reference.jpg" texts={{ "product-tissue-title": "可编辑商品标题" }} />);
    expect(node("banner-title")).toBeVisible();
    expect(node("product-tissue-title")).toHaveTextContent("可编辑商品标题");
    expect(screen.getByRole("button", { name: "拍照搜索" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "去领取" }));
    expect(screen.getByRole("status")).toHaveTextContent("消费券");
  });
  it("代码生成传入全量 spec 文案时，横幅仍保留分层排版", () => {
    const texts = Object.fromEntries(commerceSpec.nodes.filter((item) => item.role === "text").map((item) => [item.id, item.content!.text!]));
    const { rerender } = render(<CommerceFeedExperience atlasUrl="/reference.jpg" texts={texts} />);
    expect(node("banner-line-coupon").querySelector("strong")).toHaveTextContent("80元");
    expect(node("banner-line-coupon").querySelector("em")).toHaveTextContent("去领取");
    expect(node("banner-line-moutai").querySelector("br")).toBeInTheDocument();
    rerender(<CommerceFeedExperience atlasUrl="/reference.jpg" texts={{ ...texts, "banner-line-coupon": "90元 新人券 立即领" }} />);
    expect(node("banner-line-coupon").querySelector("strong")).toHaveTextContent("90元");
    fireEvent.click(screen.getByRole("button", { name: "立即领" }));
    expect(screen.getByRole("status")).toHaveTextContent("90元新人券");
  });
  it("裁切映射不对整张 atlas 再执行 cover，避免带入邻近文字", () => {
    render(<ArtworkSlice nodeId="crop-test" atlasUrl="/reference.jpg" crop={{ x: .2, y: .3, width: .1, height: .2 }} alt="道具" style={{ width: 28, height: 32 }} />);
    expect(node("crop-test").querySelector("img")).toHaveStyle({ objectFit: "fill" });
  });
  it("宠物页收入精度、更多入口与任务区位置以原图为准", () => {
    render(<PetRedPacketExperience atlasUrl="/pet-red-packet/reference.jpg" />);
    expect(node("level-income")).toHaveTextContent("0.1000元");
    expect(screen.getByRole("button", { name: "更多" })).toBeVisible();
    expect(node("pet-hero-notice")).toBeVisible();
    expect(node("pet-pk-button")).toContainElement(node("pet-pk-action"));
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
  it("全量游戏文案中的初始余额不会与动态余额重复拼接", () => {
    const texts = Object.fromEntries(gameSpec.nodes.filter((item) => item.role === "text").map((item) => [item.id, item.content!.text!]));
    render(<SummerGameFestivalExperience atlasUrl="/reference.jpg" texts={texts} />);
    expect(node("star-balance-label").textContent).toBe("我的星钻： 0");
    fireEvent.click(node("task-install-action"));
    expect(node("star-balance-label").textContent).toBe("我的星钻： 200");
    fireEvent.click(node("task-follow-action"));
    expect(node("star-balance-label").textContent).toBe("我的星钻： 250");
  });
});
