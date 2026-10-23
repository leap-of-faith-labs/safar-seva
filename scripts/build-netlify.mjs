import { cp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  out = path.join(root, "dist/netlify");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(path.join(root, "public"), out, { recursive: true });
// Never copy .env, source credentials, node_modules or the personal workspace.
const seasonPath = path.join(out, "safar/season.json");
const season = JSON.parse(await readFile(seasonPath, "utf8"));
for (const key of Object.keys(season.liveBaseline || {})) season.liveBaseline[key] = 0;
await writeFile(seasonPath, JSON.stringify(season, null, 2) + "\n");
await writeFile(
  path.join(out, "index.html"),
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/safar/index.html"><title>Safar Seva</title></head><body><a href="/safar/index.html">Open Safar Seva</a></body></html>',
);
console.log(
  "Netlify static site prepared in dist/netlify. Deploy it together with netlify/functions.",
);
