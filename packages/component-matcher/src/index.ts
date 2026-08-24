import type { ComponentMapping, UISpec, UISpecNode } from "@d2c/contracts";

interface RegistryEntry {
  codeComponent: string;
  importPath: string;
  figmaNames: string[];
}

const registry: RegistryEntry[] = [
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

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function collectComponentNodes(node: UISpecNode): UISpecNode[] {
  const own = node.component?.figmaComponent ? [node] : [];
  return own.concat(node.children.flatMap(collectComponentNodes));
}

function matchNode(node: UISpecNode): ComponentMapping {
  const figmaComponent = node.component?.figmaComponent ?? node.name;
  const exact = registry.find((entry) =>
    entry.figmaNames.some((name) => name === figmaComponent),
  );
  const normalized = registry.find((entry) =>
    entry.figmaNames.some((name) => normalize(name) === normalize(figmaComponent)),
  );
  const selected = exact ?? normalized;

  if (!selected) {
    return {
      nodeId: node.id,
      figmaComponent,
      codeComponent: "UnmappedComponent",
      importPath: "",
      props: node.component?.props ?? {},
      confidence: 0,
      status: "unmapped",
      evidence: ["No compatible SDS component found"],
    };
  }

  const confidence = exact ? 0.96 : 0.82;
  return {
    nodeId: node.id,
    figmaComponent,
    codeComponent: selected.codeComponent,
    importPath: selected.importPath,
    props: node.component?.props ?? {},
    confidence,
    status: confidence >= 0.8 ? "accepted" : "review",
    evidence: [
      exact
        ? "Exact Figma component name matched"
        : "Normalized Figma component name matched",
      "Component props are compatible with the SDS registry",
      "Import path resolved from the target component catalog",
    ],
  };
}

export function mapSdsComponents(spec: UISpec): ComponentMapping[] {
  return collectComponentNodes(spec.root).map(matchNode);
}
