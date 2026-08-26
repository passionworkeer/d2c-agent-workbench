import { useEffect, useState } from "react";
import { Eye, EyeOff, Figma, KeyRound, Save, Settings2, X } from "lucide-react";
import {
  DEFAULT_FIGMA_SETTINGS,
  loadFigmaSettings,
  saveFigmaSettings,
  type FigmaSettings,
} from "../lib/figma-provider";
import {
  DEFAULT_SETTINGS,
  loadProviderSettings,
  saveProviderSettings,
  type ProviderSettings,
} from "../lib/provider";

interface SettingsPopoverProps {
  open: boolean;
  onClose: () => void;
  onChange: (settings: ProviderSettings) => void;
}

type SettingsTab = "llm" | "figma";

// 仅在 I2D 模式展示。key / PAT 仅存 localStorage（设置面板），绝不写入仓库任何文件。
// LLM：浏览器 → 本地 Fastify 代理（X-LLM-Key 头）→ MiniMax。
// Figma：浏览器 → 同一代理（X-Figma-Token 头）→ Figma REST 写端点。
export function SettingsPopover({ open, onClose, onChange }: SettingsPopoverProps) {
  const [tab, setTab] = useState<SettingsTab>("llm");
  const [draft, setDraft] = useState<ProviderSettings>(() => loadProviderSettings());
  const [figmaDraft, setFigmaDraft] = useState<FigmaSettings>(() => loadFigmaSettings());
  const [revealKey, setRevealKey] = useState(false);
  const [revealPat, setRevealPat] = useState(false);

  // Escape 关闭与 open 同生命周期；点遮罩空白处关闭由 overlay 的 target 判断实现。
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function commit() {
    saveProviderSettings(draft);
    onChange(draft);
    saveFigmaSettings(figmaDraft);
    onClose();
  }

  return (
    <div
      className="settings-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="settings-popover" data-testid="settings-popover" role="dialog" aria-modal="true" aria-label="设置">
        <div className="settings-head">
          <div>
            <Settings2 size={15} />
            <strong>设置</strong>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={14} /></button>
        </div>
        <div className="settings-tabs">
          <button
            className={tab === "llm" ? "active" : ""}
            data-testid="settings-tab-llm"
            onClick={() => setTab("llm")}
          >
            <KeyRound size={13} />LLM
          </button>
          <button
            className={tab === "figma" ? "active" : ""}
            data-testid="settings-tab-figma"
            onClick={() => setTab("figma")}
          >
            <Figma size={13} />Figma
          </button>
        </div>
        <div className="settings-body">
          {tab === "llm" ? (
            <>
              <div className="settings-row">
                <label htmlFor="settings-provider">Provider</label>
                <select
                  id="settings-provider"
                  data-testid="settings-provider"
                  value={draft.provider}
                  onChange={(event) => setDraft({ ...draft, provider: event.target.value as ProviderSettings["provider"] })}
                >
                  <option value="rule">规则解析（默认，离线零风险）</option>
                  <option value="llm">MiniMax / Anthropic 兼容端点</option>
                </select>
              </div>
              <div className="settings-row">
                <label htmlFor="settings-baseurl">Base URL</label>
                <input
                  id="settings-baseurl"
                  data-testid="settings-baseurl"
                  value={draft.baseUrl}
                  onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                  placeholder={DEFAULT_SETTINGS.baseUrl}
                />
              </div>
              <div className="settings-row">
                <label htmlFor="settings-model">Model</label>
                <input
                  id="settings-model"
                  data-testid="settings-model"
                  value={draft.model}
                  onChange={(event) => setDraft({ ...draft, model: event.target.value })}
                  placeholder={DEFAULT_SETTINGS.model}
                />
              </div>
              <div className="settings-row">
                <label htmlFor="settings-key">
                  <KeyRound size={13} /> API Key
                </label>
                <div className="settings-key-wrap">
                  <input
                    id="settings-key"
                    data-testid="settings-key"
                    type={revealKey ? "text" : "password"}
                    value={draft.key}
                    onChange={(event) => setDraft({ ...draft, key: event.target.value })}
                    placeholder="仅存浏览器 localStorage，绝不进仓库 / 下载报告"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setRevealKey((value) => !value)}
                    aria-label={revealKey ? "隐藏 Key" : "显示 Key"}
                  >
                    {revealKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <p className="settings-hint">
                切换到 <strong>LLM</strong> 后，对话面板发出的指令会先 POST 到本地 Fastify 代理；
                代理用 <code>X-LLM-Key</code> 请求头转发到上游，<strong>不</strong>持久化任何 key。
                演示默认走规则解析（无需任何配置）。
              </p>
            </>
          ) : (
            <>
              <div className="settings-row">
                <label htmlFor="settings-figma-pat">
                  <KeyRound size={13} /> Figma PAT（写权限）
                </label>
                <div className="settings-key-wrap">
                  <input
                    id="settings-figma-pat"
                    data-testid="settings-figma-pat"
                    type={revealPat ? "text" : "password"}
                    value={figmaDraft.pat}
                    onChange={(event) => setFigmaDraft({ ...figmaDraft, pat: event.target.value })}
                    placeholder="仅存浏览器 localStorage，绝不进仓库 / 下载报告"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setRevealPat((value) => !value)}
                    aria-label={revealPat ? "隐藏 PAT" : "显示 PAT"}
                  >
                    {revealPat ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div className="settings-row">
                <label htmlFor="settings-figma-filekey">File Key</label>
                <input
                  id="settings-figma-filekey"
                  data-testid="settings-figma-filekey"
                  value={figmaDraft.fileKey}
                  onChange={(event) => setFigmaDraft({ ...figmaDraft, fileKey: event.target.value })}
                  placeholder="Figma 文件 URL 中 file/ 后那段"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="settings-row">
                <label htmlFor="settings-figma-baseurl">Base URL</label>
                <input
                  id="settings-figma-baseurl"
                  data-testid="settings-figma-baseurl"
                  value={figmaDraft.baseUrl}
                  onChange={(event) => setFigmaDraft({ ...figmaDraft, baseUrl: event.target.value })}
                  placeholder={DEFAULT_FIGMA_SETTINGS.baseUrl}
                />
              </div>
              <p className="settings-hint">
                回写走本地 Fastify 代理（<code>X-Figma-Token</code> 请求头）→ Figma REST 写端点；
                PAT 权限不足时自动降级为把变更 JSON 以评论发布到目标文件。
              </p>
            </>
          )}
        </div>
        <div className="settings-actions">
          <button className="button secondary" onClick={onClose}>取消</button>
          <button className="button primary" data-testid="settings-save" onClick={commit}>
            <Save size={14} />保存
          </button>
        </div>
      </div>
    </div>
  );
}
