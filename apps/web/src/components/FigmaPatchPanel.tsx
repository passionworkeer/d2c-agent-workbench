import { useState } from "react";
import { Figma, KeyRound, Send } from "lucide-react";
import type { EditOp } from "@d2c/canvas-ops";
import type { TraceEvent, UISpec } from "@d2c/contracts";
import {
  applyFigmaPatchViaProvider,
  loadFigmaSettings,
  saveFigmaSettings,
  type FigmaNodeChangePreview,
} from "../lib/figma-provider";

interface FigmaPatchPanelProps {
  spec: UISpec | null;
  /** 对话编辑累计的 ops（回写范围） */
  editOps: EditOp[];
  /** 回写成功后追加 SPEC_EXPORTED 轨迹事件 */
  onExported: (event: TraceEvent) => void;
}

// I2D 设计稿 → Figma 回写面板：PAT / FileKey 仅存浏览器 localStorage，
// 经本地 Fastify 代理（X-Figma-Token 头）调 Figma REST 写端点；
// Preview 走 dryRun（不落 Figma），应用失败 / 权限不足时如实显示原因。
export function FigmaPatchPanel({ spec, editOps, onExported }: FigmaPatchPanelProps) {
  const [settings, setSettings] = useState(() => loadFigmaSettings());
  const [revealPat, setRevealPat] = useState(false);
  const [preview, setPreview] = useState<FigmaNodeChangePreview[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  function updateSettings(patch: Partial<typeof settings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveFigmaSettings(next);
  }

  async function handlePreview() {
    if (!spec) return;
    setBusy(true);
    setNote("");
    const outcome = await applyFigmaPatchViaProvider({ spec, editOps, settings, dryRun: true });
    setBusy(false);
    if (!outcome.ok) {
      setPreview(null);
      setNote(outcome.errorMessage ?? "预览失败");
      return;
    }
    setPreview(outcome.nodeChanges ?? []);
    const parts = [`${outcome.nodeChanges?.length ?? 0} 个节点变更`];
    if ((outcome.skipped?.length ?? 0) > 0) parts.push(`${outcome.skipped?.length} 项跳过`);
    if ((outcome.degradations?.length ?? 0) > 0) parts.push(`${outcome.degradations?.length} 处布局降级`);
    setNote(`预览完成（${parts.join(" · ")}），未写入 Figma`);
  }

  async function handleApply() {
    if (!spec) return;
    setBusy(true);
    setNote("");
    const outcome = await applyFigmaPatchViaProvider({ spec, editOps, settings });
    setBusy(false);
    if (!outcome.ok) {
      setNote(outcome.errorMessage ?? "回写失败");
      return;
    }
    const transport = outcome.transport ?? "rest";
    setNote(
      transport === "comment"
        ? `${outcome.message ?? "已降级为评论"} · ${outcome.fileUrl ?? ""}`
        : `已回写 Figma（${outcome.summary ?? ""}） · ${outcome.fileUrl ?? ""}`,
    );
    const event: TraceEvent = {
      id: `mock-design-run-figma-${Date.now()}`,
      runId: "mock-design-run",
      timestamp: new Date().toISOString(),
      state: "SPEC_EXPORTED",
      title: transport === "comment" ? "Figma 回写已降级为评论" : "设计稿已回写 Figma",
      detail: `transport=${transport} · ${outcome.summary ?? ""} · fileKey=${settings.fileKey}`,
      data: {
        target: "figma",
        fileKey: settings.fileKey,
        transport,
        patchedNodeIds: (outcome.nodeChanges ?? []).map((change) => change.nodeId),
        fileUrl: outcome.fileUrl,
      },
    };
    onExported(event);
  }

  return (
    <div className="figma-patch-panel" data-testid="figma-patch-panel">
      <div className="section-label"><span>回写 Figma</span><span>FIGMA PATCH</span></div>
      <div className="settings-row">
        <label htmlFor="figma-pat"><KeyRound size={13} /> Figma PAT（写权限）</label>
        <div className="settings-key-wrap">
          <input
            id="figma-pat"
            data-testid="figma-pat"
            type={revealPat ? "text" : "password"}
            value={settings.pat}
            onChange={(event) => updateSettings({ pat: event.target.value })}
            placeholder="仅存浏览器 localStorage，经代理转发"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </div>
      <div className="settings-row">
        <label htmlFor="figma-filekey">File Key</label>
        <input
          id="figma-filekey"
          data-testid="figma-filekey"
          value={settings.fileKey}
          onChange={(event) => updateSettings({ fileKey: event.target.value })}
          placeholder="Figma 文件 URL 中 file/ 后那段"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="figma-patch-actions">
        <button
          className="button secondary"
          data-testid="figma-preview"
          disabled={!spec || editOps.length === 0 || busy || !settings.pat || !settings.fileKey}
          onClick={() => void handlePreview()}
        >
          <Figma size={14} />预览变更
        </button>
        <button
          className="button export"
          data-testid="figma-apply"
          disabled={!spec || editOps.length === 0 || busy || !settings.pat || !settings.fileKey}
          onClick={() => void handleApply()}
        >
          <Send size={14} />应用到 Figma
        </button>
      </div>
      {preview && preview.length > 0 && (
        <ul className="figma-patch-preview" data-testid="figma-patch-preview">
          {preview.slice(0, 6).map((change, index) => (
            <li key={`${change.nodeId}-${index}`}>
              <code>{change.nodeId}</code>
              <span>{change.summary}</span>
            </li>
          ))}
        </ul>
      )}
      {preview?.length === 0 && (
        <div className="figma-patch-note">当前编辑没有产生可回写的节点变更。</div>
      )}
      {note && (
        <div className="figma-patch-note" data-testid="figma-patch-note">{note}</div>
      )}
      {editOps.length === 0 && (
        <div className="figma-patch-note">先在上方对话面板编辑画布（如『把第二张卡片换成 lime』），编辑过的节点会出现在回写范围里。</div>
      )}
    </div>
  );
}
