import { lazy, Suspense, type ComponentType } from "react";

// 动态收集生成的活动页模块：生成器把各样例页面写进 src/pages/campaign/<Name>Page.tsx，
// 这里用 glob 拾取，目标仓库在页面生成前后都能通过 typecheck。
const pages = import.meta.glob("./pages/**/*.tsx");
const firstPage = Object.values(pages)[0] as (() => Promise<{ default: ComponentType }>) | undefined;
const CampaignPage = firstPage ? lazy(firstPage) : null;

// 路径 → 生成页面文件名（componentName(spec.page.name) + Page.tsx）。
// 长前缀在前：/campaign/summer-form 必须先于 /campaign/summer 匹配。
const ROUTE_PAGE_MATCHERS: Array<[prefix: string, file: RegExp]> = [
  ["/campaign/summer-form", /SummerFormPage\.tsx$/],
  ["/campaign/summer", /CampaignPage\.tsx$/],
  ["/commerce/feed", /CommerceFeedPage\.tsx$/],
  ["/game/festival", /SummerGameFestivalPage\.tsx$/],
  ["/pet/red-packet", /PetRedPacketPage\.tsx$/],
];

function pageForPath(pathname: string): (() => Promise<{ default: ComponentType }>) | undefined {
  for (const [prefix, file] of ROUTE_PAGE_MATCHERS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      const entry = Object.entries(pages).find(([key]) => file.test(key));
      if (entry) return entry[1] as () => Promise<{ default: ComponentType }>;
    }
  }
  return undefined;
}

export default function App() {
  const routePage = typeof window === "undefined" ? undefined : pageForPath(window.location.pathname);
  const ActivePage = routePage ? lazy(routePage) : CampaignPage;
  return (
    // 黄金样例中已知的基线间距问题：骨架左内边距 48px 与参考稿 hero x=0 不一致。
    // 首轮评测应产生 hero 的 layout P1，局部修复只改 Campaign CSS 即可对齐。
    // 已注册路由的真实活动页（三张手机截图样例）不受该基线影响。
    <div style={{ padding: routePage ? 0 : "0 0 0 48px", minHeight: "100vh" }}>
      {ActivePage ? (
        <Suspense fallback={null}>
          <ActivePage />
        </Suspense>
      ) : (
        <p>等待活动页生成…</p>
      )}
    </div>
  );
}
