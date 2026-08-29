import type { CSSProperties, ReactNode } from "react";
import styles from "./activity.module.css";

// 活动页企业组件（共享层）：三个真实活动页共用的骨架、导航、底栏与素材裁切。
// 所有携带文案的元素都渲染 data-d2c-node-id，供 Playwright 采集几何与文本证据。

/** 归一化裁切区域（0-1，对应 examples/activity-pages 下 assets/manifest.json 的 crop） */
export interface ActivityCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ActivityTabItem {
  id: string;
  label: string;
}

interface NodeProps {
  nodeId: string;
}

/**
 * 390px 手机画布：手机宽度全屏还原；桌面端居中、两侧深色背景。
 * 画布宽度严格 390px（评测基准视口），页面内容全部约束在画布内，杜绝横向溢出。
 */
export function MobileActivityShell({
  height,
  pageBackground = "#0e1014",
  canvasBackgroundColor = "#ffffff",
  children,
}: {
  height: number;
  pageBackground?: string;
  canvasBackgroundColor?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.shell} style={{ backgroundColor: pageBackground }}>
      <div
        className={styles.canvas}
        style={{ height: `${height}px`, backgroundColor: canvasBackgroundColor }}
      >
        {children}
      </div>
    </div>
  );
}

/** 系统状态栏：时间 + 信号/电量示意（无文本证据节点，纯视觉） */
export function PhoneStatusBar({ nodeId = "status-bar", time = "9:41" }: { nodeId?: string; time?: string }) {
  return (
    <div data-d2c-node-id={nodeId} className={styles.statusBar} aria-hidden="true">
      <span className={styles.statusTime}>{time}</span>
      <span className={styles.statusIcons}>
        <svg viewBox="0 0 18 12" className={styles.statusSignal}>
          <rect x="0" y="8" width="3" height="4" rx="1" />
          <rect x="5" y="5" width="3" height="7" rx="1" />
          <rect x="10" y="2" width="3" height="10" rx="1" />
          <rect x="15" y="0" width="3" height="12" rx="1" opacity="0.35" />
        </svg>
        <svg viewBox="0 0 16 12" className={styles.statusWifi}>
          <path d="M8 10.8 6.2 8.9a2.6 2.6 0 0 1 3.6 0Z" />
          <path d="M3.6 6.2a6.4 6.4 0 0 1 8.8 0l-1.5 1.6a4.3 4.3 0 0 0-5.8 0Z" opacity="0.9" />
          <path d="M1 3.4a10.2 10.2 0 0 1 14 0l-1.5 1.6a8.1 8.1 0 0 0-11 0Z" opacity="0.8" />
        </svg>
        <span className={styles.statusBattery}>
          <span className={styles.statusBatteryFill} />
        </span>
      </span>
    </div>
  );
}

/** App 顶部导航：菜单 + 活动 Tab 组 + 搜索（Tab 文案节点逐一可评测） */
export function KwaiTopNavigation({
  nodeId,
  tabs,
  activeTab,
  dark = false,
  onTabClick,
}: NodeProps & {
  tabs: ActivityTabItem[];
  activeTab?: string;
  dark?: boolean;
  onTabClick?: (tab: ActivityTabItem) => void;
}) {
  return (
    <header
      data-d2c-node-id={nodeId}
      className={[styles.topNav, dark ? styles.topNavDark : ""].filter(Boolean).join(" ")}
    >
      <button type="button" className={styles.topNavMenu} aria-label="菜单">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2" y="3.5" width="16" height="2.2" rx="1.1" />
          <rect x="2" y="8.9" width="16" height="2.2" rx="1.1" />
          <rect x="2" y="14.3" width="16" height="2.2" rx="1.1" />
        </svg>
        <span className={styles.topNavBadge} aria-hidden="true">99+</span>
      </button>
      <nav className={styles.topNavTabs} aria-label="活动导航">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-d2c-node-id={tab.id}
            className={[styles.topNavTab, tab.id === activeTab ? styles.topNavTabActive : ""].filter(Boolean).join(" ")}
            aria-current={tab.id === activeTab ? "page" : undefined}
            onClick={onTabClick ? () => onTabClick(tab) : undefined}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <button type="button" className={styles.topNavSearch} aria-label="搜索">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="9" cy="9" r="6" fill="none" strokeWidth="2" stroke="currentColor" />
          <line x1="13.6" y1="13.6" x2="18" y2="18" strokeWidth="2" stroke="currentColor" strokeLinecap="round" />
        </svg>
      </button>
    </header>
  );
}

