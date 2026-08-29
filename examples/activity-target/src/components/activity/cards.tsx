import type { CSSProperties, ReactNode } from "react";
import { ArtworkSlice, type ActivityCrop } from "./shared";
import styles from "./activity.module.css";

// 活动页企业组件（卡片层）：商品卡 / 任务卡 / 福利格 / 进度卡 / 浮层入口 / 主行动按钮。
// 卡片内部文本节点的 id 默认由卡片 nodeId 派生（如 task-install-title），页面可显式覆盖。

export interface ArtworkSource {
  atlasUrl: string;
  crop: ActivityCrop;
  alt: string;
}

/** 商品卡：裁切商品图 + 品牌标/标题 + 榜单徽标 + 价格行（新人价/价格/抢按钮）或服务行；
 *  品牌标、徽标、价格行与服务行均为可选，按各卡片实测内容拼装（image 等节点 id 由 base 派生） */
export function ProductCard({
  nodeId,
  image,
  title,
  brand,
  badge,
  priceLabel,
  price,
  actionLabel,
  service,
  imageHeight,
  style,
  onClick,
}: {
  nodeId: string;
  image: ArtworkSource;
  title: string;
  brand?: string;
  badge?: string;
  priceLabel?: string;
  price?: string;
  actionLabel?: string;
  service?: string;
  /** 商品图区域高度（实测 CSS px）；不传时由内容自然堆叠 */
  imageHeight?: number;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  const base = nodeId.replace(/-card$/, "");
  const hasPriceRow = Boolean(price || priceLabel || actionLabel);
  return (
    <button type="button" data-d2c-node-id={nodeId} className={styles.productCard} style={style} onClick={onClick}>
      <ArtworkSlice
        nodeId={base}
        atlasUrl={image.atlasUrl}
        crop={image.crop}
        alt={image.alt}
        className={styles.productArt}
        style={imageHeight === undefined ? undefined : { height: imageHeight }}
      />
      <span className={styles.productTitleRow}>
        {brand ? <span data-d2c-node-id={`${base}-brand`} className={styles.productBrand}>{brand}</span> : null}
        <span data-d2c-node-id={`${base}-title`} className={[styles.productTitle, brand ? styles.productTitleInline : ""].filter(Boolean).join(" ")}>{title}</span>
      </span>
      {badge ? <span data-d2c-node-id={`${base}-badge`} className={styles.productBadge}>{badge}</span> : null}
      {hasPriceRow ? (
        <span className={styles.productPriceRow}>
          {priceLabel ? <span data-d2c-node-id={`${base}-price-label`} className={styles.productPriceLabel}>{priceLabel}</span> : null}
          {price ? <span data-d2c-node-id={`${base}-price`} className={styles.productPrice}>{price}</span> : null}
          {actionLabel ? <span data-d2c-node-id={`${base}-action`} className={styles.productAction}>{actionLabel}</span> : null}
        </span>
      ) : null}
      {service ? <span data-d2c-node-id={`${base}-service`} className={styles.productService}>{service}</span> : null}
    </button>
  );
}

/** 任务卡：装饰图标 + 标题/奖励 + 行动按钮；完成后按钮禁用并显示「已完成」。
 *  tone=light 用于浅色底（宠物页任务区米色卡）：深棕文字 + 橙色按钮。 */
export function TaskCard({
  nodeId,
  title,
  reward,
  actionLabel,
  icon,
  tone = "dark",
  done = false,
  style,
  onAction,
}: {
  nodeId: string;
  title: string;
  reward: string;
  actionLabel: string;
  icon?: ReactNode;
  tone?: "dark" | "light";
  done?: boolean;
  style?: CSSProperties;
  onAction?: () => void;
}) {
  const light = tone === "light";
  return (
    <div
      data-d2c-node-id={nodeId}
      className={[styles.taskCard, light ? styles.taskCardLight : ""].filter(Boolean).join(" ")}
      style={style}
    >
      {icon ? <span className={[styles.taskIcon, light ? styles.taskIconLight : ""].filter(Boolean).join(" ")} aria-hidden="true">{icon}</span> : null}
      <span className={styles.taskInfo}>
        <span data-d2c-node-id={`${nodeId}-title`} className={[styles.taskTitle, light ? styles.taskTitleLight : ""].filter(Boolean).join(" ")}>{title}</span>
        <span data-d2c-node-id={`${nodeId}-reward`} className={[styles.taskReward, light ? styles.taskRewardLight : ""].filter(Boolean).join(" ")}>{reward}</span>
      </span>
      <button
        type="button"
        data-d2c-node-id={`${nodeId}-action`}
        className={[
          styles.taskAction,
          light ? styles.taskActionLight : "",
          done ? styles.taskActionDone : "",
        ].filter(Boolean).join(" ")}
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
  style,
  onClick,
}: {
  nodeId: string;
  label: string;
  icon?: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  return (
    <button type="button" data-d2c-node-id={nodeId} className={styles.rewardTile} style={style} onClick={onClick}>
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
  style,
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
  style?: CSSProperties;
}) {
  return (
    <section data-d2c-node-id={nodeId} className={styles.progressCard} style={style}>
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

/** 浮层入口：圆形（图标在上文案在下）或药丸（单行文案），支持角标；style 覆盖尺寸/定位 */
export function FloatingAction({
  nodeId,
  label,
  labelId,
  badge,
  icon,
  shape = "circle",
  tone = "default",
  style,
  onClick,
}: {
  nodeId: string;
  label?: string;
  /** 文案节点 id（默认 ${nodeId}-label；跨层级命名时显式指定） */
  labelId?: string;
  badge?: string;
  icon?: ReactNode;
  shape?: "circle" | "pill";
  tone?: "default" | "primary";
  style?: CSSProperties;
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
      style={style}
      onClick={onClick}
    >
      {badge ? <span className={styles.floatBadge} aria-hidden="true">{badge}</span> : null}
      {icon ? <span className={shape === "pill" ? styles.floatPillIcon : styles.floatIcon} aria-hidden="true">{icon}</span> : null}
      {label ? <span data-d2c-node-id={labelId ?? `${nodeId}-label`} className={shape === "pill" ? styles.floatPillLabel : styles.floatLabel}>{label}</span> : null}
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
  style,
  onClick,
}: {
  nodeId: string;
  title: string;
  titleId?: string;
  subtitle?: string;
  subtitleId?: string;
  disabled?: boolean;
  style?: CSSProperties;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      data-d2c-node-id={nodeId}
      className={[styles.primaryAction, disabled ? styles.primaryActionDisabled : ""].filter(Boolean).join(" ")}
      style={style}
      onClick={onClick}
    >
      <span data-d2c-node-id={titleId ?? `${nodeId}-title`} className={styles.primaryActionTitle}>{title}</span>
      {subtitle ? <span data-d2c-node-id={subtitleId ?? `${nodeId}-subtitle`} className={styles.primaryActionSubtitle}>{subtitle}</span> : null}
    </button>
  );
}
