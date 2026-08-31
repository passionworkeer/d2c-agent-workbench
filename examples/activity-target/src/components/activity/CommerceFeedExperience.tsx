import { useState, type ComponentPropsWithoutRef, type CSSProperties } from "react";
import { ArtworkSlice, BottomTabBar, KwaiTopNavigation, MobileActivityShell } from "./shared";
import { ProductCard } from "./cards";
import styles from "./commerce.module.css";
import pageStyles from "./real-pages.module.css";

const box = (x: number, y: number, width: number, height: number): CSSProperties => ({ position: "absolute", left: x, top: y, width, height });
const crop = (x: number, y: number, width: number, height: number) => ({ x: x / 390, y: y / (2800 * 390 / 1260), width: width / 390, height: height / (2800 * 390 / 1260) });
const QUICK_ACTIONS = [
  { id: "quick-action-orders", label: "我的订单", path: "M6 2h14v22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM8 9h9M8 14h6" },
  { id: "quick-action-cart", label: "购物车", path: "M1 2h3l3 17h15l3-13H5M8 23h1M20 23h1" },
  { id: "quick-action-recharge", label: "充值中心", path: "M5 2h15v22H5V2ZM10 20h5" },
  { id: "quick-action-auction", label: "一元拍", path: "m6 5 5-4 10 12-5 4-3-4-7 10-5-4 8-9-3-5ZM17 16l7 7" },
  { id: "quick-action-coins", label: "赚金币", path: "M23 7c0 3-4 5-10 5S3 10 3 7s4-5 10-5 10 2 10 5ZM3 8v6c0 6 20 6 20 0V8M3 14v6c0 6 20 6 20 0v-6" },
  { id: "quick-action-subsidy", label: "国家补贴", path: "M2 4h22v5c-5 0-5 8 0 8v6H2v-6c5 0 5-8 0-8V4ZM13 8v11M9 11h8M9 16h8" },
] as const;
const PRODUCTS = [
  { id: "product-tissue", x: 4, y: 285, width: 189, height: 291, imageHeight: 190, crop: crop(4, 285, 189, 190), title: "【第三件0.01元】心相印抽纸", brand: "品牌", badge: "品牌抽纸热销榜·第1名", price: "¥3.01" },
  { id: "product-tea", x: 197, y: 285, width: 189, height: 291, imageHeight: 190, crop: crop(197, 285, 189, 190), title: "康师傅多口味混合任选整箱", badge: "整箱装饮料热销榜·第6名", price: "¥5.01" },
  { id: "product-detergent", x: 4, y: 580, width: 189, height: 249, imageHeight: 190, crop: crop(4, 580, 189, 190), title: "【爆品推荐】大师香氛洗衣", service: "先用后付 已售890件" },
  { id: "product-comb", x: 197, y: 580, width: 189, height: 249, imageHeight: 190, crop: crop(197, 580, 189, 190), title: "迷你排骨梳镂空按摩梳子", service: "先用后付 已售2.0万件" },
];
const SearchIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="7.4" /><path d="m16 16 6 6" /></svg>;
const Trophy = () => <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 2h8v5c0 3-2 5-4 5S6 10 6 7V2ZM6 4H2v3c0 3 3 4 5 3M14 4h4v3c0 3-3 4-5 3M10 12v4M6 18h8" fill="currentColor" stroke="currentColor" strokeWidth="1.4" /></svg>;

