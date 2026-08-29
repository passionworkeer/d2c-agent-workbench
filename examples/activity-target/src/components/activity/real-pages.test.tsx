import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import commerceSpec from "../../../../activity-pages/commerce-feed/activity-spec.json";
import gameSpec from "../../../../activity-pages/summer-game-festival/activity-spec.json";
import petSpec from "../../../../activity-pages/pet-red-packet/activity-spec.json";
import { CommerceFeedExperience } from "./CommerceFeedExperience";
import { PetRedPacketExperience } from "./PetRedPacketExperience";
import { SummerGameFestivalExperience } from "./SummerGameFestivalExperience";

// 三张真实活动页的高保真组件：以 fixture spec 为单一事实源做闭环校验——
// 每个文本节点在 DOM 中逐一可寻址且文案逐字一致，演示交互改变可见本地状态。

interface SpecTextNode {
  id: string;
  text: string;
}

const textNodesOf = (spec: { nodes: Array<{ id: string; role: string; content?: { text?: string } }> }): SpecTextNode[] =>
  spec.nodes.filter((node) => node.role === "text" && node.content?.text !== undefined).map((node) => ({ id: node.id, text: node.content!.text as string }));

const queryNode = (id: string) => document.querySelector(`[data-d2c-node-id="${id}"]`);

const atlasUrl = "/campaign/reference.jpg";

describe("CommerceFeedExperience", () => {
  it("渲染全部文本节点且文案与 spec 逐字一致", () => {
    render(<CommerceFeedExperience atlasUrl={atlasUrl} data-d2c-ready="true" />);
    for (const { id, text } of textNodesOf(commerceSpec)) {
      const node = queryNode(id);
      expect(node, id).toBeTruthy();
      expect(node?.textContent, id).toBe(text);
    }
  });

  it("搜索提交弹出提示、关闭浮层后浮层入口消失", () => {
    render(<CommerceFeedExperience atlasUrl={atlasUrl} />);
    fireEvent.click(queryNode("commerce-search-submit")!);
    expect(screen.getByRole("status").textContent).toContain("猫粮");
    expect(queryNode("float-close")).toBeTruthy();
    fireEvent.click(queryNode("float-close")!);
    expect(queryNode("float-browse")).toBeNull();
    expect(queryNode("float-reward")).toBeNull();
  });
});

describe("SummerGameFestivalExperience", () => {
  it("渲染全部文本节点且文案与 spec 逐字一致", () => {
    render(<SummerGameFestivalExperience atlasUrl={atlasUrl} data-d2c-ready="true" />);
    for (const { id, text } of textNodesOf(gameSpec)) {
      const node = queryNode(id);
      expect(node, id).toBeTruthy();
      expect(node?.textContent, id).toBe(text);
    }
  });

  it("完成任务后星钻余额增加、按钮进入已完成态", () => {
    render(<SummerGameFestivalExperience atlasUrl={atlasUrl} />);
    expect(queryNode("star-balance-label")?.textContent).toBe("我的星钻： 0");
    fireEvent.click(queryNode("task-install-action")!);
    expect(queryNode("star-balance-label")?.textContent).toBe("我的星钻： 200");
    expect(queryNode("task-install-action")?.textContent).toBe("已完成");
    fireEvent.click(queryNode("task-follow-action")!);
    expect(queryNode("star-balance-label")?.textContent).toBe("我的星钻： 250");
  });
});

describe("PetRedPacketExperience", () => {
  it("渲染全部文本节点且文案与 spec 逐字一致", () => {
    render(<PetRedPacketExperience atlasUrl={atlasUrl} data-d2c-ready="true" />);
    for (const { id, text } of textNodesOf(petSpec)) {
      const node = queryNode(id);
      expect(node, id).toBeTruthy();
      expect(node?.textContent, id).toBe(text);
    }
  });

  it("能量为 0 时喂食提示能量不足且不出现负数；做任务后能量增加、喂食消耗", () => {
    render(<PetRedPacketExperience atlasUrl={atlasUrl} />);
    expect(queryNode("pet-feed-energy")?.textContent).toBe("剩余 0 能量");
    fireEvent.click(queryNode("pet-feed-button")!);
    expect(screen.getByRole("status").textContent).toContain("能量不足");
    expect(queryNode("pet-feed-energy")?.textContent).toBe("剩余 0 能量");
    fireEvent.click(queryNode("pet-task-feed-action")!);
    expect(queryNode("pet-feed-energy")?.textContent).toBe("剩余 10 能量");
    fireEvent.click(queryNode("pet-feed-button")!);
    expect(queryNode("pet-feed-energy")?.textContent).toBe("剩余 9 能量");
    expect(queryNode("pet-task-feed-action")?.textContent).toBe("已完成");
  });
});
