import { useState, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from "react";
import { ArtworkSlice, BottomTabBar, KwaiTopNavigation, MobileActivityShell, PhoneStatusBar } from "./shared";
import { FloatingAction, ProductCard } from "./cards";
import pageStyles from "./real-pages.module.css";

// 快手商城信息流页（真实截图混合重建）：
// Banner 氛围图与商品主图从参考图裁切，导航/搜索/金刚区/卡片/底栏全部语义化组件。
// 所有区块按实测 sourceBox 绝对定位（页面坐标，单位 CSS px，390 设计宽）。

const ATLAS_CROPS = {
  banner: { x: 0, y: 0.24, width: 1, height: 0.0779 },
  tissue: { x: 0.0143, y: 0.3179, width: 0.4794, height: 0.2168 },
  tea: { x: 0.5079, y: 0.3179, width: 0.4778, height: 0.2168 },
  detergent: { x: 0.0238, y: 0.6696, width: 0.4643, height: 0.2304 },
  comb: { x: 0.512, y: 0.6696, width: 0.4762, height: 0.2304 },
} as const;

/** 页面绝对坐标 → 画布内绝对定位样式 */
const box = (x: number, y: number, width: number, height: number): CSSProperties => ({
  position: "absolute",
  left: x,
  top: y,
  width,
  height,
});

const QUICK_ACTIONS: Array<{ id: string; x: number; label: string; icon: ReactNode }> = [
  {
    id: "quick-action-orders",
    x: 4,
    label: "我的订单",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#ff5c7a" d="M6 3h12a2 2 0 0 1 2 2v14l-3-2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
        <rect x="7.5" y="7" width="9" height="1.8" rx="0.9" fill="#fff" />
        <rect x="7.5" y="10.6" width="6" height="1.8" rx="0.9" fill="#fff" opacity="0.9" />
      </svg>
    ),
  },
  {
    id: "quick-action-cart",
    x: 82,
    label: "购物车",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 4h2.4l2.5 10.4h9.7l2-7.4H7.2" fill="none" stroke="#ffa02e" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx="9.6" cy="18.4" r="1.8" fill="#ffa02e" />
        <circle cx="16.4" cy="18.4" r="1.8" fill="#ffa02e" />
      </svg>
    ),
  },
  {
    id: "quick-action-recharge",
    x: 160,
    label: "充值中心",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4" y="4" width="16" height="16" rx="4" fill="#5b8cff" />
        <path d="M12.8 7.5 9.4 12.6h2.4l-.9 4 3.7-5.3h-2.4Z" fill="#fff" />
      </svg>
    ),
  },
  {
    id: "quick-action-auction",
    x: 238,
    label: "一元拍",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.4" fill="#ff3b8d" />
        <text x="12" y="15.6" textAnchor="middle" fontSize="8.4" fontWeight="800" fill="#fff">1元</text>
      </svg>
    ),
  },
  {
    id: "quick-action-coins",
    x: 316,
    label: "赚金币",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.4" fill="#ffc02e" />
        <circle cx="12" cy="12" r="6.2" fill="none" stroke="#fff" strokeWidth="1.3" />
        <text x="12" y="14.8" textAnchor="middle" fontSize="7" fontWeight="800" fill="#fff">币</text>
      </svg>
    ),
  },
];

interface ProductSpec {
  id: string;
  box: [number, number, number, number];
  imageHeight: number;
  crop: { x: number; y: number; width: number; height: number };
  alt: string;
  title: string;
  brand?: string;
  badge?: string;
  priceLabel?: string;
  price?: string;
  actionLabel?: string;
  service?: string;
}

