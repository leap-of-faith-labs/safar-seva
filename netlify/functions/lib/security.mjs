import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
  });
}
export function requireOrigin(request) {
  const origin = request.headers.get("origin");
  if (
    origin !== new URL(request.url).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw Object.assign(new Error("Open the site directly to submit this request."), {
      status: 403,
    });
}
export async function readJSON(request, max = 16000) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw Object.assign(new Error("Send JSON."), { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error("Missing request body."), { status: 400 });
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw Object.assign(new Error("Request is too large."), { status: 413 });
    }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || Array.isArray(value) || typeof value !== "object")
      throw new Error("object required");
    return value;
  } catch {
    throw Object.assign(new Error("Invalid JSON."), { status: 400 });
  }
}
export function configuredAuth(env) {
  return (
    typeof env.SAFAR_ADMIN_PASSWORD === "string" &&
    env.SAFAR_ADMIN_PASSWORD.length >= 16 &&
    !env.SAFAR_ADMIN_PASSWORD.startsWith("SET_") &&
    typeof env.SAFAR_SESSION_SECRET === "string" &&
    env.SAFAR_SESSION_SECRET.length >= 32 &&
    !env.SAFAR_SESSION_SECRET.startsWith("SET_")
  );
}
export function passwordMatches(value, env) {
  if (!configuredAuth(env) || typeof value !== "string") return false;
  return timingSafeEqual(
    createHash("sha256").update(value).digest(),
    createHash("sha256").update(env.SAFAR_ADMIN_PASSWORD).digest(),
  );
}
const signature = (token, env) =>
  createHmac("sha256", env.SAFAR_SESSION_SECRET).update(token).digest("base64url");
export function sessionCookie(request, env, logout = false) {
  const token = Buffer.from(
    JSON.stringify({
      exp: Date.now() + 8 * 60 * 60 * 1000,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  const value = logout ? "" : `${token}.${signature(token, env)}`;
  return `safar_admin=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${logout ? 0 : 28800}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export function authenticated(request, env) {
  if (!configuredAuth(env)) return false;
  try {
    const value = request.headers
      .get("cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("safar_admin="))
      ?.slice(12);
    const [token, sig] = value.split(".");
    const expected = signature(token, env);
    if (
      !sig ||
      sig.length !== expected.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    )
      return false;
    const payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    return (
      Number.isFinite(payload.exp) &&
      payload.exp > Date.now() &&
      payload.exp <= Date.now() + 8 * 60 * 60 * 1000
    );
  } catch {
    return false;
  }
}
export function failure(error) {
  return json(
    { error: error.status ? error.message : "The service is unavailable. Please try again later." },
    error.status || 503,
  );
}
export function deploymentScope(env, context = {}) {
  const base = env.SAFAR_DATA_NAMESPACE || "safar-seva";
  const production =
    context.deploy?.context === "production" && context.deploy?.published !== false;
  const local = !context.deploy;
  const namespace = production
    ? base
    : `${base}:${local ? "development" : `preview:${context.deploy.id}`}`;
  const epoch =
    env.SAFAR_RESET_COUNTER_ON_DEPLOY === "true" && production
      ? context.deploy.id
      : env.SAFAR_COUNTER_EPOCH || "launch-v1";
  return { namespace, epoch };
}
