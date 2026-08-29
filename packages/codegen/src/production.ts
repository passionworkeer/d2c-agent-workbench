import {
  codePlanSchema,
  sourceMapSchema,
  type ActivityNode,
  type ActivitySpec,
  type CodePlan,
  type ComponentMapping,
  type D2CSourceMap,
  type TargetProjectProfile,
} from "@d2c/contracts";

export interface GeneratedProductionOutput {
  plan: CodePlan;
  files: Record<string, string>;
  sourceMap: D2CSourceMap;
}

/**
 * 服务端注册表增强过的可信映射：携带映射组件在目标仓库中的源码文件，
 * 供 composite source locator 归因（映射子树的全部后代节点指向该文件）。
 * sourceFile 只由服务端在白名单校验通过后附加；客户端 schema 非 strict 会剥离未知键，无法注入。
 */
export interface SourcedComponentMapping extends ComponentMapping {
  sourceFile?: string;
}

const normalizePath = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "");
const className = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "-");
const COMPONENT_IDENTIFIER = /^[A-Z_$][A-Za-z0-9_$]*$/;
const IMPORT_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9@_$./-]+$/;

function pathMatchesGlob(path: string, glob: string): boolean {
  const normalizedPath = normalizePath(path);
  const prefix = normalizePath(glob).replace(/\/\*\*.*$/, "").replace(/\*.*$/, "").replace(/\/$/, "");
  return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
}

export function validateCodePlan(plan: CodePlan, profile: TargetProjectProfile): void {
  codePlanSchema.parse(plan);
  for (const path of [...plan.files.map((file) => file.path), ...plan.assets.map((asset) => asset.target)]) {
    if (!profile.allowedWriteGlobs.some((glob) => pathMatchesGlob(path, glob))) {
      throw new Error(`CodePlan path is outside allowedWriteGlobs: ${path}`);
    }
  }
}

function cssSize(rule: ActivityNode["layout"]["width"]): string | undefined {
  if (rule.mode === "hug") return "fit-content";
  if (rule.mode === "fill") return "100%";
  if (rule.value === undefined) return undefined;
  if (rule.mode === "percent") return `${rule.value}%`;
  if (rule.mode === "viewport") return `${rule.value}${rule.unit === "vh" ? "vh" : "vw"}`;
  return `${rule.value}px`;
}

function nodeCss(node: ActivityNode): string {
  const rules: string[] = [];
  const { layout, visual } = node;
  if (layout.mode === "flex") rules.push("display: flex", `flex-direction: ${layout.direction ?? "row"}`);
  if (layout.mode === "grid") rules.push("display: grid");
  if (["absolute", "sticky", "fixed"].includes(layout.mode)) rules.push(`position: ${layout.mode}`);
  if (layout.align) rules.push(`align-items: ${layout.align}`);
  if (layout.justify) rules.push(`justify-content: ${layout.justify}`);
  if (layout.gap !== undefined) rules.push(`gap: ${layout.gap}px`);
  if (layout.padding) rules.push(`padding: ${layout.padding.top}px ${layout.padding.right}px ${layout.padding.bottom}px ${layout.padding.left}px`);
  const width = cssSize(layout.width);
  const height = cssSize(layout.height);
  if (width) rules.push(`width: ${width}`);
  if (height) rules.push(`height: ${height}`);
  if (layout.minWidth !== undefined) rules.push(`min-width: ${layout.minWidth}px`);
  if (layout.maxWidth !== undefined) rules.push(`max-width: ${layout.maxWidth}px`);
  if (layout.overflow) rules.push(`overflow: ${layout.overflow}`);
  if (layout.zIndex !== undefined) rules.push(`z-index: ${layout.zIndex}`);
  if (layout.position) for (const [edge, value] of Object.entries(layout.position)) if (value !== undefined) rules.push(`${edge}: ${value}px`);
  if (visual.opacity !== 1) rules.push(`opacity: ${visual.opacity}`);
  if (visual.color) rules.push(`color: ${visual.color}`);
  if (visual.background?.value) rules.push(`background: ${visual.background.value}`);
  if (visual.fontFamily) rules.push(`font-family: ${JSON.stringify(visual.fontFamily)}`);
  if (visual.fontSize !== undefined) rules.push(`font-size: ${visual.fontSize}px`);
  if (visual.fontWeight !== undefined) rules.push(`font-weight: ${visual.fontWeight}`);
  if (visual.lineHeight !== undefined) rules.push(`line-height: ${visual.lineHeight}`);
  if (visual.letterSpacing !== undefined) rules.push(`letter-spacing: ${visual.letterSpacing}px`);
  if (visual.textAlign) rules.push(`text-align: ${visual.textAlign}`);
  if (visual.borderRadius !== undefined) rules.push(`border-radius: ${visual.borderRadius}px`);
  if (visual.border) rules.push(`border: ${visual.border}`);
  if (visual.shadow) rules.push(`box-shadow: ${visual.shadow}`);
  if (visual.objectFit) rules.push(`object-fit: ${visual.objectFit}`);
  if (visual.objectPosition) rules.push(`object-position: ${visual.objectPosition}`);
  return `.${className(node.id)} {\n  ${rules.join(";\n  ")}${rules.length ? ";" : ""}\n}`;
}

