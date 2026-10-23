// Runs the same handlers locally, without publishing or touching a live database.
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import api from "../netlify/functions/api.mjs";
import login from "../netlify/functions/admin-login.mjs";
export async function serve({ port = 4190, handler = api, loginHandler = login } = {}) {
  const root = path.resolve(import.meta.dirname, "../public");
  const types = {
    ".html": "text/html; charset=utf-8",
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json",
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${server.address().port}`);
      if (url.pathname.startsWith("/api/")) {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 16000) {
            res.writeHead(413);
            res.end();
            return;
          }
          chunks.push(chunk);
        }
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          ...(["GET", "HEAD"].includes(req.method) ? {} : { body: Buffer.concat(chunks) }),
        });
        const response = await (url.pathname === "/api/admin/login" ? loginHandler : handler)(
          request,
        );
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (["/", "/safar", "/safar/", "/admin"].includes(url.pathname)) {
        res.writeHead(302, {
          Location: url.pathname === "/admin" ? "/safar/admin.html" : "/safar/index.html",
        });
        res.end();
        return;
      }
      const filename = path.resolve(root, "." + decodeURIComponent(url.pathname));
      if (!filename.startsWith(root + path.sep) || !(await stat(filename)).isFile()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": types[path.extname(filename)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(await readFile(filename));
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  console.log(`Safar Seva: http://127.0.0.1:${server.address().port}/safar/index.html`);
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  await serve();
