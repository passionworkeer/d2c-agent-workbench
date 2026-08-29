import { useState, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from "react";
import { ArtworkSlice, MobileActivityShell } from "./shared";
import { FloatingAction, RewardTile, TaskCard } from "./cards";
import pageStyles from "./real-pages.module.css";

// 夏日游戏节任务页（真实截图混合重建）：
// 夜晚瀑布主视觉与立体字标题从参考图裁切；任务/福利/兑换/Tab 全部语义化组件。
// 星钻余额与任务完成态为本地演示交互，不接真实任务后台。

const HERO_ART_CROP = { x: 0, y: 0, width: 1, height: 0.357 };
const HERO_TITLE_CROP = { x: 0.03, y: 0.142, width: 0.42, height: 0.13 };

const box = (x: number, y: number, width: number, height: number): CSSProperties => ({
  position: "absolute",
  left: x,
  top: y,
  width,
  height,
});

const BENEFIT_TILES: Array<{ id: string; x: number; label: string; icon: ReactNode }> = [
  { id: "benefit-tile-dance", x: 8, label: "随机7天舞蹈礼包", icon: "💃" },
  { id: "benefit-tile-coin", x: 98, label: "铲铲币20000", icon: "🪙" },
  { id: "benefit-tile-lingqi", x: 188, label: "灵契100", icon: "📜" },
  { id: "benefit-tile-hat", x: 278, label: "小快头套", icon: "🎩" },
];

/** 夏日游戏节任务页。atlasUrl 指向本样例的参考图整图。 */
export function SummerGameFestivalExperience({ atlasUrl, ...root }: { atlasUrl: string } & ComponentPropsWithoutRef<"div">) {
  const [stars, setStars] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [doneTasks, setDoneTasks] = useState<Record<string, boolean>>({});
  const claim = (taskId: string, delta: number, message: string) => {
    setDoneTasks((current) => ({ ...current, [taskId]: true }));
    setStars((current) => current + delta);
    setToast(message);
  };

  return (
    <div data-activity-canvas-root="" {...root}>
      <MobileActivityShell height={823} pageBackground="#17181f" canvasBackgroundColor="#1c1038">
        <section style={box(0, 0, 390, 294)}>
          <ArtworkSlice nodeId="festival-hero-art" atlasUrl={atlasUrl} crop={HERO_ART_CROP} alt="夏日游戏节夜晚瀑布魔法场景主视觉" style={box(0, 0, 390, 294)} />
          <ArtworkSlice nodeId="festival-hero-title" atlasUrl={atlasUrl} crop={HERO_TITLE_CROP} alt="快手 · 夏日游音节立体金字标题" style={box(12, 117, 164, 107)} fit="contain" />
          <span data-d2c-node-id="festival-hero-date" style={box(16, 96, 64, 16)} className={pageStyles.heroDate}>7.1-8.31</span>
          <div style={box(220, 9, 160, 22)} className={pageStyles.starPill}>
            <span data-d2c-node-id="star-balance-label">我的星钻： {stars}</span>
          </div>
          <button type="button" data-d2c-node-id="hero-rule-entry" className={pageStyles.heroEntry} style={box(330, 52, 44, 44)} onClick={() => setToast("活动规则（本地演示）")}>
            <span data-d2c-node-id="hero-rule-label" className={pageStyles.heroEntryLabel}>规则</span>
          </button>
          <button type="button" data-d2c-node-id="hero-backpack-entry" className={pageStyles.heroEntry} style={box(330, 104, 44, 44)} onClick={() => setToast("我的背包（本地演示）")}>
            <span data-d2c-node-id="hero-backpack-label" className={pageStyles.heroEntryLabel}>背包</span>
          </button>
        </section>

        <div style={box(0, 272, 390, 38)} className={pageStyles.collabHeader}>
          <span data-d2c-node-id="collab-title" style={box(12, 9, 180, 20)} className={pageStyles.collabTitle}>超自然行动组 · 福利专场</span>
          <span data-d2c-node-id="collab-countdown" style={box(200, 10, 88, 18)} className={pageStyles.collabCountdown}>50 : 41 : 12</span>
          <span data-d2c-node-id="collab-calendar" style={box(318, 11, 62, 16)} className={pageStyles.collabCalendar}>专场日历 ›</span>
        </div>

        <section style={box(8, 318, 374, 116)} className={pageStyles.taskListCard}>
          <TaskCard
            nodeId="task-install"
            style={box(8, 8, 358, 50)}
            title="下载安装「超自然行动组」"
            reward="完成后，我+200 ✦"
            actionLabel="去下载"
            done={Boolean(doneTasks["task-install"])}
            icon={<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0 4-4m-4 4-4-4" stroke="#ffd76a" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 18h14" stroke="#ffd76a" strokeWidth="2" strokeLinecap="round" /></svg>}
            onAction={() => claim("task-install", 200, "安装完成，星钻 +200")}
          />
          <TaskCard
            nodeId="task-follow"
            style={box(8, 66, 358, 44)}
            title="关注 @AT-瑶瑶🎀（超自然行动组）"
            reward="完成+50 ✦"
            actionLabel="去关注"
            done={Boolean(doneTasks["task-follow"])}
            icon={<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.6-7-9.4A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7 2.6C19 15.4 12 20 12 20Z" fill="#ff5c7a" /></svg>}
            onAction={() => claim("task-follow", 50, "关注完成，星钻 +50")}
          />
        </section>

        <section style={box(8, 438, 374, 72)} className={pageStyles.benefitPanel}>
          <span data-d2c-node-id="benefit-title" style={box(8, 6, 170, 16)} className={pageStyles.benefitTitle}>超自然行动组专属福利</span>
          <button type="button" data-d2c-node-id="benefit-exchange" style={box(314, 7, 52, 14)} className={pageStyles.benefitExchange} onClick={() => setToast("兑换中心（本地演示）")}>
            立即兑换 ›
          </button>
          {BENEFIT_TILES.map((tile) => (
            <RewardTile
              key={tile.id}
              nodeId={tile.id}
              style={box(tile.x, 28, 85, 36)}
              label={tile.label}
              icon={tile.icon}
              onClick={() => setToast(`已兑换：${tile.label}`)}
            />
          ))}
        </section>

        <section style={box(8, 514, 374, 66)} className={pageStyles.rewardCards}>
          <div style={box(8, 8, 174, 50)} className={pageStyles.rewardCardRed}>
            <span data-d2c-node-id="reward-cash-title" style={box(10, 8, 70, 16)} className={pageStyles.rewardCardTitle}>现金红包</span>
            <span data-d2c-node-id="reward-cash-sub" style={box(10, 28, 90, 12)} className={pageStyles.rewardCardSub}>兑换可得现金</span>
            <button type="button" data-d2c-node-id="reward-cash-action" style={box(122, 14, 44, 22)} className={pageStyles.rewardCardAction} onClick={() => setToast("兑奖成功（本地演示）")}>
              兑奖
            </button>
          </div>
          <div style={box(190, 8, 174, 50)} className={pageStyles.rewardCardGold}>
            <span data-d2c-node-id="reward-draw-title" style={box(10, 8, 80, 16)} className={pageStyles.rewardCardTitle}>星钻抽大奖</span>
            <span data-d2c-node-id="reward-draw-sub" style={box(10, 28, 100, 12)} className={pageStyles.rewardCardSub}>有机会赢iPhone</span>
          </div>
        </section>

        <section style={box(8, 586, 374, 158)} className={pageStyles.dailyTasksCard}>
          <span data-d2c-node-id="daily-tasks-title" style={box(8, 6, 110, 18)} className={pageStyles.dailyTitle}>做任务赢星钻</span>
          <span data-d2c-node-id="daily-tasks-note" style={box(202, 10, 164, 12)} className={pageStyles.dailyNote}>任务每日24:00刷新，部分奖励可能延迟</span>
          <span data-d2c-node-id="daily-tasks-mine" style={box(25, 85, 72, 14)} className={pageStyles.dailyMineTab}>我的任务</span>
          <TaskCard
            nodeId="task-publish"
            style={box(23, 105, 359, 53)}
            title="发布作品"
            reward="+50 星钻"
            actionLabel="去发布"
            done={Boolean(doneTasks["task-publish"])}
            icon={<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="2.4" height="18" rx="1.2" fill="#ffd76a" /><rect x="3" y="10.8" width="18" height="2.4" rx="1.2" fill="#ffd76a" /></svg>}
            onAction={() => claim("task-publish", 50, "发布完成，星钻 +50")}
          />
        </section>

        <FloatingAction
          nodeId="live-task-overlay"
          shape="pill"
          label="去直播间做任务"
          labelId="live-task-label"
          style={box(100, 697, 188, 47)}
          onClick={() => setToast("进入直播间（本地演示）")}
        />

        <div style={box(0, 761, 390, 62)} className={pageStyles.activityTabs}>
          <button type="button" data-d2c-node-id="tab-tasks" className={pageStyles.activityTabActive} style={box(24, 13, 160, 36)}>
            做任务得星钻
          </button>
          <button type="button" data-d2c-node-id="tab-rank" className={pageStyles.activityTab} style={box(206, 13, 160, 36)} onClick={() => setToast("主播排行榜（本地演示）")}>
            主播排行榜
          </button>
        </div>

        {toast ? <div className={pageStyles.toast} role="status">{toast}</div> : null}
      </MobileActivityShell>
    </div>
  );
}

export default SummerGameFestivalExperience;