const BOTTOM_TAB_ICONS = [
  // 首页
  "M3 10.4 10 4l7 6.4V17a1 1 0 0 1-1 1h-4v-5h-4v5H4a1 1 0 0 1-1-1Z",
  // 精选
  "M10 3.2 12.3 8l5.2.6-3.9 3.5 1.1 5.1L10 14.6l-4.7 2.6 1.1-5.1L2.5 8.6 7.7 8Z",
  // 消息
  "M3.5 5.5A2 2 0 0 1 5.5 3.5h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8.5l-5 3.5Z",
  // 我
  "M10 4a3.2 3.2 0 1 1 0 6.4A3.2 3.2 0 0 1 10 4Zm-6 13.2c.8-3.1 3.1-4.8 6-4.8s5.2 1.7 6 4.8Z",
];

/** 固定底部导航：首页 / 精选 / ＋发布（角标）/ 消息 / 我 */
export function BottomTabBar({
  nodeId = "bottom-nav",
  publishBadge,
  activeTab = "home",
  onTabClick,
}: Partial<NodeProps> & {
  publishBadge?: string;
  activeTab?: string;
  onTabClick?: (tabId: string) => void;
}) {
  const tabs = [
    { id: `${nodeId}-home`, label: "首页" },
    { id: `${nodeId}-feature`, label: "精选" },
    { id: `${nodeId}-message`, label: "消息" },
    { id: `${nodeId}-me`, label: "我" },
  ];
  const tabButton = (tab: (typeof tabs)[number], iconIndex: number) => (
    <button
      key={tab.id}
      type="button"
      data-d2c-node-id={tab.id}
      className={[styles.bottomTab, activeTab === tab.id ? styles.bottomTabActive : ""].filter(Boolean).join(" ")}
      onClick={onTabClick ? () => onTabClick(tab.id) : undefined}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d={BOTTOM_TAB_ICONS[iconIndex]} />
      </svg>
      {tab.label}
    </button>
  );
  return (
    <nav data-d2c-node-id={nodeId} className={styles.bottomNav} aria-label="底部导航">
      {tabButton(tabs[0]!, 0)}
      {tabButton(tabs[1]!, 1)}
      <button type="button" className={styles.bottomPublish} aria-label={publishBadge ? `发布，${publishBadge} 条新内容` : "发布"}>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <rect x="9" y="3" width="2" height="14" rx="1" />
          <rect x="3" y="9" width="14" height="2" rx="1" />
        </svg>
        {publishBadge ? <span className={styles.bottomPublishBadge} aria-hidden="true">{publishBadge}</span> : null}
      </button>
      {tabButton(tabs[2]!, 2)}
      {tabButton(tabs[3]!, 3)}
    </nav>
  );
}

/**
 * 素材裁切：把参考图 atlas 的归一化 crop 区域按容器尺寸整块呈现。
 * 背景图 / 主视觉 / 商品图等复杂艺术素材走这里，语义结构仍由组件承载。
 */
export function ArtworkSlice({
  nodeId,
  atlasUrl,
  crop,
  alt,
  className,
  style,
  fit = "cover",
}: NodeProps & {
  atlasUrl: string;
  crop: ActivityCrop;
  alt: string;
  className?: string;
  style?: CSSProperties;
  fit?: "cover" | "contain";
}) {
  return (
    <div
      data-d2c-node-id={nodeId}
      className={[styles.artwork, className].filter(Boolean).join(" ")}
      style={style}
      role="img"
      aria-label={alt}
    >
      <img
        src={atlasUrl}
        alt=""
        draggable={false}
        className={styles.artworkImage}
        style={{
          width: `${100 / crop.width}%`,
          height: `${100 / crop.height}%`,
          left: `${(-crop.x / crop.width) * 100}%`,
          top: `${(-crop.y / crop.height) * 100}%`,
          objectFit: fit,
        }}
      />
    </div>
  );
}
