import { useMemo, useState, type ReactNode } from "react";
import { Puck, type Config, type Data } from "@measured/puck";
import "@measured/puck/puck.css";
import type { ActivitySpec, SpecEditOp } from "@d2c/contracts";

// Puck 原型适配器：ActivitySpec role → Puck 组件配置，节点树 → Puck 数据。
// 文本编辑经带 label 的输入发出类型化 SpecEditOp（set-content），
// Puck 画布承担可视化排布；两者共用同一份 spec 与稳定节点 id。

export interface PrototypeEditorProps {
  spec: ActivitySpec;
  onEdit: (ops: SpecEditOp[]) => void;
}

/** 每个 Puck 组件的渲染属性（与 ActivitySpec 节点字段对齐；id 供 Puck 做条目身份） */
export interface PuckComponentProps {
  id: string;
  nodeId: string;
  name: string;
  text?: string;
}

/** 适配层自己的配置/数据结构（与 Puck 0.20 的 fields-by-key、root+content 结构同构） */
export interface PuckAdapterConfig {
  components: Record<string, {
    fields: Record<string, { type: "text" }>;
    render: (props: PuckComponentProps) => ReactNode;
  }>;
}

export interface PuckAdapterData {
  root: { props: { title: string } };
  content: Array<{ type: string; props: PuckComponentProps }>;
}

export function buildPuckConfig(spec: ActivitySpec): PuckAdapterConfig {
  const roles = [...new Set(spec.nodes.map((node) => node.role))];
  const components: PuckAdapterConfig["components"] = {};
  for (const role of roles) {
    const fieldKeys = role === "text" ? ["nodeId", "name", "text"] : ["nodeId", "name"];
    components[role] = {
      fields: Object.fromEntries(fieldKeys.map((key) => [key, { type: "text" as const }])),
      render: ({ nodeId, name, text }: PuckComponentProps) => (
        <div data-d2c-node-id={nodeId} style={{ outline: "1px dashed rgba(0,0,0,.15)", padding: 4 }}>
          {text ?? `${role} · ${name}`}
        </div>
      ),
    };
  }
  return { components };
}

export function buildPuckData(spec: ActivitySpec): PuckAdapterData {
  return {
    root: { props: { title: spec.page.name } },
    content: spec.nodes.map((node) => ({
        type: node.role,
        props: {
          // Puck 0.20 的条目身份/LayerTree key 取自 props.id
          id: node.id,
          nodeId: node.id,
          name: node.name,
          ...(node.content?.text !== undefined ? { text: node.content.text } : {}),
        },
      })),
  };
}

export function PrototypeEditor({ spec, onEdit }: PrototypeEditorProps) {
  const config = useMemo(() => buildPuckConfig(spec), [spec]);
  const initialData = useMemo(() => buildPuckData(spec), [spec]);
  const [data, setData] = useState<PuckAdapterData>(initialData);
  const textNodes = useMemo(() => spec.nodes.filter((node) => node.role === "text" && node.content?.text !== undefined), [spec]);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(textNodes.map((node) => [node.id, node.content?.text ?? ""])));
  return (
    <div className="prototype-editor">
      <div className="prototype-fields" data-testid="prototype-fields">
        <h3>原型编辑</h3>
        {textNodes.map((node) => (
          <div key={node.id} style={{ margin: "8px 0" }}>
            <span style={{ display: "block", fontSize: 12, color: "#666" }}>{`${node.id} 文本`}</span>
            <input
              aria-label={`${node.id} 文本`}
              value={drafts[node.id] ?? ""}
              onChange={(event) => {
                const text = event.target.value;
                setDrafts((current) => ({ ...current, [node.id]: text }));
                onEdit([{ kind: "set-content", nodeId: node.id, text }]);
              }}
            />
          </div>
        ))}
        {spec.nodes
          .filter((node) => node.role === "section" || node.role === "container")
          .map((node) => (
            <div key={node.id} data-testid={`prototype-structure-${node.id}`} style={{ fontSize: 12, color: "#444" }}>
              {`${node.role} · ${node.name}`}
            </div>
          ))}
      </div>
      <div className="prototype-canvas" data-testid="prototype-puck">
        <Puck
          config={config as unknown as Config}
          data={data as unknown as Data}
          onPublish={(published) => {
            const next = published as unknown as PuckAdapterData;
            setData(next);
            const ops: SpecEditOp[] = [];
            for (const item of next.content) {
              const node = spec.nodes.find((entry) => entry.id === item.props.nodeId);
              if (item.props.text !== undefined && node?.content?.text !== item.props.text) {
                ops.push({ kind: "set-content", nodeId: item.props.nodeId, text: item.props.text });
              }
            }
            if (ops.length) onEdit(ops);
          }}
        />
      </div>
    </div>
  );
}
