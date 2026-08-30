import { useState, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from "react";
import { ArtworkSlice, BottomTabBar, KwaiTopNavigation, MobileActivityShell } from "./shared";
import { FloatingAction, PrimaryActionButton, ProgressCard, TaskCard, type ProgressMilestone } from "./cards";
import pageStyles from "./real-pages.module.css";

// 养萌宠红包养成页（真实截图混合重建）：
// 快手 logo 主标题与宠物舞台从参考图裁切；导航/进度卡/浮层/任务/底栏全部语义化组件。
// 能量、任务完成态为本地演示交互：能量为 0 时喂食提示「能量不足」，不会出现负数。

const HERO_TITLE_CROP = { x: 0.1706, y: 0.0624, width: 0.6508, height: 0.0775 };
const STAGE_ART_CROP = { x: 0, y: 0.2873, width: 1, height: 0.3516 };

const box = (x: number, y: number, width: number, height: number): CSSProperties => ({
  position: "absolute",
  left: x,
  top: y,
  width,
  height,
});

const MILESTONES: ProgressMilestone[] = [
  { id: "level-milestone-l1", label: "1级", tone: "done" },
  { id: "level-milestone-l5", label: "5级" },
  { id: "level-milestone-l10", label: "10级" },
  { id: "level-milestone-l15", label: "15级" },
  { id: "level-milestone-l20", label: "20级" },
  { id: "level-milestone-l55", label: "55级" },
];

interface PetTaskSpec {
  id: string;
  y: number;
  height: number;
  title: string;
  reward: string;
  energyGain: number;
  icon: ReactNode;
}

const PET_TASKS: PetTaskSpec[] = [
  {
    id: "pet-task-feed",
    y: 30,
    height: 40,
    title: "每日喂食",
    reward: "+10 能量",
    energyGain: 10,
    icon: "🍖",
  },
  {
    id: "pet-task-video",
    y: 75,
    height: 37,
    title: "观看视频",
    reward: "+5 能量",
    energyGain: 5,
    icon: "📺",
  },
  {
    id: "pet-task-share",
    y: 116,
    height: 38,
    title: "分享活动页",
    reward: "+15 能量",
    energyGain: 15,
    icon: "🔗",
  },
];

/** 养萌宠红包养成页。atlasUrl 指向本样例的参考图整图。texts 接收 codegen 注入后代文案覆盖（编辑穿透）；缺失时回落内置默认值，保证默认渲染与 spec 一致。 */
export function PetRedPacketExperience({ atlasUrl, texts, ...root }: { atlasUrl: string; texts?: Record<string, string> } & ComponentPropsWithoutRef<"div">) {
  const t = (id: string, fallback: string) => texts?.[id] ?? fallback;
  const [energy, setEnergy] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [doneTasks, setDoneTasks] = useState<Record<string, boolean>>({});

  const feed = () => {
    if (energy <= 0) {
      setToast("能量不足，先做任务赚能量吧");
      return;
    }
    setEnergy((current) => current - 1);
    setToast("喂食成功，宠物开心地摇了摇尾巴");
  };

  return (
    <div data-activity-canvas-root="" {...root}>
      <MobileActivityShell height={819} pageBackground="#17181f" canvasBackgroundColor="#5c1503">
        <KwaiTopNavigation
          nodeId="pet-app-nav"
          dark
          style={{ position: "absolute", top: 0, left: 0, width: 390, height: 42 }}
          activeTab="pet-tab-pet"
          tabs={[
            { id: "pet-tab-pet", label: t("pet-tab-pet", "养萌宠") },
            { id: "pet-tab-follow", label: t("pet-tab-follow", "关注") },
            { id: "pet-tab-mall", label: t("pet-tab-mall", "商城") },
            { id: "pet-tab-discover", label: t("pet-tab-discover", "发现") },
            { id: "pet-tab-local", label: t("pet-tab-local", "同城") },
          ]}
        />

        <section style={box(0, 42, 390, 102)} className={pageStyles.petHero}>
          <ArtworkSlice nodeId="pet-hero-title" atlasUrl={atlasUrl} crop={HERO_TITLE_CROP} alt="快手 养萌宠赢88元红包立体字标题" style={box(67, 9, 254, 63)} fit="contain" />
          <div style={box(54, 77, 283, 22)} className={pageStyles.petNotice}>
            <span data-d2c-node-id="pet-hero-notice-text" style={box(6, 4, 271, 14)}>{t("pet-hero-notice-text", "活动时间结束后，宠物玩法即将焕新回归")}</span>
          </div>
          <button type="button" data-d2c-node-id="pet-hero-share" className={pageStyles.petSideEntry} style={box(345, 11, 34, 33)} onClick={() => setToast("分享活动页（本地演示）")}>
            {t("pet-hero-share", "分享")}
          </button>
          <button type="button" data-d2c-node-id="pet-hero-wallet" className={pageStyles.petSideEntry} style={box(345, 60, 34, 34)} onClick={() => setToast("我的钱包（本地演示）")}>
            {t("pet-hero-wallet", "钱包")}
          </button>
        </section>

        <ProgressCard
          nodeId="level-progress"
          style={box(21, 144, 349, 90)}
          hint={t("level-progress-hint", "再升4级，开惊喜礼盒")}
          hintId="level-progress-hint"
          income={t("level-income", "0.10元")}
          incomeId="level-income"
          incomeLink={t("level-income-link", "累计收入 ›")}
          incomeLinkId="level-income-link"
          milestones={MILESTONES.map((milestone) => ({ ...milestone, label: t(milestone.id, milestone.label) }))}
          prize={{ id: "level-milestone-prize", label: t("level-milestone-prize", "88元") }}
        />

        <section data-d2c-node-id="pet-stage" style={box(0, 234, 390, 369)}>
          <ArtworkSlice nodeId="pet-stage-art" atlasUrl={atlasUrl} crop={STAGE_ART_CROP} alt="穿香蕉服饰的宠物比比拉布站在红色圆台上" style={box(0, 1, 390, 288)} />
          <span data-d2c-node-id="pet-name" style={box(174, 298, 42, 11)} className={pageStyles.petName}>{t("pet-name", "比比拉布")}</span>
          <span data-d2c-node-id="pet-level-bubble" style={box(125, 298, 22, 14)} className={pageStyles.petLevelBubble}>{t("pet-level-bubble", "Lv.1")}</span>
          <span data-d2c-node-id="pet-hint-bubble" style={box(161, 315, 101, 13)} className={pageStyles.petHintBubble}>{t("pet-hint-bubble", "喂食必得装扮")}</span>

          <FloatingAction nodeId="pet-signin" badge="+10" label={t("pet-signin-label", "每日签到")} icon="📅" style={box(265, 14, 50, 50)} onClick={() => setToast("签到成功，金币 +10")} />
          <FloatingAction nodeId="pet-summer-night" label={t("pet-summer-night-label", "超级夏晚")} icon="🎪" style={box(51, 18, 46, 48)} onClick={() => setToast("超级夏晚（本地演示）")} />
          <FloatingAction nodeId="pet-level-claim" label={t("pet-level-claim-label", "18级领取")} icon="🔮" style={box(257, 68, 53, 50)} onClick={() => setToast("达到 18 级后可领取")} />
          <FloatingAction nodeId="pet-wardrobe" label={t("pet-wardrobe-label", "我的衣橱")} icon="👗" style={box(9, 83, 42, 48)} onClick={() => setToast("我的衣橱（本地演示）")} />
          <FloatingAction nodeId="pet-claim" label={t("pet-claim-label", "点击领取")} icon="🎁" style={box(19, 130, 40, 50)} onClick={() => setToast("礼物已领取（本地演示）")} />

          <button type="button" data-d2c-node-id="pet-blindbox" className={pageStyles.petBlindbox} style={box(308, 162, 64, 64)} onClick={() => setToast("开盲盒赢现金（本地演示）")}>
            <span data-d2c-node-id="pet-blindbox-title" style={box(8, 8, 48, 14)}>{t("pet-blindbox-title", "惊喜？")}</span>
            <span data-d2c-node-id="pet-blindbox-cash" style={box(8, 38, 48, 18)} className={pageStyles.petBlindboxCash}>{t("pet-blindbox-cash", "赢现金")}</span>
          </button>

          <div data-d2c-node-id="feed-action" style={box(8, 326, 374, 36)}>
            <div style={box(0, 6, 86, 32)} className={pageStyles.petPk}>
              <span data-d2c-node-id="pet-pk-title" style={box(14, 2, 58, 12)}>{t("pet-pk-title", "再赢88元")}</span>
              <button type="button" data-d2c-node-id="pet-pk-action" style={box(14, 16, 58, 18)} className={pageStyles.petPkAction} onClick={() => setToast("宠物 PK（本地演示）")}>
                {t("pet-pk-action", "去PK")}
              </button>
            </div>
            <PrimaryActionButton
              nodeId="pet-feed-button"
              style={box(96, 0, 182, 36)}
              title={t("pet-feed-label", "首次喂食免费")}
              titleId="pet-feed-label"
              subtitle={`${t("pet-feed-energy-prefix", "剩余 ")}${energy}${t("pet-feed-energy-suffix", " 能量")}`}
              subtitleId="pet-feed-energy"
              onClick={feed}
            />
            <FloatingAction
              nodeId="pet-earn-energy"
              shape="pill"
              tone="primary"
              label={t("pet-earn-energy-label", "赚能量")}
              style={{ ...box(286, 2, 80, 32), height: 32, padding: "0 10px" }}
              onClick={() => setToast("做任务赚能量（本地演示）")}
            />
          </div>
        </section>

        <section data-d2c-node-id="pet-task-section" style={box(0, 604, 390, 156)} className={pageStyles.petTaskSection}>
          <span data-d2c-node-id="pet-task-title" style={box(15, 8, 110, 15)} className={pageStyles.petTaskTitle}>{t("pet-task-title", "做任务赚食物能量")}</span>
          <button type="button" data-d2c-node-id="pet-task-link" style={box(301, 10, 52, 12)} className={pageStyles.petTaskLink} onClick={() => setToast("全部任务（本地演示）")}>
            {t("pet-task-link", "全部 ›")}
          </button>
          {PET_TASKS.map((task) => (
            <TaskCard
              key={task.id}
              nodeId={task.id}
              tone="light"
              style={box(8, task.y, 374, task.height)}
              title={t(`${task.id}-title`, task.title)}
              reward={t(`${task.id}-reward`, task.reward)}
              actionLabel={t(`${task.id}-action`, "去完成")}
              icon={task.icon}
              done={Boolean(doneTasks[task.id])}
              onAction={() => {
                setDoneTasks((current) => ({ ...current, [task.id]: true }));
                setEnergy((current) => current + task.energyGain);
                setToast(`${t(`${task.id}-title`, task.title)}完成，能量 +${task.energyGain}`);
              }}
            />
          ))}
        </section>

        <BottomTabBar publishBadge="23" height={53} texts={texts} />

        {toast ? <div className={pageStyles.toast} role="status">{toast}</div> : null}
      </MobileActivityShell>
    </div>
  );
}

export default PetRedPacketExperience;
