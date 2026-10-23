# Safar Seva: Netlify launch

This setup serves the static Safar app on Netlify, uses Netlify Functions for submissions and reviewer login, and stores shared data in Supabase. No server key or reviewer password is included in the public site.

The site is prepared locally. A live deployment still requires your Netlify project, Supabase project, the SQL setup below, and the server environment variables.

## 1. Prepare the database

Use your existing Supabase project, or create a separate project for the live pilot. In its SQL Editor, run [`supabase/production-setup.sql`](supabase/production-setup.sql) once.

The script creates:

- `safar_submissions`: image links, story ideas and explicitly submitted wording, plus reviewer decisions.
- `safar_live_counts`: four participation totals, separated by launch epoch.
- `safar_count_events`: random event IDs that prevent retries from counting twice.
- `safar_record_pulse`: the atomic counter function.

All three tables have Row Level Security enabled and no public read/write grants. Only the server service role can access them. The public API exposes aggregate totals and approved image links. Private drafts, review notes and the inbox require reviewer login. This follows Supabase's [grants and RLS guidance](https://supabase.com/docs/guides/api/securing-your-api).

This script does **not** import the earlier demo counters or delete an existing pilot. It is safe to re-run without resetting live totals.

## 2. Create the Netlify project

You can connect this repository to Netlify, or extract `safar-netlify-ready.zip` and deploy its contents with the CLI. Choose a custom/static framework if Netlify asks; this deployment does not need a TanStack or Cloudflare adapter.

The included `netlify.toml` sets:

| Setting | Value |
| --- | --- |
| Build command | `npm run build:netlify` |
| Publish directory | `dist/netlify` |
| Functions directory | `netlify/functions` |
| Node version | 22 |

If you connected a larger repository, set Netlify's base directory to the folder containing this project's `netlify.toml`.

Do not use the ordinary `npm run build` output for this target. That remains the original Lovable/TanStack build; `build:netlify` prepares the static app and the separate Functions setup.

## 3. Set server environment variables

