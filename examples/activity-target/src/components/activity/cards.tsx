import type { ReactNode } from "react";
import { ArtworkSlice, type ActivityCrop } from "./shared";
import styles from "./activity.module.css";

// 活动页企业组件（卡片层）：商品卡 / 任务卡 / 福利格 / 进度卡 / 浮层入口 / 主行动按钮。
// 卡片内部文本节点的 id 默认由卡片 nodeId 派生（如 task-install-title），页面可显式覆盖。

export interface ArtworkSource {
  atlasUrl: string;
  crop: ActivityCrop;
  alt: string;
}

/** 商品卡：裁切商品图 + 标题 + 价格 + 榜单徽标（image/title/price/badge 节点 id 由 base 派生） */
export function ProductCard({
  nodeId,
  image,
  title,
  price,
  badge,
  onClick,
}: {
  nodeId: string;
  image: ArtworkSource;
  title: string;
  price: string;
  badge: string;
  onClick?: () => void;
}) {
  const base = nodeId.replace(/-card$/, "");
  return (
    <button type="button" data-d2c-node-id={nodeId} className={styles.productCard} onClick={onClick}>
      <ArtworkSlice nodeId={base} atlasUrl={image.atlasUrl} crop={image.crop} alt={image.alt} className={styles.productArt} />
      <span data-d2c-node-id={`${base}-title`} className={styles.productTitle}>{title}</span>
      <span data-d2c-node-id={`${base}-price`} className={styles.productPrice}>{price}</span>
      <span data-d2c-node-id={`${base}-badge`} className={styles.productBadge}>{badge}</span>
    </button>
  );
}

/** 任务卡：装饰图标 + 标题/奖励 + 行动按钮；完成后按钮禁用并显示「已完成」 */
export function TaskCard({
  nodeId,
  title,
  reward,
  actionLabel,
  icon,
  done = false,
  onAction,
}: {
  nodeId: string;
  title: string;
  reward: string;
  actionLabel: string;
  icon?: ReactNode;
  done?: boolean;
  onAction?: () => void;
}) {
  return (
    <div data-d2c-node-id={nodeId} className={styles.taskCard}>
      {icon ? <span className={styles.taskIcon} aria-hidden="true">{icon}</span> : null}
      <span className={styles.taskInfo}>
        <span data-d2c-node-id={`${nodeId}-title`} className={styles.taskTitle}>{title}</span>
        <span data-d2c-node-id={`${nodeId}-reward`} className={styles.taskReward}>{reward}</span>
      </span>
      <button
        type="button"
        data-d2c-node-id={`${nodeId}-action`}
        className={[styles.taskAction, done ? styles.taskActionDone : ""].filter(Boolean).join(" ")}
        disabled={done}
        onClick={onAction}
      >
        {done ? "已完成" : actionLabel}
      </button>
    </div>
  );
}

/** 福利格：装饰图标 + 福利名，用于兑换面板的网格项 */
export function RewardTile({
  nodeId,
  label,
  icon,
  onClick,
}: {
  nodeId: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button type="button" data-d2c-node-id={nodeId} className={styles.rewardTile} onClick={onClick}>
      {icon ? <span className={styles.rewardIcon} aria-hidden="true">{icon}</span> : null}
      <span data-d2c-node-id={`${nodeId}-label`} className={styles.rewardLabel}>{label}</span>
    </button>
  );
}

export interface ProgressMilestone {
  id: string;
  label: string;
  tone?: "done" | "pending";
}

/** 进度卡：居中提示 + 累计收入 + 里程碑轨道（里程碑文本节点 id 显式传入） */
export function ProgressCard({
  nodeId,
  hint,
  hintId,
  income,
  incomeId,
  incomeLink,
  incomeLinkId,
  milestones,
  prize,
}: {
  nodeId: string;
  hint: string;
  hintId?: string;
  income: string;
  incomeId?: string;
  incomeLink: string;
  incomeLinkId?: string;
  milestones: ProgressMilestone[];
  prize: { id: string; label: string };
}) {
  return (
    <section data-d2c-node-id={nodeId} className={styles.progressCard}>
      <p data-d2c-node-id={hintId ?? `${nodeId}-hint`} className={styles.progressHint}>{hint}</p>
      <div className={styles.progressBody}>
        <div className={styles.progressIncome}>
          <strong data-d2c-node-id={incomeId ?? `${nodeId}-income`} className={styles.progressIncomeValue}>{income}</strong>
          <span data-d2c-node-id={incomeLinkId ?? `${nodeId}-income-link`} className={styles.progressIncomeLink}>{incomeLink}</span>
        </div>
        <div className={styles.progressTrack}>
          <span className={styles.progressRail} aria-hidden="true">
            <span className={styles.progressRailFill} />
          </span>
          {milestones.map((milestone) => (
            <span
              key={milestone.id}
              data-d2c-node-id={milestone.id}
              className={[styles.progressMilestone, milestone.tone === "done" ? styles.progressMilestoneDone : ""].filter(Boolean).join(" ")}
            >
              {milestone.label}
            </span>
          ))}
          <span data-d2c-node-id={prize.id} className={styles.progressPrize}>{prize.label}</span>
        </div>
      </div>
    </section>
  );
}

/** 浮层入口：圆形（图标在上文案在下）或药丸（单行文案），支持角标 */
export function FloatingAction({
  nodeId,
  label,
  badge,
  icon,
  shape = "circle",
  tone = "default",
  onClick,
}: {
  nodeId: string;
  label?: string;
  badge?: string;
  icon?: ReactNode;
  shape?: "circle" | "pill";
  tone?: "default" | "primary";
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      data-d2c-node-id={nodeId}
      className={[
        shape === "pill" ? styles.floatPill : styles.floatCircle,
        tone === "primary" ? styles.floatPrimary : "",
      ].filter(Boolean).join(" ")}
      onClick={onClick}
    >
      {badge ? <span className={styles.floatBadge} aria-hidden="true">{badge}</span> : null}
      {icon ? <span className={shape === "pill" ? styles.floatPillIcon : styles.floatIcon} aria-hidden="true">{icon}</span> : null}
      {label ? <span data-d2c-node-id={`${nodeId}-label`} className={shape === "pill" ? styles.floatPillLabel : styles.floatLabel}>{label}</span> : null}
    </button>
  );
}

/** 主行动按钮：橙红渐变胶囊，主文案 + 副文案（能量余量等） */
export function PrimaryActionButton({
  nodeId,
  title,
  titleId,
  subtitle,
  subtitleId,
  disabled = false,
  onClick,
}: {
  nodeId: string;
  title: string;
  titleId?: string;
  subtitle?: string;
  subtitleId?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      data-d2c-node-id={nodeId}
      className={[styles.primaryAction, disabled ? styles.primaryActionDisabled : ""].filter(Boolean).join(" ")}
      onClick={onClick}
    >
      <span data-d2c-node-id={titleId ?? `${nodeId}-title`} className={styles.primaryActionTitle}>{title}</span>
      {subtitle ? <span data-d2c-node-id={subtitleId ?? `${nodeId}-subtitle`} className={styles.primaryActionSubtitle}>{subtitle}</span> : null}
    </button>
  );
}
