// 统一出口（服务端用）：
// - ./replay     浏览器内确定性管线（无 node 专用依赖，web 经 "@d2c/orchestrator/replay" 子路径引用）
// - ./production 生产闭环状态机（依赖 production-runtime / playwright，仅服务端）
export * from "./replay";
export * from "./production";