const PRODUCTS: ProductSpec[] = [
  {
    id: "product-tissue-card",
    box: [6, 276, 190, 300],
    imageHeight: 188,
    crop: ATLAS_CROPS.tissue,
    alt: "心相印抽纸商品图",
    title: "【第三件0.01元】心相印抽纸",
    brand: "品牌",
    badge: "品牌抽纸热销榜·第1名",
    priceLabel: "新人价",
    price: "¥3.01",
    actionLabel: "抢",
  },
  {
    id: "product-tea-card",
    box: [198, 276, 186, 300],
    imageHeight: 188,
    crop: ATLAS_CROPS.tea,
    alt: "康师傅多口味混合整箱饮料商品图",
    title: "康师傅多口味混合任选整箱",
    badge: "整箱装饮料热销榜·第6名",
    priceLabel: "新人价",
    price: "¥5.01",
    actionLabel: "抢",
  },
  {
    id: "product-detergent-card",
    box: [6, 579, 190, 245],
    imageHeight: 199,
    crop: ATLAS_CROPS.detergent,
    alt: "大师香氛洗衣液商品图",
    title: "【爆品推荐】大师香氛洗衣",
    service: "先用后付 已售890件",
  },
  {
    id: "product-comb-card",
    box: [198, 579, 186, 245],
    imageHeight: 199,
    crop: ATLAS_CROPS.comb,
    alt: "迷你排骨梳镂空按摩梳子商品图",
    title: "迷你排骨梳镂空按摩梳子",
    service: "先用后付 已售2.0万件",
  },
];

