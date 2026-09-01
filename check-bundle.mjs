import { buildFigmaImportBundle } from "./packages/figma-patcher/dist/export.js";
import fs from "node:fs";
const spec = JSON.parse(fs.readFileSync("examples/activity-pages/commerce-feed/activity-spec.json", "utf8"));
const bundle = buildFigmaImportBundle(spec, {}, [{id:"reference", mimeType:"image/jpeg", data:"AAAA", path:"reference.jpg"}]);
function walk(n, depth=0) {
  const indent = "  ".repeat(depth);
  console.log(`${indent}${n.id} ${n.type} x=${n.x} y=${n.y} w=${n.width} h=${n.height} fills=${n.fills?.length||0} crop=${n.imageCrop?`${n.imageCrop.x.toFixed(2)},${n.imageCrop.y.toFixed(2)} ${n.imageCrop.width.toFixed(2)}x${n.imageCrop.height.toFixed(2)}`:'-'} chars=${(n.characters||'').slice(0,15)}`);
  for (const c of n.children || []) walk(c, depth+1);
}
for (const r of bundle.nodes) walk(r);
