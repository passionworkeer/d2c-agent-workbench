export interface PixelImage { width: number; height: number; data: Uint8ClampedArray; }
export interface DiffCluster { left: number; top: number; right: number; bottom: number; pixels: number; }
export interface PixelComparison { score: number; differentPixels: number; totalPixels: number; clusters: DiffCluster[]; diffMask: Uint8Array; }

export function comparePixelImages(reference: PixelImage, actual: PixelImage, options: { channelTolerance?: number; minClusterPixels?: number } = {}): PixelComparison {
  if (reference.width !== actual.width || reference.height !== actual.height) throw new Error("尺寸不一致");
  const totalPixels = reference.width * reference.height;
  if (reference.data.length !== totalPixels * 4 || actual.data.length !== totalPixels * 4) throw new Error("像素数据长度非法");
  const tolerance = options.channelTolerance ?? 8;
  const minClusterPixels = options.minClusterPixels ?? 12;
  const diffMask = new Uint8Array(totalPixels);
  let differentPixels = 0;
  for (let index = 0; index < totalPixels; index += 1) {
    const offset = index * 4;
    let delta = 0;
    for (let channel = 0; channel < 4; channel += 1) delta = Math.max(delta, Math.abs(reference.data[offset + channel]! - actual.data[offset + channel]!));
    if (delta > tolerance) { diffMask[index] = 1; differentPixels += 1; }
  }
  const visited = new Uint8Array(totalPixels);
  const clusters: DiffCluster[] = [];
  for (let start = 0; start < totalPixels; start += 1) {
    if (!diffMask[start] || visited[start]) continue;
    const queue = [start]; visited[start] = 1;
    let pixels = 0; let left = reference.width; let right = 0; let top = reference.height; let bottom = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor]!; const x = index % reference.width; const y = Math.floor(index / reference.width);
      pixels += 1; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (const next of [index - 1, index + 1, index - reference.width, index + reference.width]) {
        if (next < 0 || next >= totalPixels || visited[next] || !diffMask[next]) continue;
        if ((next === index - 1 || next === index + 1) && Math.floor(next / reference.width) !== y) continue;
        visited[next] = 1; queue.push(next);
      }
    }
    if (pixels >= minClusterPixels) clusters.push({ left, top, right, bottom, pixels });
  }
  return { score: Math.round((1 - differentPixels / Math.max(1, totalPixels)) * 10_000) / 100, differentPixels, totalPixels, clusters, diffMask };
}
