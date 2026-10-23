import {
  configuredAuth,
  passwordMatches,
  requireOrigin,
  readJSON,
  sessionCookie,
  json,
  failure,
} from "./lib/security.mjs";
export function createLogin(env = process.env) {
  return async (request) => {
    try {
      // The canonical route carries the Netlify login rate limit; reject aliases.
      if (new URL(request.url).pathname !== "/api/admin/login")
        return json({ error: "Not found" }, 404);
      if (request.method !== "POST")
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      requireOrigin(request);
      if (!configuredAuth(env))
        return json(
          {
            error:
              "Reviewer login is not configured. Set the server environment variables in Netlify.",
          },
          503,
        );
      const body = await readJSON(request, 2048);
      if (!passwordMatches(body.password, env))
        return json({ error: "Incorrect reviewer password." }, 401);
      return json({ authenticated: true }, 200, { "Set-Cookie": sessionCookie(request, env) });
    } catch (error) {
      return failure(error);
    }
  };
}
export default createLogin();
export const config = {
  path: "/api/admin/login",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: ["ip", "domain"],
    windowSize: 60,
    windowLimit: 5,
  },
};
