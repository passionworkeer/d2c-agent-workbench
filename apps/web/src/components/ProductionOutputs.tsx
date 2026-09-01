import type { TraceEvent } from "@d2c/contracts";
import { strToU8, zipSync } from "fflate";
import { useState } from "react";
import { getProductionArtifact } from "../lib/production-api";

export function ProductionOutputs({ runId, running, events, terminalEvent, generatedEvent, viewports, report, onDownloadReport, loadArtifact = getProductionArtifact, screenshots, recordedAt }: {
  runId: string;
  running: boolean;
  events: TraceEvent[];
  terminalEvent?: TraceEvent;
  generatedEvent?: TraceEvent;
  viewports: Array<{ name: string; width: number; height: number }>;
  report: unknown;
  onDownloadReport: () => void;
  loadArtifact?: typeof getProductionArtifact;
  screenshots?: Record<string, string>;
  recordedAt?: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const outputId = terminalEvent?.data?.artifactId ?? generatedEvent?.data?.artifactId;
  const status = running ? "真实生产执行中" : terminalEvent?.state === "COMPLETED" ? "生产完成 · 产物已就绪"
    : terminalEvent?.state === "NEEDS_REVIEW" ? "产物已生成 · 需要人工确认"
    : terminalEvent?.state === "FAILED" ? "运行失败 · 已保留现有产物" : "运行中断 · 可查看已有日志";

  async function downloadCode() {
    if (typeof outputId !== "string" || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const { content } = await loadArtifact(runId, outputId);
      const snapshot = content as { contents?: Record<string, string>; contentsSource?: string; unavailableFiles?: string[]; targetRepository?: string };
      const sources = Object.entries(snapshot.contents ?? {}).filter(([, value]) => typeof value === "string");
      if (!sources.length) throw new Error("本次记录没有可下载的代码快照，请重新运行生产闭环生成。");
      const files: Record<string, Uint8Array> = {};
      for (const [path, source] of sources) {
        const normalized = path.replaceAll("\\", "/");
        if (normalized.startsWith("/") || normalized.includes(":") || normalized.split("/").includes("..")) throw new Error("代码包包含无效文件路径，已停止下载。");
        files[`code/${normalized}`] = strToU8(source);
      }
      const version = snapshot.contentsSource === "run-end-snapshot" ? "运行结束时的代码快照（包含已应用修复或回滚）"
        : snapshot.contentsSource === "workspace-current" ? "历史工作区当前文件（不是当次运行的不可变快照）" : "初始生成快照（不包含后续修复）";
      files["run-report.json"] = strToU8(JSON.stringify(report, null, 2));
      files["source-manifest.json"] = strToU8(JSON.stringify(content, null, 2));
      files["README.txt"] = strToU8(`Run: ${runId}\n状态: ${terminalEvent?.state ?? "UNKNOWN"}\n代码版本: ${version}\n目标仓库: ${snapshot.targetRepository ?? "参见运行输入"}\n\ncode/ 中为本次生成或修复的目标仓库文件，不是独立可运行项目。请按原路径放回目标仓库；公共组件、依赖及素材仍由目标仓库提供。\n未读取到的文件: ${snapshot.unavailableFiles?.join(", ") || "无"}\n运行失败或需要人工确认的产物尚未通过验收。完整步骤及错误见 run-report.json。\n`);
      const blob = new Blob([zipSync(files) as BlobPart], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${runId}-code.zip`;
      anchor.click();
      URL.revokeObjectURL(url);
      if (snapshot.unavailableFiles?.length) setDownloadError(`已下载可用代码，以下文件缺失：${snapshot.unavailableFiles.join("、")}`);
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : "代码包下载失败");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="production-outputs" aria-label="运行产物" aria-live="polite">
      <div className="production-output-summary">
        <h3>{status}</h3><code>{runId}</code>
        {recordedAt && <p>本地实跑回放 · {new Date(recordedAt).toLocaleString()} · 日志、代码和截图均来自该次真实运行，不在演示现场重新构建。</p>}
        <p>{events.length ? `${events.length} 个真实事件 · ${events.at(-1)?.title}` : "正在连接服务端，等待执行事件…"}</p>
        {!running && <p>代码包包含目标仓库中的生成 / 修改文件与运行报告；截图来自实际浏览器渲染。</p>}
        {typeof terminalEvent?.data?.outputError === "string" && <p role="alert">代码快照保存失败：{terminalEvent.data.outputError}</p>}
      </div>
      <div className="production-output-actions">
        <a className="button secondary" href="#production-trace">查看执行日志（{events.length}）</a>
        <button className="button primary" disabled={running || typeof outputId !== "string" || downloading} onClick={() => void downloadCode()}>
          {downloading ? "正在打包代码…" : "下载代码包"}
        </button>
        <button className="button secondary" disabled={running} onClick={onDownloadReport}>下载完整运行报告</button>
        {viewports.map((viewport) => (
          <a key={viewport.name} className="button secondary" href={screenshots?.[viewport.name] ?? `/api/production/runs/${runId}/renders/${encodeURIComponent(viewport.name)}`} download={`${runId}-${viewport.name}.png`}>
            下载截图 · {viewport.width} × {viewport.height}
          </a>
        ))}
      </div>
      {downloadError && <p className="production-output-error" role="alert">{downloadError}</p>}
    </section>
  );
}