/** 快手商城信息流页。atlasUrl 指向本样例的参考图整图（素材裁切源）。texts 接收 codegen 注入的后代 role=text 文案覆盖（编辑穿透）；缺失时回落内置默认值，保证默认渲染与 spec 一致。 */
export function CommerceFeedExperience({ atlasUrl, texts, ...root }: { atlasUrl: string; texts?: Record<string, string> } & ComponentPropsWithoutRef<"div">) {
  const t = (id: string, fallback: string) => texts?.[id] ?? fallback;
  const [toast, setToast] = useState<string | null>(null);
  const [floatsVisible, setFloatsVisible] = useState(true);
  const showToast = (message: string) => setToast(message);

  return (
    <div data-activity-canvas-root="" {...root}>
      <MobileActivityShell height={867} pageBackground="#17181f" canvasBackgroundColor="#f6f7f9">
        <div style={box(0, 0, 390, 31)}>
          <PhoneStatusBar time="21:18" />
        </div>
        <KwaiTopNavigation
          nodeId="top-nav"
          style={{ position: "absolute", top: 46, left: 0, width: 390, height: 44 }}
          activeTab="top-tab-mall"
          tabs={[
            { id: "top-tab-follow", label: t("top-tab-follow", "关注") },
            { id: "top-tab-mall", label: t("top-tab-mall", "商城") },
            { id: "top-tab-discover", label: t("top-tab-discover", "发现") },
            { id: "top-tab-local", label: t("top-tab-local", "同城") },
          ]}
        />

        <div data-d2c-node-id="commerce-search" style={box(12, 94, 366, 42)} className={pageStyles.searchPill}>
          <svg viewBox="0 0 20 20" className={pageStyles.searchIcon} aria-hidden="true">
            <circle cx="9" cy="9" r="6.4" fill="none" stroke="#9c9ca6" strokeWidth="1.8" />
            <line x1="13.8" y1="13.8" x2="18" y2="18" stroke="#9c9ca6" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span data-d2c-node-id="commerce-search-keyword" style={box(28, 14, 44, 16)} className={pageStyles.searchKeyword}>{t("commerce-search-keyword", "猫粮")}</span>
          <button
            type="button"
            data-d2c-node-id="commerce-search-submit"
            className={pageStyles.searchSubmit}
            style={box(314, 5, 50, 32)}
            onClick={() => showToast(`已搜索「${t("commerce-search-keyword", "猫粮")}」`)}
          >
            {t("commerce-search-submit", "搜索")}
          </button>
        </div>

        <div data-d2c-node-id="quick-actions" style={box(0, 142, 390, 59)} className={pageStyles.quickActions}>
          {QUICK_ACTIONS.map((action) => (
            <button key={action.id} type="button" className={pageStyles.quickActionItem} style={{ left: action.x }}>
              {action.icon}
              <span data-d2c-node-id={action.id}>{t(action.id, action.label)}</span>
            </button>
          ))}
        </div>

        <div data-d2c-node-id="promo-banner" style={box(0, 208, 390, 67)}>
          <ArtworkSlice nodeId="banner-art" atlasUrl={atlasUrl} crop={ATLAS_CROPS.banner} alt="快手818宠粉节粉红渐变 Banner" style={box(0, 0, 390, 67)} />
          <span data-d2c-node-id="banner-title" hidden>{t("banner-title", "快手818宠粉节")}</span>
          <span data-d2c-node-id="banner-line-auction" hidden>{t("banner-line-auction", "手机金豆 1元起拍 ›")}</span>
          <span data-d2c-node-id="banner-line-coupon" hidden>{t("banner-line-coupon", "80元 消费券 去领取")}</span>
          <span data-d2c-node-id="banner-line-moutai" hidden>{t("banner-line-moutai", "手机茅台 一元起拍")}</span>
          <span data-d2c-node-id="banner-price" hidden>{t("banner-price", "¥59.9")}</span>
        </div>

        <div data-d2c-node-id="product-grid" style={box(0, 276, 390, 548)} className={pageStyles.productGrid}>
          {PRODUCTS.map((product) => (
            <ProductCard
              key={product.id}
              nodeId={product.id}
              style={box(product.box[0], product.box[1] - 276, product.box[2], product.box[3])}
              imageHeight={product.imageHeight}
              image={{ atlasUrl, crop: product.crop, alt: product.alt }}
              title={t(`${product.id}-title`, product.title)}
              brand={product.brand !== undefined ? t(`${product.id}-brand`, product.brand) : undefined}
              badge={product.badge !== undefined ? t(`${product.id}-badge`, product.badge) : undefined}
              priceLabel={product.priceLabel !== undefined ? t(`${product.id}-price-label`, product.priceLabel) : undefined}
              price={product.price !== undefined ? t(`${product.id}-price`, product.price) : undefined}
              actionLabel={product.actionLabel !== undefined ? t(`${product.id}-action`, product.actionLabel) : undefined}
              service={product.service !== undefined ? t(`${product.id}-service`, product.service) : undefined}
              onClick={() => product.actionLabel ? showToast(`已抢购：${t(`${product.id}-title`, product.title)}`) : undefined}
            />
          ))}
        </div>

        {floatsVisible ? (
          <>
            <FloatingAction
              nodeId="floating-back"
              shape="pill"
              label={t("floating-back-label", "‹ 回到赚钱任务")}
              style={box(0, 718, 102, 33)}
              onClick={() => showToast("回到赚钱任务")}
            />
            <button type="button" data-d2c-node-id="float-close" className={pageStyles.floatClose} style={box(370, 675, 11, 11)} aria-label="关闭浮层" onClick={() => setFloatsVisible(false)}>
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" stroke="#9c9ca6" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
            <FloatingAction
              nodeId="float-reward"
              shape="pill"
              label={t("float-reward-label", "+100")}
              style={{ ...box(338, 699, 50, 26), background: "#ff3b30", boxShadow: "none", padding: "0 8px" }}
              onClick={() => showToast("+100 金币已入账")}
            />
            <FloatingAction
              nodeId="float-browse"
              shape="circle"
              label={t("float-browse-label", "再逛30秒")}
              style={{ ...box(338, 725, 50, 47), padding: "4px 2px" }}
              onClick={() => showToast("再逛 30 秒可得奖励")}
            />
          </>
        ) : null}

        <BottomTabBar height={43} texts={texts} />

        {toast ? <div className={pageStyles.toast} role="status">{toast}</div> : null}
      </MobileActivityShell>
    </div>
  );
}

export default CommerceFeedExperience;
