import { buildApp } from "./app";
import { warmDependencyCache } from "./warm";

const app = buildApp();

await app.listen({ host: "127.0.0.1", port: 8787 });

// 后台预热依赖缓存：服务端一启动就把目标仓库装进 .data/production/warm，
// 填充 pnpm 全局 store——演示时首个生产闭环不再付冷启动下载（约 1–2 分钟）。
// 不阻塞启动；失败只记日志，下次启动重试。
void warmDependencyCache({ log: (message) => console.log(`[warm] ${message}`) });
