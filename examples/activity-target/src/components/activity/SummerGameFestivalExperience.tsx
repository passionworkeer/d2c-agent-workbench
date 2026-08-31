import { useState, type ComponentPropsWithoutRef, type CSSProperties } from "react";
import { ArtworkSlice, MobileActivityShell } from "./shared";
import { TaskCard } from "./cards";
import styles from "./festival.module.css";
import pageStyles from "./real-pages.module.css";

// 原图 1260×2660。仅裁场景、头像和道具；文案、账户、按钮和 Tab 均为 DOM。
const box = (x: number, y: number, width: number, height: number): CSSProperties => ({ position: "absolute", left: x, top: y, width, height });
const crop = (x: number, y: number, width: number, height: number) => ({ x: x / 390, y: y / (2660 * 390 / 1260), width: width / 390, height: height / (2660 * 390 / 1260) });
const BENEFITS = [
  { id: "benefit-tile-dance", label: "随机7天舞蹈礼包", x: 30, width: 101, image: [58, 412, 41, 34] },
  { id: "benefit-tile-coin", label: "铲铲币20000", x: 135, width: 88, image: [158, 413, 44, 32] },
  { id: "benefit-tile-lingqi", label: "灵契100", x: 227, width: 64, image: [247, 413, 25, 33] },
  { id: "benefit-tile-hat", label: "小快头套", x: 294, width: 67, image: [313, 413, 31, 34] },
] as const;

