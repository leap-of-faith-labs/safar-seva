# Handoff: Safar Seva reviewer login remains unconfigured

## User-visible failure

The deployed reviewer page still shows:

> Reviewer login is not configured. Set the server environment variables in Netlify.

The user has already added variables in Netlify and redeployed, but the error remains.

## Repository

- GitHub: https://github.com/leap-of-faith-labs/safar-seva
- Branch: `main`
- Latest known commit: `29d12dc2561ce43240c2f441b910aaa430092875`
- Netlify app source directory: repository root (`netlify.toml` is at root)
- Reviewer page: `/safar/admin.html` and `/admin.html`
- Canonical login endpoint: `/api/admin/login`

## Relevant implementation

`netlify/functions/admin-login.mjs` calls `configuredAuth(env)` before accepting a login. The function returns the 503 error unless both conditions are true:

```text
SAFAR_ADMIN_PASSWORD: string, at least 16 characters, must not begin with SET_
SAFAR_SESSION_SECRET: string, at least 32 characters, must not begin with SET_
```

The required check is in `netlify/functions/lib/security.mjs`.

## Most likely causes to verify

1. Variables were added to a different Netlify site than `leap-of-faith-labs/safar-seva`.
2. Variables were added only for Build scope. They must include **Functions** scope.
3. Variables were added to a non-production deploy context while the user is opening the production URL, or vice versa.
4. The names contain whitespace, quotes, or a typo. They must be exactly the names above.
5. The values still begin with `SET_`, are shorter than the required length, or were pasted with surrounding quotes.
6. Netlify has not created a new deploy after the variables were saved.
7. The site is deploying a stale branch or a different repository/base directory.
8. A direct function URL or old alias is being used instead of `/api/admin/login`.

## Required checks

In Netlify, confirm all of the following:

- Site is the one connected to `leap-of-faith-labs/safar-seva`.
- Production deploy commit is `29d12dc` or newer.
- Environment variables are present under the site, with **Functions** scope and **Production** context.
- A fresh production deploy was triggered after saving them.
- Function logs for `admin-login` show the current deploy and no environment/configuration error.
- Browser request is `POST https://<site>/api/admin/login`, not `/.netlify/functions/admin-login`.

Do not print or expose the secret values in logs, screenshots, commits, or chat.

## Expected values

Use a real reviewer password of 16+ characters and a separate random session secret of 32+ characters. Example generation command:

```sh
openssl rand -hex 32
```

The `netlify.env.example` file contains placeholders only and must not be uploaded as the actual secret configuration.

## Important distinction

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are required for submissions, counters, and the reviewer inbox data. They are not what enables the login configuration check itself. First fix the two `SAFAR_*` authentication variables, then verify Supabase variables and the production SQL migration separately.

## Safe debugging suggestion

Add a temporary server-side diagnostic that reports only booleans and lengths, never values, for the two auth variables; or inspect the Netlify Function environment through Netlify's own configuration/logging tools. Remove any diagnostic before production use. Do not weaken `configuredAuth`, expose secrets to the browser, or put credentials in the repository.

## Relevant docs

- `NETLIFY-LAUNCH.md`, section “Set server environment variables”
- `netlify.env.example`
- `netlify/functions/admin-login.mjs`
- `netlify/functions/lib/security.mjs`
- `netlify.toml`
