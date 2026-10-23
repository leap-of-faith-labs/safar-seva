import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."),
  bundle = path.join(root, "dist/safar-netlify-ready"),
  archive = path.join(root, "dist/safar-netlify-ready.zip");
await rm(bundle, { recursive: true, force: true });
await mkdir(path.join(bundle, "scripts"), { recursive: true });
await mkdir(path.join(bundle, "supabase"), { recursive: true });
for (const name of ["public", "netlify"])
  await cp(path.join(root, name), path.join(bundle, name), { recursive: true });
for (const name of ["build-netlify.mjs", "dev-netlify.mjs"])
  await cp(path.join(root, "scripts", name), path.join(bundle, "scripts", name));
for (const name of ["netlify.toml", "netlify.env.example"])
  await cp(path.join(root, name), path.join(bundle, name));
await cp(path.join(root, "NETLIFY-LAUNCH.md"), path.join(bundle, "README.md"));
await cp(
  path.join(root, "supabase/production-setup.sql"),
  path.join(bundle, "supabase/production-setup.sql"),
);
await writeFile(
  path.join(bundle, "package.json"),
  JSON.stringify(
    {
      name: "safar-seva-netlify",
      private: true,
      type: "module",
      engines: { node: ">=22" },
      scripts: {
        "build:netlify": "node scripts/build-netlify.mjs",
        "dev:netlify": "node --env-file-if-exists=.env scripts/dev-netlify.mjs",
      },
    },
    null,
    2,
  ) + "\n",
);
await writeFile(path.join(bundle, ".gitignore"), ".env\nnode_modules\ndist\n.netlify\n");
await rm(archive, { force: true });
const zipped = spawnSync("/usr/bin/zip", ["-q", "-r", archive, "."], {
  cwd: bundle,
  stdio: "inherit",
});
if (zipped.status !== 0) throw new Error("Could not create archive");
console.log("Netlify source package: dist/safar-netlify-ready.zip (no credentials included)");
