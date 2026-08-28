import { randomUUID } from "node:crypto";
import { mkdir, open, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

export interface ArtifactRecord {
  id: string;
  kind: string;
  path: string;
  absolutePath: string;
  createdAt: string;
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export class FileArtifactStore {
  readonly root: string;
  readonly runId: string;
  readonly runDirectory: string;
  private sequence = 0;
  private readonly records: ArtifactRecord[] = [];

  private constructor(root: string, runId: string) {
    this.root = resolve(root);
    this.runId = runId;
    this.runDirectory = resolve(this.root, runId);
  }

  static async create(root: string, runId: string): Promise<FileArtifactStore> {
    if (!SAFE_NAME.test(runId)) throw new Error("run id must contain only letters, numbers, dash or underscore");
    const store = new FileArtifactStore(root, runId);
    await mkdir(store.runDirectory, { recursive: true });
    return store;
  }

  async writeJson(kind: string, name: string, value: unknown): Promise<ArtifactRecord> {
    if (!SAFE_NAME.test(kind) || !SAFE_NAME.test(name)) throw new Error("artifact kind and name must be safe identifiers");
    const directory = resolve(this.runDirectory, kind);
    await mkdir(directory, { recursive: true });
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let absolutePath = "";
    while (!handle) {
      this.sequence += 1;
      absolutePath = resolve(directory, `${name}.${String(this.sequence).padStart(3, "0")}.json`);
      try {
        handle = await open(absolutePath, "wx");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    } finally {
      await handle.close();
    }
    const record: ArtifactRecord = {
      id: `artifact-${randomUUID()}`,
      kind,
      path: relative(this.root, absolutePath).replaceAll("\\", "/"),
      absolutePath,
      createdAt: new Date().toISOString(),
    };
    this.records.push(record);
    return record;
  }

  async list(): Promise<ArtifactRecord[]> {
    if (this.records.length > 0) return [...this.records];
    await readdir(this.runDirectory);
    return [];
  }
}