export function SummerGameFestivalExperience({ atlasUrl, texts, ...root }: { atlasUrl: string; texts?: Record<string, string> } & ComponentPropsWithoutRef<"div">) {
  const t = (id: string, fallback: string) => texts?.[id] ?? fallback;
  const [stars, setStars] = useState(0);
  // 生成器传入的是包含初始数字的完整文案，不可再直接拼接动态余额。
  const balancePrefix = t("star-balance-label", "我的星钻： ").replace(/\d+\s*$/, "");
  const [toast, setToast] = useState<string | null>(null);
  const [doneTasks, setDoneTasks] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState("tab-tasks");
  const claim = (id: string, value: number) => {
    if (doneTasks[id]) return;
    setDoneTasks((current) => ({ ...current, [id]: true }));
    setStars((current) => current + value);
    setToast(`任务完成，星钻 +${value}`);
  };
  const art = (id: string, source: readonly [number, number, number, number], style: CSSProperties, alt = "") => (
    <ArtworkSlice nodeId={id} atlasUrl={atlasUrl} crop={crop(...source)} style={style} alt={alt} />
  );

  return (
    <div data-activity-canvas-root="" {...root}>
      <MobileActivityShell height={823} pageBackground="#17181f" canvasBackgroundColor="#100d35">
        <div className={styles.page}>
          <section data-d2c-node-id="festival-hero" style={box(0, 0, 390, 245)}>
            {/* 装饰素材排除账户/规则/背包/联动标题，避免任何动态文字烘焙。 */}
            <img data-d2c-node-id="festival-hero-art" className={styles.heroArt} src="/game-festival/hero-scene.png" alt="夏日游戏节夜晚瀑布、少女与活动艺术字" />
            <div data-d2c-node-id="festival-hero-title" hidden />
            <span data-d2c-node-id="festival-hero-date" hidden>{t("festival-hero-date", "7.1-8.31")}</span>
            <button className={styles.back} aria-label="返回" onClick={() => setToast("返回活动（本地演示）")}>‹</button>
            <button data-d2c-node-id="star-balance" className={styles.balance} onClick={() => setToast(`我的星钻：${stars}`)}>
              {art("star-gem", [273, 13, 16, 17], { width: 16, height: 17 })}
              <span data-d2c-node-id="star-balance-label">{`${balancePrefix}${stars}`}</span><span aria-hidden="true">›</span>
            </button>
            <button data-d2c-node-id="hero-rule-entry" className={styles.heroEntry} style={box(345, 52, 30, 30)} onClick={() => setToast("活动规则（本地演示）")}><span data-d2c-node-id="hero-rule-label">{t("hero-rule-label", "规则")}</span></button>
            <button data-d2c-node-id="hero-backpack-entry" className={styles.heroEntry} style={box(345, 89, 30, 30)} onClick={() => setToast("我的背包（本地演示）")}><span data-d2c-node-id="hero-backpack-label">{t("hero-backpack-label", "背包")}</span></button>
          </section>
          <header data-d2c-node-id="collab-header" className={styles.collabHeader} style={box(15, 209, 360, 30)}>
            <h1 data-d2c-node-id="collab-title">{t("collab-title", "超自然行动组 · 福利专场")}</h1>
            <span data-d2c-node-id="collab-countdown" className={styles.countdown}>{t("collab-countdown", "50 : 41 : 12")}</span>
            <button data-d2c-node-id="collab-calendar" onClick={() => setToast("专场日历（本地演示）")}>{t("collab-calendar", "专场日历 ›")}</button>
          </header>
          <section data-d2c-node-id="task-list" className={styles.collabPanel} style={box(15, 245, 360, 239)}>
            <TaskCard nodeId="task-install" className={styles.task} style={box(15, 15, 331, 38)} title={t("task-install-title", "下载安装「超自然行动组」")} reward={t("task-install-reward", "完成后，我+200 ✦")} actionLabel={t("task-install-action", "去下载")} done={Boolean(doneTasks["task-install"])} icon={art("install-avatar", [30, 261, 38, 37], { width: 38, height: 38 }, "超自然行动组游戏头像")} onAction={() => claim("task-install", 200)} />
            <TaskCard nodeId="task-follow" className={`${styles.task} ${styles.follow}`} style={box(15, 83, 331, 38)} title={t("task-follow-title", "关注 @AT-瑶瑶🎀（超自然行动组）")} reward={t("task-follow-reward", "完成+50 ✦")} actionLabel={t("task-follow-action", "去关注")} done={Boolean(doneTasks["task-follow"])} icon={art("follow-avatar", [31, 328, 37, 38], { width: 38, height: 38 }, "瑶瑶头像")} onAction={() => claim("task-follow", 50)} />
          </section>
          <section data-d2c-node-id="benefit-panel" className={styles.benefits} style={box(30, 376, 331, 94)}>
            <div className={styles.benefitHeading}><span data-d2c-node-id="benefit-title">{t("benefit-title", "超自然行动组专属福利")}</span><button data-d2c-node-id="benefit-exchange" onClick={() => setToast("兑换中心（本地演示）")}>{t("benefit-exchange", "立即兑换 ›")}</button></div>
            {BENEFITS.map((item) => <button key={item.id} data-d2c-node-id={item.id} className={styles.benefit} style={box(item.x - 30, 31, item.width, 63)} onClick={() => setToast(`已兑换：${t(`${item.id}-label`, item.label)}`)}>
              {art(`${item.id}-art`, item.image, { width: item.image[2], height: item.image[3] }, item.label)}
              <span data-d2c-node-id={`${item.id}-label`}>{t(`${item.id}-label`, item.label)}</span>
            </button>)}
          </section>
          <h2 className={styles.sectionTitle} style={box(15, 501, 150, 29)}>星钻好礼</h2>
          <section data-d2c-node-id="reward-cards" style={box(15, 537, 360, 65)} className={styles.rewards}>
            <div data-d2c-node-id="reward-cash" className={styles.cashCard}>
              {art("cash-art", [25, 552, 53, 36], { position: "absolute", left: 8, top: 14, width: 53, height: 36 }, "紫金红包道具")}
              <span data-d2c-node-id="reward-cash-title" className={styles.rewardTitle}>{t("reward-cash-title", "现金红包")}</span>
              <span data-d2c-node-id="reward-cash-sub" className={styles.rewardSub}>{t("reward-cash-sub", "兑换可得现金")}</span>
              <button data-d2c-node-id="reward-cash-action" className={styles.goldButton} onClick={() => setToast("兑奖成功（本地演示）")}>{t("reward-cash-action", "兑奖")}</button>
            </div>
            <button data-d2c-node-id="reward-draw" className={styles.drawCard} onClick={() => setToast("星钻抽大奖（本地演示）")}><span data-d2c-node-id="reward-draw-title">{t("reward-draw-title", "星钻抽大奖")}</span><small data-d2c-node-id="reward-draw-sub">{t("reward-draw-sub", "有机会赢iPhone")}</small></button>
          </section>
          <section data-d2c-node-id="daily-tasks" style={box(15, 619, 360, 190)}>
            <header className={styles.dailyHeading}><h2 data-d2c-node-id="daily-tasks-title" className={styles.sectionTitle}>{t("daily-tasks-title", "做任务赢星钻")}</h2><span data-d2c-node-id="daily-tasks-note">{t("daily-tasks-note", "任务每日24:00刷新，部分奖励可能延迟")}</span></header>
            <div className={styles.dailyCard}>
              <h3 data-d2c-node-id="daily-tasks-mine">{t("daily-tasks-mine", "我的任务")}</h3>
              <button className={styles.refresh} aria-label="刷新任务" onClick={() => setToast("任务状态已刷新")}>↻</button>
              <TaskCard nodeId="task-publish" className={styles.task} style={box(15, 49, 331, 38)} title={t("task-publish-title", "发布作品")} reward={t("task-publish-reward", "+50 星钻")} actionLabel={t("task-publish-action", "去发布")} done={Boolean(doneTasks["task-publish"])} icon={<span className={styles.publishIcon}>♯</span>} onAction={() => claim("task-publish", 50)} />
            </div>
          </section>
          <button data-d2c-node-id="live-task-overlay" className={styles.liveButton} style={box(101, 697, 188, 49)} onClick={() => setToast("进入直播间（本地演示）")}><span data-d2c-node-id="live-task-label">{t("live-task-label", "去直播间做任务")}</span></button>
          <div data-d2c-node-id="activity-tabs" className={styles.tabs} role="tablist" aria-label="活动导航">
            <button role="tab" aria-selected={tab === "tab-tasks"} data-d2c-node-id="tab-tasks" onClick={() => setTab("tab-tasks")}>{t("tab-tasks", "做任务得星钻")}</button>
            <button role="tab" aria-selected={tab === "tab-rank"} data-d2c-node-id="tab-rank" onClick={() => { setTab("tab-rank"); setToast("主播排行榜（本地演示）"); }}>{t("tab-rank", "主播排行榜")}</button>
          </div>
          <div className={styles.homeIndicator} />
          {toast ? <div className={pageStyles.toast} role="status">{toast}</div> : null}
        </div>
      </MobileActivityShell>
    </div>
  );
}
export default SummerGameFestivalExperience;
