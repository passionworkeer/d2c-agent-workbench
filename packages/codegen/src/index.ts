import {
  type ComponentMapping,
  type TokenBinding,
  type TokenDefinition,
  type UISpec,
  type UISpecNode,
} from "@d2c/contracts";

export * from "./production";

// 一处样式引用在产物代码中的实际形态。evaluator 唯一扫描面。
export interface StyleRef {
  nodeId: string;
  property: string; // 例 "layout.gap" / "padding.right" / "styles.fills"
  kind: "spacing" | "color" | "typography";
  sourceValue: string | number;
  emitted:
    | { type: "var"; tokenName: string; declared: boolean }
    | { type: "literal"; value: string | number; driftPx?: number };
}

export interface CodeElement {
  nodeId: string;
  tag: string;
  sdsComponent?: string;
  props: Record<string, unknown>;
}

export interface CodeArtifact {
  mode: "draft" | "final";
  code: string;
  files: string[];
  elements: CodeElement[];
  styleRefs: StyleRef[];
  /** 写入产物的 tokens.css 内容，包含本次评估生效的 Design Token。 */
  tokensCss: string;
  /** 本次生成所认为的"已声明 Token"：草稿=输入；终稿=输入 + 本地合成。 */
  effectiveTokens: TokenDefinition[];
  /** 输入声明表里没出现的变量名引用数（草稿=真实未声明；终稿=synthesizer 兜底后 = 0）。 */
  inputUndeclaredCount: number;
}

function isValueBinding(value: number | TokenBinding | undefined): value is TokenBinding {
  return typeof value === "object" && value !== null && "variable" in value;
}

function asBinding(value: unknown): TokenBinding | undefined {
  return isValueBinding(value as number | TokenBinding | undefined) ? (value as TokenBinding) : undefined;
}

function kindOf(property: string): StyleRef["kind"] {
  if (property.startsWith("styles.fills")) return "color";
  if (property.startsWith("styles.fontSize") || property.startsWith("styles.lineHeight")) return "typography";
  return "spacing";
}

function getDeclared(name: string, declared: TokenDefinition[]): TokenDefinition | undefined {
  return declared.find((token) => token.name === name);
}

function isAligned16(value: number | string): boolean {
  return typeof value === "number" && value % 16 === 0;
}

// 草稿偏置：spacing 仅在「值是 16 的倍数 且 声明值与绑定值一致 且 在声明表里」时 emit var()；
// color/typography 仅在「在声明表里」时 emit var()。
// 终稿模式：未在声明表里的也走 var，由 synthesizer 兜底补齐 token。
function decideForBinding(
  kind: StyleRef["kind"],
  bindingValue: number | string,
  variableName: string,
  declared: TokenDefinition | undefined,
  mode: "draft" | "final",
  effectiveDeclaredNames: Set<string>,
): StyleRef["emitted"] {
  const inEffective = effectiveDeclaredNames.has(variableName);
  if (mode === "final") {
    // 终稿：emit var()，是否 declared 由 synthesizer 决定（后续扫描统一回填）。
    return { type: "var", tokenName: variableName, declared: inEffective };
  }
  // 草稿
  if (kind === "spacing" && typeof bindingValue === "number") {
    const canVar =
      inEffective && isAligned16(bindingValue) && declared?.type === "FLOAT" && declared.value === bindingValue;
    if (canVar) return { type: "var", tokenName: variableName, declared: true };
    const snapped = Math.max(16, Math.floor(bindingValue / 16) * 16);
    const drift = snapped !== bindingValue ? Math.abs(snapped - bindingValue) : 0;
    return { type: "literal", value: snapped, driftPx: drift || undefined };
  }
  if (inEffective) return { type: "var", tokenName: variableName, declared: true };
  return { type: "literal", value: bindingValue };
}

function walkNode(
  node: UISpecNode,
  declared: TokenDefinition[],
  effectiveDeclaredNames: Set<string>,
  mode: "draft" | "final",
  output: StyleRef[],
): { undeclaredCount: number } {
  let undeclaredCount = 0;
  const layout = node.layout;
  const gapBinding = asBinding(layout.gap);
  if (gapBinding) {
    if (!effectiveDeclaredNames.has(gapBinding.variable)) undeclaredCount += 1;
    const bindingValue = gapBinding.value;
    output.push({
      nodeId: node.id,
      property: "layout.gap",
      kind: "spacing",
      sourceValue: bindingValue as number | string,
      emitted: decideForBinding(
        "spacing",
        typeof bindingValue === "number" ? bindingValue : Number(bindingValue),
        gapBinding.variable,
        getDeclared(gapBinding.variable, declared),
        mode,
        effectiveDeclaredNames,
      ),
    });
  }
  if (layout.padding) {
    for (const edge of ["top", "right", "bottom", "left"] as const) {
      const edgeBinding = asBinding(layout.padding[edge]);
      if (edgeBinding) {
        if (!effectiveDeclaredNames.has(edgeBinding.variable)) undeclaredCount += 1;
        const bindingValue = edgeBinding.value;
        output.push({
          nodeId: node.id,
          property: `padding.${edge}`,
          kind: "spacing",
          sourceValue: bindingValue as number | string,
          emitted: decideForBinding(
            "spacing",
            typeof bindingValue === "number" ? bindingValue : Number(bindingValue),
            edgeBinding.variable,
            getDeclared(edgeBinding.variable, declared),
            mode,
            effectiveDeclaredNames,
          ),
        });
      }
    }
  }
  for (const [property, value] of Object.entries(node.styles)) {
    if (value && typeof value === "object" && "variable" in (value as { variable?: string })) {
      const binding = value as { value: number | string | boolean; variable: string };
      if (!effectiveDeclaredNames.has(binding.variable)) undeclaredCount += 1;
      const kind = kindOf(`styles.${property}`);
      output.push({
        nodeId: node.id,
        property: `styles.${property}`,
        kind,
        sourceValue: binding.value as number | string,
        emitted: decideForBinding(
          kind,
          typeof binding.value === "number" ? binding.value : String(binding.value),
          binding.variable,
          getDeclared(binding.variable, declared),
          mode,
          effectiveDeclaredNames,
        ),
      });
    }
  }
  for (const child of node.children) {
    const childResult = walkNode(child, declared, effectiveDeclaredNames, mode, output);
    undeclaredCount += childResult.undeclaredCount;
  }
  return { undeclaredCount };
}

