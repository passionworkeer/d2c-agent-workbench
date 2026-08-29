import { copyFile, mkdir, readFile, writeFile as writeFsFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { TargetProjectProfile } from "@d2c/contracts";

export interface WorkspaceApplyInput {
  files: Record<string, string | Uint8Array>;
  assets?: Array<{ source: string; target: string }>;
  /** 所有相对素材 source 必须解析在该服务端可信根目录内。 */
  assetSourceRoot?: string;
}

const normalize = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "");

function matchesGlob(path: string, glob: string): boolean {
  const prefix = normalize(glob).replace(/\/\*\*.*$/, "").replace(/\*.*$/, "").replace(/\/$/, "");
  const normalized = normalize(path);
  return normalized === prefix || normalized.startsWith(`${prefix}/`);
}

export const matchesWriteGlob = matchesGlob;

export class RunWorkspace {
  readonly root: string;
  readonly profile: TargetProjectProfile;

  private constructor(root: string, profile: TargetProjectProfile) {
    this.root = resolve(root);
    this.profile = profile;
  }

  static async create(root: string, profile: TargetProjectProfile): Promise<RunWorkspace> {
    const workspace = new RunWorkspace(root, profile);
    await mkdir(workspace.root, { recursive: true });
    return workspace;
  }

  private resolveWritePath(path: string): string {
    const normalized = normalize(path);
    const absolute = resolve(this.root, normalized);
    const fromRoot = relative(this.root, absolute);
    if (isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
      throw new Error(`path escapes workspace: ${path}`);
    }
    if (!this.profile.allowedWriteGlobs.some((glob) => matchesGlob(normalized, glob))) {
      throw new Error(`path is outside allowedWriteGlobs: ${path}`);
    }
    return absolute;
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<string> {
    const absolute = this.resolveWritePath(path);
    await mkdir(resolve(absolute, ".."), { recursive: true });
    await writeFsFile(absolute, content);
    return absolute;
  }

  async readFile(path: string): Promise<string> {
    const absolute = this.resolveWritePath(path);
    return readFile(absolute, "utf8");
  }

  async apply(input: WorkspaceApplyInput): Promise<string[]> {
    const written: string[] = [];
    for (const [path, content] of Object.entries(input.files)) written.push(await this.writeFile(path, content));
    const assets = input.assets ?? [];
    if (assets.length > 0 && !input.assetSourceRoot) throw new Error("assetSourceRoot is required when copying assets");
    const targetKeys = assets.map((asset) => normalize(asset.target).toLowerCase());
    if (new Set(targetKeys).size !== targetKeys.length) throw new Error("duplicate asset target");
    const sourceRoot = input.assetSourceRoot ? resolve(input.assetSourceRoot) : undefined;
    for (const asset of assets) {
      const source = resolve(sourceRoot ?? "", normalize(asset.source));
      const fromSourceRoot = sourceRoot ? relative(sourceRoot, source) : "..";
      if (!sourceRoot || isAbsolute(fromSourceRoot) || fromSourceRoot === ".." || fromSourceRoot.startsWith(`..${sep}`)) {
        throw new Error(`asset source escapes assetSourceRoot: ${asset.source}`);
      }
      const target = this.resolveWritePath(asset.target);
      await mkdir(resolve(target, ".."), { recursive: true });
      await copyFile(source, target);
      written.push(target);
    }
    return written;
  }
}
