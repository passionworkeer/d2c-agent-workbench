import { useState } from "react";
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

// 仅在 I2D 模式展示：key 仅存 localStorage（设置面板），绝不写入仓库任何文件。
// 浏览器 → 本地 Fastify 代理（key 走 X-LLM-Key 请求头）→ MiniMax，规避 CORS。
export function SettingsPopover({ open, onClose, onChange }: SettingsPopoverProps) {
  const [draft, setDraft] = useState<ProviderSettings>(() => loadProviderSettings());
  const [revealKey, setRevealKey] = useState(false);

  if (!open) return null;

  function commit() {
    saveProviderSettings(draft);
    onChange(draft);
    onClose();
  }

  return (
    <div className="settings-popover" data-testid="settings-popover" role="dialog" aria-label="LLM 设置">
      <div className="settings-head">
        <div>
          <Settings2 size={15} />
          <strong>LLM 提供方</strong>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={14} /></button>
      </div>
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
  );
}
