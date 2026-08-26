import type { ComponentMapping, UISpec, UISpecNode } from "@d2c/contracts";

interface RegistryEntry {
  codeComponent: string;
  importPath: string;
  figmaNames: string[];
}

// 与 asset-indexer 扫描出的 RegistryEntry 结构兼容（多余字段不影响注入）。
export interface RegistryEntryInput {
  codeComponent: string;
  importPath: string;
  figmaNames: string[];
}

const staticRegistry: RegistryEntry[] = [
  {
    codeComponent: "Header",
    importPath: "@/components/Header",
    figmaNames: ["Header / Commerce", "Header"],
  },
  {
    codeComponent: "ProductCard",
    importPath: "@/components/ProductCard",
    figmaNames: ["Product Card / Default", "Product Card"],
  },
  {
    codeComponent: "Button",
    importPath: "@/components/Button",
    figmaNames: ["Button / Primary", "Button / Secondary", "Button"],
  },
  {
    codeComponent: "Input",
    importPath: "@/components/Input",
    figmaNames: ["Input / Text", "Input"],
  },
  {
    codeComponent: "Badge",
    importPath: "@/components/Badge",
    figmaNames: ["Badge / Default", "Badge"],
  },
  {
    codeComponent: "Text",
    importPath: "@/components/Text",
    figmaNames: ["Text / Body", "Text"],
  },
];

export const SDS_REGISTRY_SIZE = staticRegistry.length;

// 从扫描结果构建运行时 registry（asset-indexer → matcher 的注入入口）。
// 跳过缺 codeComponent / 缺 figmaNames 的残缺条目，防止空名误命中。
export function buildRegistryFromEntries(entries: RegistryEntryInput[]): RegistryEntry[] {
  return entries
    .filter((entry) => entry.codeComponent.trim() !== "" && entry.figmaNames.length > 0)
    .map((entry) => ({
      codeComponent: entry.codeComponent,
      importPath: entry.importPath,
      figmaNames: [...entry.figmaNames],
    }));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function collectComponentNodes(node: UISpecNode): UISpecNode[] {
  const own = node.component?.figmaComponent ? [node] : [];
  return own.concat(node.children.flatMap(collectComponentNodes));
}

function matchNode(registry: RegistryEntry[], node: UISpecNode): ComponentMapping {
  const figmaComponent = node.component?.figmaComponent ?? node.name;
  const props = node.component?.props ?? {};

  const exact = registry.find((entry) =>
    entry.figmaNames.some((name) => name.toLowerCase() === figmaComponent.toLowerCase()),
  );
  const normalized = exact
    ? undefined
    : registry.find((entry) =>
        entry.figmaNames.some((name) => normalize(name) === normalize(figmaComponent)),
      );
  const prefixed =
    exact || normalized
      ? undefined
      : registry.find((entry) =>
          entry.figmaNames.some((name) => {
            const alias = normalize(name);
            const query = normalize(figmaComponent);
            const shorter = Math.min(alias.length, query.length);
            return (
              shorter >= 4 && (query.startsWith(alias) || alias.startsWith(query))
            );
          }),
        );
  const selected = exact ?? normalized ?? prefixed;

  if (!selected) {
    return {
      nodeId: node.id,
      figmaComponent,
      codeComponent: "UnmappedComponent",
      importPath: "",
      props,
      confidence: 0,
      status: "unmapped",
      evidence: ["未在 SDS Registry 中找到兼容组件"],
    };
  }

  // 证据只陈述实际执行过的检查；置信度是演示 Registry 的固定标定值，
  // 并不代表对 props 兼容性做过校验。
  const matchEvidence = exact
    ? ["Figma 组件名称精确匹配"]
    : normalized
      ? ["Figma 组件名称归一化后匹配"]
      : ["Figma 组件名称前缀匹配，需要人工确认"];
  const confidence = exact ? 0.96 : normalized ? 0.82 : 0.72;
  return {
    nodeId: node.id,
    figmaComponent,
    codeComponent: selected.codeComponent,
    importPath: selected.importPath,
    props,
    confidence,
    status: confidence >= 0.8 ? "accepted" : "review",
    evidence: [
      ...matchEvidence,
      `Props ${Object.keys(props).length} 项按原样透传，未做兼容性校验`,
      "导入路径来自 SDS Registry（内置静态表或 asset-indexer 扫描注入）",
    ],
  };
}

// registry 可注入：缺省用内置静态表；asset-indexer 扫描的企业组件库走第二参。
export function mapSdsComponents(
  spec: UISpec,
  registry: RegistryEntry[] = staticRegistry,
): ComponentMapping[] {
  return collectComponentNodes(spec.root).map((node) => matchNode(registry, node));
}
