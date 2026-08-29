import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ArtworkSlice,
  BottomTabBar,
  KwaiTopNavigation,
  MobileActivityShell,
  PhoneStatusBar,
} from "./shared";
import { FloatingAction, PrimaryActionButton, ProductCard, ProgressCard, RewardTile, TaskCard } from "./cards";

const atlasUrl = "/fixtures/reference.jpg";

describe("KwaiTopNavigation", () => {
  it("逐个 Tab 渲染 data-d2c-node-id 与精确文案", () => {
    render(
      <KwaiTopNavigation
        nodeId="top-nav"
        activeTab="top-tab-mall"
        tabs={[
          { id: "top-tab-follow", label: "关注" },
          { id: "top-tab-mall", label: "商城" },
          { id: "top-tab-discover", label: "发现" },
          { id: "top-tab-local", label: "同城" },
        ]}
      />,
    );
    for (const [id, label] of [["top-tab-follow", "关注"], ["top-tab-mall", "商城"], ["top-tab-discover", "发现"], ["top-tab-local", "同城"]] as const) {
      const tab = screen.getByText(label);
      expect(tab.getAttribute("data-d2c-node-id")).toBe(id);
      expect(tab.textContent?.trim()).toBe(label);
    }
    // 文本证据是整段 textContent：Tab 按钮内不能混入其它文字
    expect(screen.getByText("商城").textContent).toBe("商城");
  });

  it("点击 Tab 回调携带完整 Tab 信息", () => {
    const onTabClick = vi.fn();
    render(<KwaiTopNavigation nodeId="pet-app-nav" tabs={[{ id: "pet-tab-pet", label: "养萌宠" }]} onTabClick={onTabClick} />);
    fireEvent.click(screen.getByText("养萌宠"));
    expect(onTabClick).toHaveBeenCalledWith({ id: "pet-tab-pet", label: "养萌宠" });
  });
});

describe("BottomTabBar", () => {
  it("四个 Tab 文本节点 + 发布按钮角标不进文本流", () => {
    render(<BottomTabBar publishBadge="23" />);
    for (const [id, label] of [["bottom-nav-home", "首页"], ["bottom-nav-feature", "精选"], ["bottom-nav-message", "消息"], ["bottom-nav-me", "我"]] as const) {
      const tab = document.querySelector(`[data-d2c-node-id="${id}"]`);
      expect(tab, id).toBeTruthy();
      // SVG 图标不产生 textContent，文本证据保持逐字一致
      expect(tab?.textContent?.trim()).toBe(label);
    }
    expect(document.querySelector('[data-d2c-node-id="bottom-nav"]')).toBeTruthy();
    expect(screen.getByLabelText("发布，23 条新内容")).toBeTruthy();
  });
});

describe("ArtworkSlice", () => {
  it("按归一化 crop 换算超采样偏移与缩放", () => {
    render(
      <ArtworkSlice
        nodeId="banner-art"
        atlasUrl={atlasUrl}
        crop={{ x: 0.02, y: 0.318, width: 0.458, height: 0.102 }}
        alt="心相印抽纸商品图"
      />,
    );
    const frame = document.querySelector('[data-d2c-node-id="banner-art"]') as HTMLElement;
    expect(frame.getAttribute("role")).toBe("img");
    expect(frame.getAttribute("aria-label")).toBe("心相印抽纸商品图");
    const image = frame.querySelector("img") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe(atlasUrl);
    expect(image.style.width).toBe(`${100 / 0.458}%`);
    expect(image.style.height).toBe(`${100 / 0.102}%`);
    expect(image.style.left).toBe(`${(-0.02 / 0.458) * 100}%`);
    expect(image.style.top).toBe(`${(-0.318 / 0.102) * 100}%`);
    expect(image.alt).toBe("");
  });
});

describe("ProductCard", () => {
  it("内部节点 id 由卡片 id 派生（-card 后缀剥除）且文案逐字一致", () => {
    render(
      <ProductCard
        nodeId="product-tissue-card"
        image={{ atlasUrl, crop: { x: 0.02, y: 0.318, width: 0.458, height: 0.102 }, alt: "心相印抽纸" }}
        title="【第3件0.01元】心相印抽纸"
        price="¥3.01"
        badge="品牌抽纸热销榜·第1名"
      />,
    );
    expect(document.querySelector('[data-d2c-node-id="product-tissue-card"]')).toBeTruthy();
    expect(document.querySelector('[data-d2c-node-id="product-tissue"] img')?.getAttribute("src")).toBe(atlasUrl);
    expect(document.querySelector('[data-d2c-node-id="product-tissue-title"]')?.textContent).toBe("【第3件0.01元】心相印抽纸");
    expect(document.querySelector('[data-d2c-node-id="product-tissue-price"]')?.textContent).toBe("¥3.01");
    expect(document.querySelector('[data-d2c-node-id="product-tissue-badge"]')?.textContent).toBe("品牌抽纸热销榜·第1名");
  });
});