In the Netlify project's environment-variable settings, add these values with the **Functions** scope. Use separate production and preview values if desired. Do not prefix these names with `VITE_`, and do not paste their values into public files.

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | Your Supabase project URL, such as `https://PROJECT.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | The server service-role key or server secret key for that project |
| `SAFAR_ADMIN_PASSWORD` | A new, strong reviewer password of at least 16 characters |
| `SAFAR_SESSION_SECRET` | A separate random secret of at least 32 characters |
| `SAFAR_DATA_NAMESPACE` | `safar-seva-live` or another stable name for this pilot |
| `SAFAR_COUNTER_EPOCH` | `launch-2026-10-24` or another fresh launch name |
| `SAFAR_RESET_COUNTER_ON_DEPLOY` | `false` to keep totals through site updates; `true` to start a new counter for every published production deployment |

Generate the password and signing secret independently with a password manager or `openssl rand -hex 32`. Keep them in Netlify's secret settings and your password manager, not in the repository.

Netlify's [function environment documentation](https://docs.netlify.com/build/functions/environment-variables/) explains scopes and redeploying after a variable changes. Variables placed only in `netlify.toml` are not available as function secrets.

## 4. Launch with zero counters

A fresh namespace and counter epoch return **0 for all four totals**. The old sample values (148 / 92 / 54 / 36) are not used. Existing notebooks are not replayed into a newly initialized counter; subsequent activity is reported with retry-safe event IDs.

Choose the reset policy:

- **Zero on first launch, keep totals on later releases:** set `SAFAR_RESET_COUNTER_ON_DEPLOY=false` and keep the same namespace and epoch.
- **Zero on every production deployment:** set `SAFAR_RESET_COUNTER_ON_DEPLOY=true`. The Netlify deployment ID becomes the counter epoch. Submission data is retained. A rollback returns to that older deployment's counter epoch.
- **Start a new pilot later:** change `SAFAR_COUNTER_EPOCH` to a new value and redeploy, keeping automatic resets off. This preserves prior counter rows and all submitted work.

Previews have a separate data namespace and cannot alter the production inbox or totals. No destructive database reset runs during a build.

## 5. Deploy

With Git connected, publish the branch containing this setup after adding the environment variables. Netlify reads `netlify.toml` automatically.

For a manual CLI upload, run these from the extracted package/project root:

```sh
npx netlify-cli login
npx netlify-cli init
```

Configure the environment variables in the newly linked Netlify project, then run:

```sh
npx netlify-cli deploy --build
```

Check the preview, then publish:

```sh
npx netlify-cli deploy --build --prod
```

Use the [Netlify CLI workflow](https://docs.netlify.com/api-and-cli-guides/cli-guides/get-started-with-cli/) for Functions deployments. Dragging only an HTML folder into Netlify Drop does not provide this backend; use the Git or CLI workflow to deploy both the site and Functions.

## 6. Check the live site

1. Open `/safar/index.html`. Before any new activity, all live totals should be zero.
2. Open `/api/public/pulse`. It should return the four numbers and an `epoch`, without an error.
3. Open `/safar/stories.html` in a fresh browser session. Send a story idea and an image URL with its source and credit.
4. Open `/admin` or `/safar/admin.html`. Sign in with the configured reviewer password. The two submissions should appear under Pending.
5. Approve the image. A fresh browser should now see it on that story. Declining an approved image removes it from the public image feed.
6. Accept or decline the story idea. Accepting an idea records the editorial decision; it does **not** automatically publish an unverified story. Add sourced Marathi and English story text to `stories.json` for a later editorial release.
7. Complete one ride. The completed-ride counter should rise once. Reloading or pressing a decorative stamp must not count another ride.
8. Sign out of the reviewer desk. `/api/admin/submissions` must return `401` when signed out.
9. Load the rider app once online, then test it offline. Drafts and rides remain usable; online submissions retry only when requested. Web images need a connection.

## Reviewer workflow

The reviewer desk has status/type filters, pagination, private notes, approve/decline actions and a JSON download of the current inbox page. Authentication uses a signed, expiring HttpOnly cookie; it does not depend on localStorage. Login has a stricter Netlify rate limit than public requests.

Approving an image publishes its link, caption, source and credit. Accepting a story idea or wording draft marks it for editorial work; it does not rewrite the public story automatically. The original file-based story editor remains available at `/safar/review.html` for the earlier wording-review workflow.

The live image experiment accepts web image **links**, not binary uploads. It keeps attribution but does not host a copy of external media. Contributors can remove a local draft; that does not withdraw a copy already sent to the reviewer. Reviewers can decline a submitted image to remove it from the public feed.

## Browser storage and offline behaviour

Some embedded and private browsers deny the `localStorage` getter itself. The app now keeps work in memory for that tab and shows a clear notice. Image and story submissions still work online. Download work before closing a tab when storage is blocked; a tab-only draft cannot survive a reload. The reviewer desk uses cookies, so open the site directly if the embedded browser also blocks sign-in cookies.

Only aggregate counts and explicitly submitted contributions reach the server. Rider notebooks, detailed station observations and journey history are not uploaded. Totals are anonymous reports of rides, choices, notes and invitation actions; they are not verified unique people or live station conditions.

## Local checks and maintenance

```sh
npm test
npm run test:static
npm run build:netlify
npm run dev:netlify
```

`dev:netlify` serves the site and the same API handlers at `http://127.0.0.1:4190`. Configure server values in a private `.env` only for local testing. Without database credentials, the service returns a clear unavailable response; drafts still work. Development uses a separate data namespace.

If submissions return 503, check the Functions environment scopes, run the SQL setup, and inspect Netlify Function logs. If the SQL REST schema is stale, the setup script already ends with a PostgREST schema reload notification. No service-role key should be visible in browser requests or published static files.

Keep the same signing secret across routine updates. Rotate `SAFAR_SESSION_SECRET` to invalidate every reviewer session, and change the reviewer password when reviewer access changes. Keep Supabase backups and define a retention policy for submitted drafts before a longer public rollout. Rate limits and validation reduce casual abuse; anonymous counters remain approximate.

The launch was tested locally with simulated database responses, including blocked storage, submission/approval, cookie login/logout, retry deduplication and zero totals. The actual Supabase migration and Netlify production connection still need to be verified after you configure those accounts.