// 商品图保留营销图自身图文，卡片正文、按钮、导航及横幅都由 React 构建。
export function CommerceFeedExperience({ atlasUrl, texts, ...root }: { atlasUrl: string; texts?: Record<string, string> } & ComponentPropsWithoutRef<"div">) {
  const t = (id: string, fallback: string) => texts?.[id] ?? fallback;
  const couponText = t("banner-line-coupon", "80元 消费券 去领取");
  const coupon = couponText.match(/^(\d+(?:\.\d+)?)元(\s+)(\S+)(\s+)(.+)$/);
  const goodsText = t("banner-line-moutai", "手机茅台 一元起拍");
  const goods = goodsText.match(/^(\S{2})(\S{2})(\s+)(.+)$/);
  const [toast, setToast] = useState<string | null>(null);
  const [floatsVisible, setFloatsVisible] = useState(true);
  const [nav, setNav] = useState("top-tab-mall");
  return (
    <div data-activity-canvas-root="" {...root}>
      <MobileActivityShell height={867} pageBackground="#17181f" canvasBackgroundColor="#f5f5f5">
        <div className={styles.page}>
          <div className={styles.pinkSky} />
          <div data-d2c-node-id="status-bar" className={styles.status} aria-hidden="true"><span>21:18</span><div><svg viewBox="0 0 20 16"><path d="m2 1 16 14M4 6c0-5 10-5 10 0v5H3l1-5ZM7 14h4" /></svg><small>▣</small><small className={styles.speed}>2.00<br />MB/s</small><span className={styles.signal}><small>5G</small>▂▃▅</span><span className={styles.signal}><small>5G</small>▂▃▅</span><svg viewBox="0 0 20 16"><path d="M1 4q9-6 18 0M4 8q6-4 12 0M7 12q3-2 6 0" /><circle cx="10" cy="15" r="1" /></svg><svg viewBox="0 0 20 16"><path d="M1 4q9-6 18 0M4 8q6-4 12 0M7 12q3-2 6 0" /><circle cx="10" cy="15" r="1" /></svg><b className={styles.battery}>87</b></div></div>
          <KwaiTopNavigation nodeId="top-nav" className={styles.navigation} style={box(0, 46, 390, 44)} activeTab={nav} onTabClick={(item) => { setNav(item.id); setToast(item.label); }} tabs={[
            { id: "top-tab-follow", label: t("top-tab-follow", "关注") },
            { id: "top-tab-mall", label: t("top-tab-mall", "商城") },
            { id: "top-tab-discover", label: t("top-tab-discover", "发现") },
            { id: "top-tab-local", label: t("top-tab-local", "同城") },
          ]} />
          <button className={styles.petBrand} style={box(59, 56, 51, 22)} onClick={() => setToast("养萌宠（本地演示）")}>养萌宠</button>
          <div data-d2c-node-id="commerce-search" className={styles.search} style={box(11, 95, 368, 41)}>
            <span className={styles.searchIcon}><SearchIcon /></span>
            <span data-d2c-node-id="commerce-search-keyword" className={styles.keyword}>{t("commerce-search-keyword", "猫粮")}</span>
            <button className={styles.camera} aria-label="拍照搜索" onClick={() => setToast("拍照搜索（本地演示）")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h4l2-3h6l2 3h4v15H3V6Z" /><circle cx="12" cy="12" r="4" /></svg></button>
            <button data-d2c-node-id="commerce-search-submit" className={styles.searchSubmit} onClick={() => setToast(`已搜索「${t("commerce-search-keyword", "猫粮")}」`)}>{t("commerce-search-submit", "搜索")}</button>
          </div>
          <div data-d2c-node-id="quick-actions" className={styles.quickActions} style={box(0, 139, 390, 63)}>
            {QUICK_ACTIONS.map((action, index) => <button key={action.id} className={styles.quickAction} style={{ left: 8 + index * 70 }} onClick={() => setToast(`${action.label}（本地演示）`)}><svg viewBox="0 0 27 27" aria-hidden="true"><path d={action.path} /></svg><span data-d2c-node-id={action.id}>{t(action.id, action.label)}</span>{index === 3 ? <small>拍金豆</small> : null}</button>)}
            <div className={styles.dots}><i /><i /></div>
          </div>
          <section data-d2c-node-id="promo-banner" className={styles.banner} style={box(8, 208, 375, 68)}>
            <div className={styles.bannerLead}><strong data-d2c-node-id="banner-title">{t("banner-title", "快手818宠粉节")}</strong><span data-d2c-node-id="banner-line-auction">{t("banner-line-auction", "手机金豆 1元起拍 ›")}</span></div>
            <button className={styles.coupon} aria-label={coupon?.[5] ?? couponText} onClick={() => setToast(`${coupon ? `${coupon[1]}元${coupon[3]}` : couponText}已领取（本地演示）`)}><span data-d2c-node-id="banner-line-coupon">{coupon ? <><strong>{coupon[1]}<small>元</small></strong>{coupon[2]}<span>{coupon[3]}{coupon[4]}<em>{coupon[5]}</em></span></> : couponText}</span></button>
            <div className={styles.bannerGoods}><span data-d2c-node-id="banner-line-moutai">{goods ? <><strong>{goods[1]}<br />{goods[2]}</strong>{goods[3]}<span>{goods[4]}</span></> : goodsText}</span><ArtworkSlice nodeId="banner-art" atlasUrl={atlasUrl} crop={crop(326, 226, 47, 26)} alt="横幅中的手机商品图" style={box(67, 13, 47, 26)} /><span data-d2c-node-id="banner-price" className={styles.bannerPrice}>{t("banner-price", "¥59.9")}</span></div>
          </section>

          <section data-d2c-node-id="product-grid" style={box(0, 285, 390, 544)}>
            {PRODUCTS.map((product) => <ProductCard key={product.id} nodeId={`${product.id}-card`} className={styles.product} style={box(product.x, product.y - 285, product.width, product.height)} imageHeight={product.imageHeight} image={{ atlasUrl, crop: product.crop, alt: `${product.title}商品图` }} title={t(`${product.id}-title`, product.title)} brand={product.brand ? t(`${product.id}-brand`, product.brand) : undefined} badge={product.badge ? t(`${product.id}-badge`, product.badge) : undefined} badgeIcon={product.badge ? <Trophy /> : undefined} priceLabel={product.price ? t(`${product.id}-price-label`, "新人价") : undefined} price={product.price ? t(`${product.id}-price`, product.price) : undefined} actionLabel={product.price ? t(`${product.id}-action`, "抢") : undefined} service={product.service ? t(`${product.id}-service`, product.service) : undefined} onClick={() => setToast(`已加购：${t(`${product.id}-title`, product.title)}`)} />)}
          </section>

          {floatsVisible ? <>
            <button data-d2c-node-id="floating-back" className={styles.floatingBack} style={box(0, 717, 102, 36)} onClick={() => setToast("回到赚钱任务")}><span data-d2c-node-id="floating-back-label">{t("floating-back-label", "‹ 回到赚钱任务")}</span></button>
            <button data-d2c-node-id="float-close" className={styles.floatClose} style={box(367, 666, 23, 30)} aria-label="关闭浮层" onClick={() => setFloatsVisible(false)}>×</button>
            <div className={styles.rewardFloat} style={box(330, 696, 56, 63)}><button data-d2c-node-id="float-reward" onClick={() => setToast("+100 金币已入账")}><strong data-d2c-node-id="float-reward-label">{t("float-reward-label", "+100")}</strong></button><button data-d2c-node-id="float-browse" onClick={() => setToast("再逛 30 秒可得奖励")}><span data-d2c-node-id="float-browse-label">{t("float-browse-label", "再逛30秒")}</span></button></div>
          </> : null}
          <BottomTabBar appearance="reference" height={53} texts={texts} />
          {toast ? <div className={pageStyles.toast} role="status">{toast}</div> : null}
        </div>
      </MobileActivityShell>
    </div>
  );
}
export default CommerceFeedExperience;
