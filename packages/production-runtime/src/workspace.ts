import { copyFile, mkdir, writeFile as writeFsFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { TargetProjectProfile } from "@d2c/contracts";

export interface WorkspaceApplyInput {
  files: Record<string, string | Uint8Array>;
  assets?: Array<{ source: string; target: string }>;
}

const normalize = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "");

function matchesGlob(path: string, glob: string): boolean {
  const prefix = normalize(glob).replace(/\/\*\*.*$/, "").replace(/\*.*$/, "").replace(/\/$/, "");
  const normalized = normalize(path);
  return normalized === prefix || normalized.startsWith(`${prefix}/`);
}

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

  async apply(input: WorkspaceApplyInput): Promise<string[]> {
    const written: string[] = [];
    for (const [path, content] of Object.entries(input.files)) written.push(await this.writeFile(path, content));
    for (const asset of input.assets ?? []) {
      const target = this.resolveWritePath(asset.target);
      await mkdir(resolve(target, ".."), { recursive: true });
      await copyFile(asset.source, target);
      written.push(target);
    }
    return written;
  }
}
