// 真实端到端 LLM 集成测试：读 .env → 启动流程 → 命中 MiniMax M3 → 验证 ops 应用到 spec 后 card-2 变 lime
// 与 vitest 单元测试区分开（vitest 不依赖网络）；这里假定服务已在 127.0.0.1:8787 监听。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// 1) 读 .env 取真 key（不输出 key 内容到 console）
const envPath = resolve(process.cwd(), ".env");
const envText = readFileSync(envPath, "utf8");
const keyMatch = envText.match(/^key='([^']+)'/m);
if (!keyMatch || !keyMatch[1]) {
  console.error("未找到 .env key，跳过集成测试");
  process.exit(0);
}
const apiKey = keyMatch[1];

// 2) 先确认服务可用
const health = await fetch("http://127.0.0.1:8787/api/health");
if (!health.ok) {
  console.error("server 未启动");
  process.exit(1);
}

// 3) 读 product-grid fixture spec（Vite raw import 等价物）
const design = JSON.parse(readFileSync("examples/figma-bundles/product-grid/design.json", "utf8"));
const variables = JSON.parse(readFileSync("examples/figma-bundles/product-grid/variables.json", "utf8"));
const components = JSON.parse(readFileSync("examples/figma-bundles/product-grid/components.json", "utf8"));

// 这里不跑完整 ui-compiler（Vite 端才有），直接用 manifest 的 viewport + 手搓最小 spec 走 LLM 上下文路径。
const specSummary = [
  { id: "page", name: "Page", role: "page" },
  { id: "intro", name: "Intro", role: "intro" },
  { id: "grid", name: "Product Grid", role: "grid" },
  { id: "card-1", name: "Product Card 1", figmaComponent: "Product Card / Default" },
  { id: "card-2", name: "Product Card 2", figmaComponent: "Product Card / Default" },
  { id: "card-3", name: "Product Card 3", figmaComponent: "Product Card / Default" },
  { id: "card-4", name: "Product Card 4", figmaComponent: "Product Card / Default" },
];
void design; void variables; void components;

const scenarios = [
  { text: "把第二张卡片换成 lime", expectedNodeId: "card-2", expectedValue: "lime" },
  { text: "把第一张卡片改成 cobalt", expectedNodeId: "card-1", expectedValue: "cobalt" },
  { text: "把第三张卡片的颜色设为珊瑚", expectedNodeId: "card-3", expectedValue: "coral" },
];

let pass = 0;
let fail = 0;
for (const sc of scenarios) {
  const res = await fetch("http://127.0.0.1:8787/api/canvas/interpret", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-llm-key": apiKey,
    },
    body: JSON.stringify({
      text: sc.text,
      specSummary,
      baseUrl: "https://api.minimaxi.com/anthropic",
      model: "MiniMax-M3",
    }),
  });
  const body = await res.json();
  const firstOp = body.ops[0];
  const ok =
    res.status === 200 &&
    body.provider === "llm" &&
    firstOp?.kind === "set-prop" &&
    firstOp.selector.nodeId === sc.expectedNodeId &&
    firstOp.prop === "tone" &&
    firstOp.value === sc.expectedValue;
  if (ok) {
    pass++;
    console.log(`✅ "${sc.text}" → nodeId=${firstOp.selector.nodeId}, value=${firstOp.value}`);
  } else {
    fail++;
    console.error(`❌ "${sc.text}" → status=${res.status}, body=${JSON.stringify(body)}`);
  }
}

console.log(`\n=== 集成测试通过 ${pass}/${scenarios.length} ===`);
process.exit(fail > 0 ? 1 : 0);