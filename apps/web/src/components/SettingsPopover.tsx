import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, Save, Settings2, X } from "lucide-react";
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

// 仅在 I2D 模式展示。key 仅存 localStorage（设置面板），绝不写入仓库任何文件。
// LLM：浏览器 → 本地 Fastify 代理（X-LLM-Key 头）→ MiniMax。
// Figma PAT / FileKey 的唯一编辑处在 FigmaPatchPanel（输入即存 localStorage）。
// 组件由父级条件挂载（settingsOpen &&），每次打开都从 localStorage 重新读 draft，
// 引擎选择器切换后立即打开也不会拿到过期草稿。
export function SettingsPopover({ open, onClose, onChange }: SettingsPopoverProps) {
  const [draft, setDraft] = useState<ProviderSettings>(() => loadProviderSettings());
  const [revealKey, setRevealKey] = useState(false);

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
    onClose();
  }

  return (
    <div
      className="settings-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="settings-popover" data-testid="settings-popover" role="dialog" aria-modal="true" aria-label="引擎设置">
        <div className="settings-head">
          <div>
            <Settings2 size={15} />
            <strong>引擎设置</strong>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={14} /></button>
        </div>
        {draft.provider === "llm" && draft.key === "" && (
          <p className="settings-alert" data-testid="settings-alert">已选择 LLM 引擎，还需填写 API Key</p>
        )}
        <div className="settings-body">
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