function responsiveCss(spec: ActivitySpec): string {
  const breakpoints = new Map(spec.breakpoints.map((item) => [item.name, item]));
  const blocks: string[] = [];
  for (const node of spec.nodes) for (const constraint of node.responsive) {
    const breakpoint = breakpoints.get(constraint.viewport);
    if (!breakpoint) continue;
    const rules: string[] = [];
    if (constraint.rule === "stack") rules.push("flex-direction: column");
    if (constraint.rule === "wrap") rules.push("flex-wrap: wrap");
    if (constraint.rule === "hide") rules.push("display: none");
    if (constraint.rule === "resize" && typeof constraint.value === "number") rules.push(`width: ${constraint.value}px`, "max-width: 100%");
    if (!rules.length) continue;
    const query = breakpoint.maxWidth === undefined ? `(min-width: ${breakpoint.minWidth}px)` : `(max-width: ${breakpoint.maxWidth}px)`;
    blocks.push(`@media ${query} {\n  .${className(node.id)} {\n    ${rules.join(";\n    ")};\n  }\n}`);
  }
  return blocks.join("\n\n");
}

function componentName(spec: ActivitySpec): string {
  const parts = spec.page.name.replace(/[^A-Za-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  return `${parts.map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join("") || "Campaign"}Page`;
}

function renderNode(node: ActivityNode, nodes: Map<string, ActivityNode>, assetUrls: Map<string, string>, mappings: Map<string, ComponentMapping>, depth: number, isRoot = false): string {
  const indent = "  ".repeat(depth);
  const attributes = `data-d2c-node-id=${JSON.stringify(node.id)}${isRoot ? ' data-d2c-ready="true"' : ""} className={styles[${JSON.stringify(className(node.id))}]}`;
  const mapping = mappings.get(node.id);
  if (mapping && mapping.status !== "unmapped") return `${indent}<${mapping.codeComponent} ${attributes} {...${JSON.stringify(mapping.props)}} />`;
  if (node.role === "text") return `${indent}<p ${attributes}>{${JSON.stringify(node.content?.text ?? "")}}</p>`;
  if (node.role === "image") return `${indent}<img ${attributes} src=${JSON.stringify(node.content?.assetId ? assetUrls.get(node.content.assetId) ?? "" : "")} alt=${JSON.stringify(node.content?.alt ?? "")} />`;
  const tag = node.role === "page" ? "main" : node.role === "section" ? "section" : "div";
  const children = node.children.map((id) => nodes.get(id)).filter((child): child is ActivityNode => Boolean(child));
  if (!children.length) return `${indent}<${tag} ${attributes} />`;
  return `${indent}<${tag} ${attributes}>\n${children.map((child) => renderNode(child, nodes, assetUrls, mappings, depth + 1)).join("\n")}\n${indent}</${tag}>`;
}

export function generateProductionPage(spec: ActivitySpec, profile: TargetProjectProfile, mappings: SourcedComponentMapping[]): GeneratedProductionOutput {
  for (const mapping of mappings) {
    if (!COMPONENT_IDENTIFIER.test(mapping.codeComponent)) throw new Error(`invalid codeComponent: ${mapping.codeComponent}`);
    if (!IMPORT_PATH.test(mapping.importPath)) throw new Error(`invalid importPath: ${mapping.importPath}`);
    if (!spec.nodes.some((node) => node.id === mapping.nodeId)) throw new Error(`mapping nodeId is not in ActivitySpec: ${mapping.nodeId}`);
  }
  const name = componentName(spec);
  const root = normalizePath(profile.generatedRoot).replace(/\/$/, "");
  const tsxPath = `${root}/${name}.tsx`;
  const cssPath = `${root}/${name}.module.css`;
  const sourceMapPath = `${root}/d2c-source-map.json`;
  const assetUrls = new Map<string, string>();
  const assets = spec.assets.map((asset) => {
    const relativeAssetPath = normalizePath(asset.path);
    const target = `${normalizePath(profile.assetRoot).replace(/\/$/, "")}/${relativeAssetPath}`;
    assetUrls.set(asset.id, `/${normalizePath(profile.assetRoot).replace(/^public\//, "").replace(/\/$/, "")}/${relativeAssetPath}`);
    return { source: relativeAssetPath, target };
  });
  // 多个裁切资产可指向同一物理素材（真实截图样例的整图图集）：同 source 同 target 只拷贝一次；
  // 仅不同 source 落到同一 target 才是真正的冲突
  const assetByTarget = new Map<string, { source: string; target: string }>();
  for (const asset of assets) {
    const key = asset.target.toLowerCase();
    const existing = assetByTarget.get(key);
    if (existing && existing.source.toLowerCase() !== asset.source.toLowerCase()) {
      throw new Error("duplicate asset target after normalization");
    }
    if (!existing) assetByTarget.set(key, asset);
  }
  const uniqueAssets = [...assetByTarget.values()];
  const nodes = new Map(spec.nodes.map((node) => [node.id, node]));
  const mappingByNode = new Map(mappings.map((mapping) => [mapping.nodeId, mapping]));
  const imports = [...new Map(mappings.filter((mapping) => mapping.status !== "unmapped").map((mapping) => [mapping.codeComponent, mapping.importPath]))]
    .map(([component, path]) => `import { ${component} } from ${JSON.stringify(path)};`).join("\n");
  const body = spec.nodes.filter((node) => !node.parentId).map((node) => renderNode(node, nodes, assetUrls, mappingByNode, 2, true)).join("\n");
  const code = `import styles from "./${name}.module.css";${imports ? `\n${imports}` : ""}\n\nexport function ${name}() {\n  return (\n${body}\n  );\n}\n\nexport default ${name};\n`;
  const css = `:global(*), :global(*::before), :global(*::after) {\n  box-sizing: border-box;\n}\n\n:global(body) {\n  margin: 0;\n}\n\n:global(p) {\n  margin: 0;\n}\n\n${spec.nodes.map(nodeCss).join("\n\n")}\n\n${responsiveCss(spec)}\n`;
  // composite source locator：被可信映射组件替换的子树，全部后代节点沿 parentId 链
  // 继承注册的组件源码文件——归因指向真实组件实现而非生成的包装文件。
  const compositeSource = new Map<string, { file: string; componentName: string }>();
  for (const mapping of mappings) {
    if (mapping.status !== "unmapped" && mapping.sourceFile) {
      compositeSource.set(mapping.nodeId, { file: mapping.sourceFile, componentName: mapping.codeComponent });
    }
  }
  const inheritedSource = (node: ActivityNode): { file: string; componentName: string } | undefined => {
    let current: ActivityNode | undefined = node;
    while (current) {
      const hit = compositeSource.get(current.id);
      if (hit) return hit;
      current = current.parentId ? nodes.get(current.parentId) : undefined;
    }
    return undefined;
  };
  const sourceMap = sourceMapSchema.parse({ version: "1.0", locators: spec.nodes.map((node) => {
    const composite = inheritedSource(node);
    return {
      nodeId: node.id,
      file: composite?.file ?? tsxPath,
      componentName: composite?.componentName ?? name,
      // 组件子树的样式在组件实现内，不落在生成的 CSS module 里
      ...(composite ? {} : { styleFile: cssPath, styleSelector: `.${className(node.id)}` }),
      ...(node.content?.assetId ? { assetPaths: uniqueAssets.filter((asset) => asset.source === spec.assets.find((item) => item.id === node.content?.assetId)?.path).map((asset) => asset.target) } : {}),
    };
  }) });
  const plan = codePlanSchema.parse({
    route: spec.page.route,
    files: [
      { path: tsxPath, action: "create", purpose: "活动页 React 结构", nodeIds: spec.nodes.map((node) => node.id) },
      { path: cssPath, action: "create", purpose: "活动页布局和视觉样式", nodeIds: spec.nodes.map((node) => node.id) },
      { path: sourceMapPath, action: "create", purpose: "节点到源码映射", nodeIds: spec.nodes.map((node) => node.id) },
    ],
    reusedComponents: spec.nodes.flatMap((node) => node.component ? [node.component] : []),
    localComponents: [], assets: uniqueAssets, styleStrategy: profile.styleStrategy, risks: spec.unresolved.map((item) => item.reason),
  });
  validateCodePlan(plan, profile);
  return { plan, files: { [tsxPath]: code, [cssPath]: css, [sourceMapPath]: `${JSON.stringify(sourceMap, null, 2)}\n` }, sourceMap };
}
