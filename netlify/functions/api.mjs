import catalog from "../../public/safar/stories.json" with { type: "json" };
import network from "../../public/safar/stations.json" with { type: "json" };
import { imageContribution, storySuggestion } from "../../public/safar/story-experiments.mjs";
import { validatePacket } from "../../public/safar/contributions.mjs";
import { database } from "./lib/database.mjs";
import {
  authenticated,
  requireOrigin,
  readJSON,
  sessionCookie,
  json,
  failure,
  deploymentScope,
  UUID,
} from "./lib/security.mjs";
export function createApi({ env = process.env, db = database(env) } = {}) {
  return async (request, context = {}) => {
    try {
      const url = new URL(request.url),
        path = url.pathname,
        method = request.method,
        scope = deploymentScope(env, context);
      if (!["GET", "POST", "PATCH"].includes(method))
        return json({ error: "Method not allowed" }, 405, { Allow: "GET, POST, PATCH" });
      if (method !== "GET") requireOrigin(request);
      if (path === "/api/public/pulse") {
        if (method === "GET") return json({ ...(await db.counts(scope)), epoch: scope.epoch });
        if (method !== "POST") return json({ error: "Method not allowed" }, 405);
        const event = await readJSON(request, 2048);
        if (
          !UUID.test(event.id) ||
          !["participants", "observations", "contributions", "groups"].includes(event.metric) ||
          !Number.isInteger(event.n) ||
          event.n < 1 ||
          event.n > 5 ||
          event.epoch !== scope.epoch
        )
          return json({ error: "Invalid counter event or expired counter epoch." }, 400);
        return json({ ...(await db.bump(scope, event)), epoch: scope.epoch });
      }
      if (path === "/api/public/images" && method === "GET") {
        const rows = await db.images(scope),
          seen = new Set();
        return json({
          images: rows
            .filter((row) => {
              if (seen.has(row.payload.storyId)) return false;
              seen.add(row.payload.storyId);
              return true;
            })
            .map((row) => ({ id: row.id, ...row.payload })),
        });
      }
      if (path === "/api/public/submissions" && method === "POST") {
        const body = await readJSON(request);
        if (body.website) return json({ error: "Submission rejected." }, 400);
        if (!UUID.test(body.id)) return json({ error: "A submission ID is required." }, 400);
        let payload;
        try {
          if (body.kind === "image") {
            const { id, savedAt, ...clean } = imageContribution(
              body.payload,
              catalog.stories.map((s) => s.id),
            );
            payload = clean;
          } else if (body.kind === "story") {
            const { id, savedAt, ...clean } = storySuggestion(
              body.payload,
              network.stations.map((s) => s.id),
            );
            payload = clean;
          } else if (body.kind === "wording") {
            payload = await validatePacket(body.payload);
            if (
              payload.testSession !== null ||
              !catalog.stories.some((s) => s.id === payload.storyId)
            )
              throw new Error("Practice contributions cannot be sent to the live inbox.");
          } else throw new Error("Choose an image, story idea or wording contribution.");
        } catch (error) {
          return json({ error: error.message }, 400);
        }
        const row = await db.insert(scope, { id: body.id, kind: body.kind, payload });
        return json({ id: row.id, status: row.status || "pending" }, 202);
      }
      if (path.startsWith("/api/admin/")) {
        if (!authenticated(request, env))
          return json({ error: "Sign in to the reviewer desk." }, 401);
        if (path === "/api/admin/session" && method === "GET")
          return json({ authenticated: true, epoch: scope.epoch, namespace: scope.namespace });
        if (path === "/api/admin/logout" && method === "POST")
          return json({ authenticated: false }, 200, {
            "Set-Cookie": sessionCookie(request, env, true),
          });
        if (path === "/api/admin/submissions" && method === "GET") {
          const status = url.searchParams.get("status"),
            kind = url.searchParams.get("kind"),
            page = Number(url.searchParams.get("page") || 0);
          if (
            (status && !["pending", "approved", "declined"].includes(status)) ||
            (kind && !["image", "story", "wording"].includes(kind)) ||
            !Number.isInteger(page) ||
            page < 0 ||
            page > 10000
          )
            return json({ error: "Invalid inbox filter" }, 400);
          const rows = await db.list(scope, { status, kind, offset: page * 50 });
          return json({ items: rows.slice(0, 50), hasMore: rows.length > 50, page });
        }
        if (path === "/api/admin/submissions" && method === "PATCH") {
          const body = await readJSON(request, 4096);
          if (
            !UUID.test(body.id) ||
            !["pending", "approved", "declined"].includes(body.status) ||
            !Number.isInteger(body.version) ||
            body.version < 0 ||
            typeof body.note !== "string" ||
            body.note.length > 1000
          )
            return json({ error: "Invalid review decision." }, 400);
          const row = await db.review(scope, body);
          return json({ id: row.id, status: row.status });
        }
        if (path === "/api/admin/counter" && method === "GET")
          return json({ ...(await db.counts(scope)), epoch: scope.epoch });
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      if (!error.status) console.error("[Safar API]", error.message);
      return failure(error);
    }
  };
}
export default createApi();
export const config = {
  path: "/api/*",
  excludedPath: "/api/admin/login",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip", "domain"],
    windowSize: 60,
    windowLimit: 120,
  },
};