function walkElements(
  node: UISpecNode,
  mappings: ComponentMapping[],
  output: CodeElement[],
  indent: number,
): string {
  const mapping = mappings.find((m) => m.nodeId === node.id);
  if (mapping && mapping.status !== "unmapped") {
    const element: CodeElement = {
      nodeId: node.id,
      tag: mapping.codeComponent,
      sdsComponent: mapping.codeComponent,
      props: mapping.props,
    };
    output.push(element);
    const propsString = Object.entries(mapping.props)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ");
    return `${"  ".repeat(indent)}<${mapping.codeComponent}${propsString ? ` ${propsString}` : ""} />`;
  }
  const tag = node.type === "TEXT" ? "span" : "div";
  output.push({ nodeId: node.id, tag, props: { className: node.semanticRole ?? node.id } });
  const children = node.children
    .map((child) => walkElements(child, mappings, output, indent + 1))
    .join("\n");
  return `${"  ".repeat(indent)}<${tag}>\n${children}\n${"  ".repeat(indent)}</${tag}>`;
}

function renderImports(mappings: ComponentMapping[]): string {
  const imports = new Set<string>();
  for (const mapping of mappings) {
    if (mapping.status === "unmapped" || !mapping.importPath) continue;
    imports.add(`import { ${mapping.codeComponent} } from "${mapping.importPath}";`);
  }
  return [...imports].sort().join("\n");
}

function renderTokensCss(tokens: TokenDefinition[]): string {
  const lines = tokens.map((token) => {
    if (token.type === "COLOR") return `  --${token.name.replace(/\//g, "-")}: ${token.value};`;
    if (token.type === "FLOAT") return `  --${token.name.replace(/\//g, "-")}: ${token.value}px;`;
    return `  --${token.name.replace(/\//g, "-")}: ${token.value};`;
  });
  return `:root {\n${lines.join("\n")}\n}\n`;
}

// 终稿模式：补齐本地合成的 token，让所有 binding 都能 emit var()。
function synthesizeTokensForFinal(
  declared: TokenDefinition[],
  styleRefs: StyleRef[],
): TokenDefinition[] {
  const seen = new Set(declared.map((token) => token.name));
  const additions: TokenDefinition[] = [];
  for (const ref of styleRefs) {
    if (ref.emitted.type === "var" && !seen.has(ref.emitted.tokenName)) {
      seen.add(ref.emitted.tokenName);
      additions.push({
        name: ref.emitted.tokenName,
        type: ref.kind === "color" ? "COLOR" : "FLOAT",
        value: typeof ref.sourceValue === "number" ? ref.sourceValue : String(ref.sourceValue),
      });
    }
  }
  return [...declared, ...additions];
}

export function generateReactCode(
  spec: UISpec,
  mappings: ComponentMapping[],
  mode: "draft" | "final",
): CodeArtifact {
  const declared = spec.tokens ?? [];
  const effectiveDeclaredNames = new Set(declared.map((token) => token.name));
  const styleRefs: StyleRef[] = [];
  const walkResult = walkNode(spec.root, declared, effectiveDeclaredNames, mode, styleRefs);
  const inputUndeclaredCount = walkResult.undeclaredCount;

  let effectiveTokens = declared;
  if (mode === "final") {
    effectiveTokens = synthesizeTokensForFinal(declared, styleRefs);
    for (const ref of styleRefs) {
      if (ref.emitted.type === "var") ref.emitted.declared = true;
    }
  }

  const elements: CodeElement[] = [];
  const jsxBody = walkElements(spec.root, mappings, elements, 2);
  const code = `${renderImports(mappings)}\n\nexport function ProductGridPage() {\n  return (\n    <main className="page-shell">\n${jsxBody}\n    </main>\n  );\n}`;

  return {
    mode,
    code,
    files: ["src/pages/ProductGridPage.tsx", "src/pages/product-grid.css"],
    elements,
    styleRefs,
    tokensCss: renderTokensCss(effectiveTokens),
    effectiveTokens,
    inputUndeclaredCount,
  };
}
