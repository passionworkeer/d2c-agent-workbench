import { designBundleSchema, type DesignBundle } from "@d2c/contracts";
import { strFromU8, unzipSync, type UnzipFileInfo } from "fflate";

const MAX_FILES = 200;
const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const REQUIRED_FILES = [
  "manifest.json",
  "design.json",
  "variables.json",
  "components.json",
] as const;
// 白名单之外的 entry 一律不解压：既节省内存，也使压缩炸弹在解压前就被丢弃。
const ALLOWED_FILES = new Set<string>([...REQUIRED_FILES, "preview/root.svg"]);

export class BundleError extends Error {
  readonly code = "INPUT_INVALID";
}

function assertSafePath(path: string): void {
  const segments = path.replaceAll("\\", "/").split("/");
  if (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:/.test(path) ||
    segments.includes("..")
  ) {
    throw new BundleError(`不安全的压缩包路径：${path}`);
  }
}

function parseJson(files: Record<string, Uint8Array>, name: string): unknown {
  const bytes = files[name];
  if (!bytes) {
    throw new BundleError(`缺少必需文件：${name}`);
  }

  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    throw new BundleError(`JSON 文件格式错误：${name}`);
  }
}

// base64 编码必须浏览器 / Node 双端可用：本地真实管线在浏览器内调用 parseFigmaBundle，
// 不能依赖 Node 的 Buffer（Chromium 里是 ReferenceError）。btoa 两端都有；
// 分块拼接避免一次性展开超限参数（预览上限 2MB）。
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

export function parseFigmaBundle(archive: Uint8Array): DesignBundle {
  let files: Record<string, Uint8Array>;
  try {
    // 预算在 filter（每个 entry 解压之前调用）中执行：
    // - 诚实炸弹：声明的 originalSize 超预算，解压前即拒绝；
    // - 声明造假偏大：同样在解压前的 new u8(su) 分配之前被拒；
    // - 声明造假偏小：fflate 以声明尺寸预分配且不扩容，输出被截断，后续校验兜底。
    let entryCount = 0;
    let declaredBytes = 0;
    const seenNames = new Set<string>();
    files = unzipSync(archive, {
      filter: (file: UnzipFileInfo) => {
        entryCount += 1;
        if (entryCount > MAX_FILES) {
          throw new BundleError(`压缩包超过 ${MAX_FILES} 个文件上限`);
        }
        assertSafePath(file.name);
        if (seenNames.has(file.name)) {
          throw new BundleError(`压缩包存在重名文件：${file.name}`);
        }
        seenNames.add(file.name);
        if (!ALLOWED_FILES.has(file.name)) return false;
        declaredBytes += file.originalSize;
        if (declaredBytes > MAX_UNCOMPRESSED_BYTES) {
          throw new BundleError("压缩包解压后超过 20MB 上限");
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof BundleError) throw error;
    throw new BundleError("无效的 ZIP 压缩包");
  }

  for (const name of REQUIRED_FILES) {
    if (!files[name]) {
      throw new BundleError(`缺少必需文件：${name}`);
    }
  }

  const manifest = parseJson(files, "manifest.json");
  const design = parseJson(files, "design.json") as { nodes?: unknown };
  const variables = parseJson(files, "variables.json");
  const components = parseJson(files, "components.json");
  const preview = files["preview/root.svg"];
  // 超限预览按缺失处理（previewUrl 本就是可选字段），不放大内存常驻。
  const previewUrl =
    preview && preview.byteLength <= MAX_PREVIEW_BYTES
      ? `data:image/svg+xml;base64,${toBase64(preview)}`
      : undefined;

  const candidate = {
    manifest,
    nodes: design.nodes,
    variables,
    components,
    previewUrl,
  };

  let result: ReturnType<typeof designBundleSchema.safeParse>;
  try {
    result = designBundleSchema.safeParse(candidate);
  } catch (error) {
    // zod 递归 schema 在深度约 1000 层时抛 RangeError（栈溢出），不经过 safeParse 的错误通道。
    if (error instanceof RangeError) {
      throw new BundleError("设计节点嵌套层级过深");
    }
    throw error;
  }
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".") || "bundle";
    throw new BundleError(`资产包结构校验失败：${path}`);
  }

  return result.data;
}