describe("TaskCard", () => {
  it("标题/奖励/按钮三节点文案精确，完成后禁用并显示已完成", () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <TaskCard nodeId="task-install" title="下载安装「超自然行动组」" reward="完成后，我+200 ✦" actionLabel="去下载" onAction={onAction} />,
    );
    expect(document.querySelector('[data-d2c-node-id="task-install-title"]')?.textContent).toBe("下载安装「超自然行动组」");
    expect(document.querySelector('[data-d2c-node-id="task-install-reward"]')?.textContent).toBe("完成后，我+200 ✦");
    const action = document.querySelector('[data-d2c-node-id="task-install-action"]') as HTMLButtonElement;
    expect(action.textContent).toBe("去下载");
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);

    rerender(
      <TaskCard nodeId="task-install" title="下载安装「超自然行动组」" reward="完成后，我+200 ✦" actionLabel="去下载" done onAction={onAction} />,
    );
    expect((document.querySelector('[data-d2c-node-id="task-install-action"]') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-d2c-node-id="task-install-action"]')?.textContent).toBe("已完成");
  });
});

describe("RewardTile", () => {
  it("文案节点 id 为 nodeId-label", () => {
    render(<RewardTile nodeId="benefit-tile-dance" label="随机7天舞蹈礼包" icon="🎁" />);
    expect(document.querySelector('[data-d2c-node-id="benefit-tile-dance-label"]')?.textContent).toBe("随机7天舞蹈礼包");
  });
});

describe("ProgressCard", () => {
  it("提示/收入/入口/里程碑/大奖节点全部可寻址", () => {
    render(
      <ProgressCard
        nodeId="level-progress"
        hint="再升4级，开惊喜礼盒"
        hintId="level-progress-hint"
        income="0.1000元"
        incomeId="level-income"
        incomeLink="累计收入 ›"
        incomeLinkId="level-income-link"
        milestones={[
          { id: "level-milestone-first", label: "1级", tone: "done" },
          { id: "level-milestone-mid", label: "10级" },
          { id: "level-milestone-max", label: "55级" },
        ]}
        prize={{ id: "level-milestone-prize", label: "必拿大奖 88元" }}
      />,
    );
    expect(document.querySelector('[data-d2c-node-id="level-progress-hint"]')?.textContent).toBe("再升4级，开惊喜礼盒");
    expect(document.querySelector('[data-d2c-node-id="level-income"]')?.textContent).toBe("0.1000元");
    expect(document.querySelector('[data-d2c-node-id="level-income-link"]')?.textContent).toBe("累计收入 ›");
    expect(document.querySelector('[data-d2c-node-id="level-milestone-first"]')?.textContent).toBe("1级");
    expect(document.querySelector('[data-d2c-node-id="level-milestone-prize"]')?.textContent).toBe("必拿大奖 88元");
  });
});

describe("FloatingAction", () => {
  it("圆形入口文案节点 id 为 nodeId-label", () => {
    render(<FloatingAction nodeId="pet-signin" label="每日签到" badge="+10" icon="📅" />);
    const label = document.querySelector('[data-d2c-node-id="pet-signin-label"]');
    expect(label?.textContent).toBe("每日签到");
  });

  it("药丸入口单行文案不混入图标文字", () => {
    render(<FloatingAction nodeId="floating-back" label="‹ 回到赚钱任务" shape="pill" />);
    expect(document.querySelector('[data-d2c-node-id="floating-back-label"]')?.textContent).toBe("‹ 回到赚钱任务");
  });
});

describe("PrimaryActionButton", () => {
  it("主/副文案节点 id 可显式覆盖", () => {
    render(
      <PrimaryActionButton
        nodeId="pet-feed-button"
        title="首次喂食免费"
        titleId="pet-feed-label"
        subtitle="剩余 0 能量"
        subtitleId="pet-feed-energy"
      />,
    );
    expect(document.querySelector('[data-d2c-node-id="pet-feed-label"]')?.textContent).toBe("首次喂食免费");
    expect(document.querySelector('[data-d2c-node-id="pet-feed-energy"]')?.textContent).toBe("剩余 0 能量");
  });
});

describe("MobileActivityShell / PhoneStatusBar", () => {
  it("画布与状态栏挂载且状态栏无文本证据节点冲突", () => {
    render(
      <MobileActivityShell height={867} canvasBackgroundColor="#f6f7f9">
        <PhoneStatusBar nodeId="status-bar" time="9:41" />
      </MobileActivityShell>,
    );
    const statusBar = document.querySelector('[data-d2c-node-id="status-bar"]');
    expect(statusBar).toBeTruthy();
    expect(screen.getByText("9:41")).toBeTruthy();
  });
});
