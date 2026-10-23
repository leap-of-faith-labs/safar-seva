import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../netlify/functions/api.mjs";
import { createLogin } from "../netlify/functions/admin-login.mjs";
import { deploymentScope } from "../netlify/functions/lib/security.mjs";
const env = {
  SAFAR_ADMIN_PASSWORD: "reviewer-test-password-long",
  SAFAR_SESSION_SECRET: "test-session-secret-at-least-thirty-two-characters",
};
const production = { deploy: { context: "production", published: true, id: "deploy-one" } };
function request(path, { method = "GET", body, cookie, origin = "https://safar.example" } = {}) {
  return new Request("https://safar.example" + path, {
    method,
    headers: {
      ...(method === "GET" ? {} : { Origin: origin, "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function fixture() {
  const rows = new Map(),
    counts = { participants: 0, observations: 0, contributions: 0, groups: 0 },
    events = new Set();
  let listCalls = 0;
  const db = {
    counts: async () => ({ ...counts }),
    bump: async (scope, event) => {
      const key = scope.epoch + event.id;
      if (!events.has(key)) {
        events.add(key);
        counts[event.metric] += event.n;
      }
      return { ...counts };
    },
    insert: async (scope, item) => {
      if (!rows.has(item.id))
        rows.set(item.id, {
          ...item,
          status: "pending",
          version: 0,
          created_at: new Date().toISOString(),
        });
      return rows.get(item.id);
    },
    list: async (scope, { status, kind }) => {
      listCalls++;
      return [...rows.values()].filter(
        (row) => (!status || row.status === status) && (!kind || row.kind === kind),
      );
    },
    images: async () =>
      [...rows.values()].filter((row) => row.kind === "image" && row.status === "approved"),
    review: async (scope, item) => {
      const row = rows.get(item.id);
      if (!row || row.version !== item.version)
        throw Object.assign(new Error("changed"), { status: 409 });
      Object.assign(row, {
        status: item.status,
        review_note: item.note,
        version: item.version + 1,
      });
      return row;
    },
  };
  return {
    api: createApi({ env, db }),
    rows,
    get listCalls() {
      return listCalls;
    },
  };
}
async function signIn() {
  const response = await createLogin(env)(
    request("/api/admin/login", { method: "POST", body: { password: env.SAFAR_ADMIN_PASSWORD } }),
  );
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  return cookie.split(";")[0];
}
test("private inbox rejects unauthenticated access and cross-site writes", async () => {
  const f = fixture();
  const denied = await f.api(request("/api/admin/submissions"), production);
  assert.equal(denied.status, 401);
  assert.equal(f.listCalls, 0);
  assert.equal(denied.headers.get("cache-control"), "no-store");
  const cookie = await signIn();
  const cross = await f.api(
    request("/api/admin/submissions", {
      method: "PATCH",
      cookie,
      origin: "https://elsewhere.example",
      body: {},
    }),
    production,
  );
  assert.equal(cross.status, 403);
  const failed = await createLogin(env)(
    request("/api/admin/login", { method: "POST", body: { password: "wrong" } }),
  );
  assert.equal(failed.status, 401);
  assert.equal(failed.headers.get("set-cookie"), null);
  const alias = await createLogin(env)(
    request("/.netlify/functions/admin-login", {
      method: "POST",
      body: { password: env.SAFAR_ADMIN_PASSWORD },
    }),
  );
  assert.equal(alias.status, 404);
});
test("submitted images stay private until an authenticated review approves them", async () => {
  const f = fixture(),
    id = crypto.randomUUID(),
    payload = {
      storyId: "story-vanaz",
      imageURL: "https://example.com/image.jpg",
      sourceURL: "https://example.com/source",
      credit: "Photographer",
      caption: "An image of Pune",
    };
  const submitted = await f.api(
    request("/api/public/submissions", { method: "POST", body: { id, kind: "image", payload } }),
    production,
  );
  assert.equal(submitted.status, 202);
  assert.equal((await submitted.json()).status, "pending");
  assert.deepEqual(await (await f.api(request("/api/public/images"), production)).json(), {
    images: [],
  });
  const cookie = await signIn();
  const inbox = await (
    await f.api(request("/api/admin/submissions", { cookie }), production)
  ).json();
  assert.equal(inbox.items.length, 1);
  assert.equal(inbox.items[0].payload.credit, "Photographer");
  const reviewed = await f.api(
    request("/api/admin/submissions", {
      method: "PATCH",
      cookie,
      body: { id, status: "approved", version: 0, note: "Sources checked" },
    }),
    production,
  );
  assert.equal(reviewed.status, 200);
  const publicData = await (await f.api(request("/api/public/images"), production)).json();
  assert.equal(publicData.images.length, 1);
  assert.equal(publicData.images[0].review_note, undefined);
  const conflict = await f.api(
    request("/api/admin/submissions", {
      method: "PATCH",
      cookie,
      body: { id, status: "declined", version: 0, note: "" },
    }),
    production,
  );
  assert.equal(conflict.status, 409);
});
test("invalid, oversized and cross-origin submissions never enter the inbox", async () => {
  const f = fixture();
  const base = {
    id: crypto.randomUUID(),
    kind: "image",
    payload: { storyId: "unknown", imageURL: "javascript:alert(1)" },
  };
  assert.equal(
    (await f.api(request("/api/public/submissions", { method: "POST", body: base }), production))
      .status,
    400,
  );
  assert.equal(
    (await f.api(request("/api/public/submissions", { method: "POST", body: null }), production))
      .status,
    400,
  );
  assert.equal(
    (
      await f.api(
        request("/api/public/submissions", {
          method: "POST",
          body: { ...base, extra: "x".repeat(20000) },
        }),
        production,
      )
    ).status,
    413,
  );
  assert.equal(f.rows.size, 0);
});
test("counter starts at zero, accepts idempotent events and separates deployment epochs", async () => {
  const f = fixture();
  const initial = await (await f.api(request("/api/public/pulse"), production)).json();
  assert.equal(initial.participants, 0);
  assert.equal(initial.epoch, "launch-v1");
  const event = { id: crypto.randomUUID(), epoch: "launch-v1", metric: "participants", n: 1 };
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await f.api(request("/api/public/pulse", { method: "POST", body: event }), production))
        .status,
      200,
    );
  assert.equal(
    (await (await f.api(request("/api/public/pulse"), production)).json()).participants,
    1,
  );
  assert.equal(
    (
      await f.api(
        request("/api/public/pulse", { method: "POST", body: { ...event, epoch: "old" } }),
        production,
      )
    ).status,
    400,
  );
  assert.equal(
    deploymentScope({ ...env, SAFAR_RESET_COUNTER_ON_DEPLOY: "true" }, production).epoch,
    "deploy-one",
  );
  assert.notEqual(
    deploymentScope(env, { deploy: { context: "deploy-preview", id: "preview-one" } }).namespace,
    deploymentScope(env, production).namespace,
  );
});
