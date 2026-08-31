import { useRef, useState, type ComponentPropsWithoutRef, type CSSProperties } from "react";
import { ArtworkSlice, BottomTabBar, KwaiTopNavigation, MobileActivityShell } from "./shared";
import { TaskCard } from "./cards";
import styles from "./pet.module.css";
import pageStyles from "./real-pages.module.css";

const box = (x: number, y: number, width: number, height: number): CSSProperties => ({ position: "absolute", left: x, top: y, width, height });
const crop = (x: number, y: number, width: number, height: number) => ({ x: x / 390, y: y / (2645 * 390 / 1260), width: width / 390, height: height / (2645 * 390 / 1260) });
const TASKS = [
  { id: "pet-task-feed", title: "每日喂食", reward: "+10 能量", gain: 10 },
  { id: "pet-task-video", title: "观看视频", reward: "+5 能量", gain: 5 },
  { id: "pet-task-share", title: "分享活动页", reward: "+15 能量", gain: 15 },
] as const;

// 仅场景/宠物/无字道具使用局部裁切。里程碑、入口、气泡和按钮始终可编辑。
export function PetRedPacketExperience({ atlasUrl, texts, ...root }: { atlasUrl: string; texts?: Record<string, string> } & ComponentPropsWithoutRef<"div">) {
  const t = (id: string, fallback: string) => texts?.[id] ?? fallback;
  const [energy, setEnergy] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [nav, setNav] = useState("pet-tab-pet");
  const scroll = useRef<HTMLDivElement>(null);
  const art = (id: string, source: readonly [number, number, number, number], style: CSSProperties, alt = "") => <ArtworkSlice nodeId={id} atlasUrl={atlasUrl} crop={crop(...source)} style={style} alt={alt} />;
  const feed = () => {
    if (energy <= 0) { setToast("能量不足，先做任务赚能量吧"); return; }
    setEnergy((value) => value - 1);
    setToast("喂食成功，宠物开心地摇了摇尾巴");
  };
  const earn = () => { if (scroll.current) scroll.current.scrollTop = 190; };
  return (
    <div data-activity-canvas-root="" {...root}>
      <MobileActivityShell height={819} pageBackground="#17181f" canvasBackgroundColor="#751700">
        <div className={styles.page} ref={scroll}>
          <div className={styles.content}>
            <img data-d2c-node-id="pet-stage-art" className={styles.stageArt} src="/pet-red-packet/stage-scene.png" alt="红金聚光舞台和穿香蕉服饰的宠物比比拉布" />
            <KwaiTopNavigation nodeId="pet-app-nav" dark className={styles.navigation} style={box(0, 0, 390, 42)} activeTab={nav} onTabClick={(item) => { setNav(item.id); setToast(item.label); }} tabs={[
              { id: "pet-tab-pet", label: t("pet-tab-pet", "养萌宠") },
              { id: "pet-tab-follow", label: t("pet-tab-follow", "关注") },
              { id: "pet-tab-mall", label: t("pet-tab-mall", "商城") },
              { id: "pet-tab-discover", label: t("pet-tab-discover", "发现") },
              { id: "pet-tab-local", label: t("pet-tab-local", "同城") },
            ]} />
            <section data-d2c-node-id="pet-hero" style={box(0, 42, 390, 102)}>
              {art("pet-hero-title", [67, 51, 254, 63], box(67, 9, 254, 63), "快手 养萌宠赢88元红包")}
              <button className={styles.sideEntry} style={box(11, 5, 34, 34)} onClick={() => setToast("更多活动（本地演示）")}>更多</button>
              <button data-d2c-node-id="pet-hero-share" className={styles.sideEntry} style={box(345, 5, 34, 34)} onClick={() => setToast("分享活动页（本地演示）")}>{t("pet-hero-share", "分享")}</button>
              <button data-d2c-node-id="pet-hero-wallet" className={styles.sideEntry} style={box(345, 53, 34, 34)} onClick={() => setToast("我的钱包（本地演示）")}>{t("pet-hero-wallet", "钱包")}</button>
              <div data-d2c-node-id="pet-hero-notice" className={styles.notice} style={box(83, 75, 228, 17)}><span aria-hidden="true">◀</span><span data-d2c-node-id="pet-hero-notice-text">{t("pet-hero-notice-text", "活动时间结束后，宠物玩法即将焕新回归")}</span></div>
            </section>

            <section data-d2c-node-id="level-progress" className={styles.progress} style={box(37, 144, 316, 90)}>
              <span data-d2c-node-id="level-progress-hint" className={styles.progressHint}>{t("level-progress-hint", "再升4级，开惊喜礼盒")}</span>
              <div className={styles.income}><strong data-d2c-node-id="level-income">{t("level-income", "0.1000元")}</strong><button data-d2c-node-id="level-income-link" onClick={() => setToast("累计收入（本地演示）")}>{t("level-income-link", "累计收入 ›")}</button></div>
              <div className={styles.milestones}>
                {[1, 5, 10, 15, 20].map((level, index) => <div className={styles.milestone} key={level}>
                  {index === 0 ? <div className={styles.received}><small>已领</small><strong>0.10</strong></div> : art(`level-gift-${level}`, level === 10 ? [212, 174, 26, 32] : [174, 174, 28, 32], { width: 28, height: 32 }, "等级礼盒")}
                  <span data-d2c-node-id={`level-milestone-l${level}`}>{t(`level-milestone-l${level}`, `${level}级`)}</span>
                </div>)}
              </div>
              <div className={styles.prize}><div><small>必拿大奖</small><strong data-d2c-node-id="level-milestone-prize">{t("level-milestone-prize", "88元")}</strong></div><span data-d2c-node-id="level-milestone-l55">{t("level-milestone-l55", "55级")}</span></div>
            </section>

            <section data-d2c-node-id="pet-stage" style={box(0, 234, 390, 369)}>
              <button data-d2c-node-id="pet-signin" className={styles.stageEntry} style={box(253, 28, 48, 45)} onClick={() => setToast("签到成功，金币 +10")}><span className={styles.orb}><b className={styles.lightning}>ϟ</b></span><em className={styles.signBadge}>+10</em><span data-d2c-node-id="pet-signin-label">{t("pet-signin-label", "每日签到")}</span></button>
              <button data-d2c-node-id="pet-wardrobe" className={styles.stageEntry} style={box(5, 79, 51, 46)} onClick={() => setToast("我的衣橱（本地演示）")}>{art("wardrobe-art", [8, 313, 48, 31], { width: 48, height: 31 }, "香蕉衣橱")}<span data-d2c-node-id="pet-wardrobe-label">{t("pet-wardrobe-label", "我的衣橱")}</span></button>
              <button data-d2c-node-id="pet-claim" className={styles.stageEntry} style={box(5, 143, 49, 45)} onClick={() => setToast("礼物已领取（本地演示）")}>{art("claim-art", [8, 377, 43, 32], { width: 43, height: 32 }, "红色礼物盒")}<span data-d2c-node-id="pet-claim-label">{t("pet-claim-label", "点击领取")}</span></button>
              <button data-d2c-node-id="pet-summer-night" className={styles.stageEntry} style={box(334, 78, 56, 48)} onClick={() => setToast("超级夏晚（本地演示）")}>{art("summer-night-art", [335, 313, 54, 32], { width: 54, height: 32 }, "超级夏晚活动插画")}<span data-d2c-node-id="pet-summer-night-label">{t("pet-summer-night-label", "超级夏晚")}</span></button>
              <button data-d2c-node-id="pet-level-claim" className={styles.stageEntry} style={box(276, 95, 48, 45)} onClick={() => setToast("达到 18 级后可领取")}><span className={styles.orb}>{art("wand-art", [291, 337, 13, 20], { width: 13, height: 20 }, "星星魔法棒")}</span><span data-d2c-node-id="pet-level-claim-label">{t("pet-level-claim-label", "18级领取")}</span></button>
              <button data-d2c-node-id="pet-blindbox" className={styles.blindbox} style={box(328, 207, 62, 74)} onClick={() => setToast("开盲盒赢现金（本地演示）")}><span data-d2c-node-id="pet-blindbox-title" className={styles.cube}>{t("pet-blindbox-title", "惊喜？")}</span><span className={styles.cash}><strong data-d2c-node-id="pet-blindbox-cash">{t("pet-blindbox-cash", "赢现金")}</strong><small>开盲盒赚钱</small></span></button>
              <span data-d2c-node-id="pet-name" className={styles.petName} style={box(173, 299, 46, 14)}>{t("pet-name", "比比拉布")}</span>
              <div className={styles.levelRail} style={box(125, 322, 142, 18)}><span data-d2c-node-id="pet-level-bubble">{t("pet-level-bubble", "Lv.1")}</span></div>
              <span data-d2c-node-id="pet-hint-bubble" className={styles.hint} style={box(146, 319, 98, 39)}>{t("pet-hint-bubble", "喂食必得装扮")}</span>
            </section>

            <div data-d2c-node-id="feed-action" style={box(0, 603, 390, 87)}>
              <div data-d2c-node-id="pet-pk-button" style={box(0, 9, 84, 73)}>
                <div className={styles.pkBadge} style={box(15, 0, 69, 25)}><span data-d2c-node-id="pet-pk-title">{t("pet-pk-title", "再赢88元")}</span></div>
                <button data-d2c-node-id="pet-pk-action" className={styles.sideAction} style={box(0, 15, 79, 58)} onClick={() => setToast("宠物 PK（本地演示）")}>{t("pet-pk-action", "去PK")}</button>
              </div>
              <button data-d2c-node-id="pet-feed-button" className={styles.feedButton} style={box(98, 0, 194, 84)} onClick={feed}><strong data-d2c-node-id="pet-feed-label">{t("pet-feed-label", "首次喂食免费")}</strong><span data-d2c-node-id="pet-feed-energy">{`${t("pet-feed-energy-prefix", "剩余 ")}${energy}${t("pet-feed-energy-suffix", " 能量")}`}</span></button>
              <button data-d2c-node-id="pet-earn-energy" className={styles.sideAction} style={box(312, 24, 78, 58)} onClick={earn}><span data-d2c-node-id="pet-earn-energy-label">{t("pet-earn-energy-label", "赚能量")}</span></button>
            </div>

            <section data-d2c-node-id="pet-task-section" className={styles.taskSection} style={box(0, 703, 390, 280)}>
              <h2 data-d2c-node-id="pet-task-title">{t("pet-task-title", "做任务赚食物能量")}</h2>
              <button data-d2c-node-id="pet-task-link" className={styles.allTasks} onClick={() => setToast("全部任务（本地演示）")}>{t("pet-task-link", "全部 ›")}</button>
              {TASKS.map((task, index) => <TaskCard key={task.id} nodeId={task.id} tone="light" style={box(12, 80 + index * 56, 366, 48)} title={t(`${task.id}-title`, task.title)} reward={t(`${task.id}-reward`, task.reward)} actionLabel={t(`${task.id}-action`, "去完成")} icon={<span className={styles.taskNumber}>{index + 1}</span>} done={Boolean(done[task.id])} onAction={() => { if (done[task.id]) return; setDone((current) => ({ ...current, [task.id]: true })); setEnergy((current) => current + task.gain); setToast(`${task.title}完成，能量 +${task.gain}`); }} />)}
            </section>
          </div>
        </div>
        <BottomTabBar appearance="reference" height={53} texts={texts} />
        {toast ? <div className={pageStyles.toast} role="status">{toast}</div> : null}
      </MobileActivityShell>
    </div>
  );
}
export default PetRedPacketExperience;
