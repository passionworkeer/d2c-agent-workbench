import { designBundleSchema, type DesignBundle } from "@d2c/contracts";
import { strFromU8, unzipSync } from "fflate";

const MAX_FILES = 200;
const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const REQUIRED_FILES = [
  "manifest.json",
  "design.json",
  "variables.json",
  "components.json",
] as const;

export class BundleError extends Error {
  readonly code = "INPUT_INVALID";
}

function assertSafePath(path: string): void {
  const segments = path.replaceAll("\\", "/").split("/");
  if (
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    segments.includes("..")
  ) {
    throw new BundleError(`Unsafe archive path: ${path}`);
  }
}

function parseJson(files: Record<string, Uint8Array>, name: string): unknown {
  const bytes = files[name];
  if (!bytes) {
    throw new BundleError(`Missing required file: ${name}`);
  }

  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    throw new BundleError(`Invalid JSON file: ${name}`);
  }
}

export function parseFigmaBundle(archive: Uint8Array): DesignBundle {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch {
    throw new BundleError("Invalid ZIP archive");
  }

  const entries = Object.entries(files);
  if (entries.length > MAX_FILES) {
    throw new BundleError(`Archive exceeds ${MAX_FILES} files`);
  }

  let totalBytes = 0;
  for (const [path, bytes] of entries) {
    assertSafePath(path);
    totalBytes += bytes.byteLength;
  }
  if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new BundleError("Archive exceeds 20 MB after extraction");
  }

  for (const name of REQUIRED_FILES) {
    if (!files[name]) {
      throw new BundleError(`Missing required file: ${name}`);
    }
  }

  const manifest = parseJson(files, "manifest.json");
  const design = parseJson(files, "design.json") as { nodes?: unknown };
  const variables = parseJson(files, "variables.json");
  const components = parseJson(files, "components.json");
  const preview = files["preview/root.svg"];

  const candidate = {
    manifest,
    nodes: design.nodes,
    variables,
    components,
    previewUrl: preview
      ? `data:image/svg+xml;base64,${Buffer.from(preview).toString("base64")}`
      : undefined,
  };

  const result = designBundleSchema.safeParse(candidate);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".") || "bundle";
    throw new BundleError(`Bundle schema validation failed at ${path}`);
  }

  return result.data;
}
