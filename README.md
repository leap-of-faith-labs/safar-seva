# Safar Seva · सफर सेवा

A Marathi-first Pune Metro pilot by Leap of Faith Labs. Travellers learn a Pune story, give a thought and notice something along their ride. The rider app works offline and keeps notebooks on the device.

The site includes a collapsible route menu, a floating participation stamp, a separate story shelf, image and story-idea submissions, and a protected reviewer inbox.

## Run locally

Use Node.js 22 or later. The static app and Netlify API handlers run without installing frontend dependencies:

```sh
npm run dev:netlify
```

Open `http://127.0.0.1:4190/safar/index.html`. Server features need the private environment values described in [NETLIFY-LAUNCH.md](NETLIFY-LAUNCH.md); drafts remain usable when the service is unavailable.

The original Lovable/TanStack development shell is also retained. Install its dependencies with `bun install --frozen-lockfile`, then run `npm run dev`.

## Deploy on Netlify

Follow [NETLIFY-LAUNCH.md](NETLIFY-LAUNCH.md) for the Supabase SQL setup, server environment variables, zero-start live counter and reviewer login.

| Setting | Value |
| --- | --- |
| Build command | `npm run build:netlify` |
| Publish directory | `dist/netlify` |
| Functions directory | `netlify/functions` |

Use Git-connected deployment or Netlify CLI so the API functions deploy with the site. `npm run package:netlify` creates a source deployment ZIP without credentials.

New launch counters start at zero. Totals persist through updates by default; the launch guide also covers resetting on each production deployment. Preview and development submissions are separated from production.

## Checks

```sh
npm run test:static
npm run build:netlify
```

With frontend dependencies installed, run `npm test` for the Vitest suite. Browser checks cover blocked localStorage, submissions, reviewer login and approval, and counter retry handling using a local simulated database. The real Supabase and Netlify connection must be verified during deployment.

## Project map

- `public/safar/`: authored HTML, JavaScript, styles, local fonts and offline assets.
- `netlify/functions/`: shared submissions, live counters and reviewer authentication.
- `supabase/production-setup.sql`: production database setup; no sample counters are imported.
- `tests/`: static app and API tests.
- `src/`: retained Lovable/TanStack wrapper and its tests.

Browser storage may be blocked in embedded or private browsers. Work then stays in memory for the current tab and can be downloaded or submitted online. Rider notebooks and detailed station observations are not uploaded automatically. Web-image submissions store links and attribution; they do not upload image files. Reviewer approval publishes an image; accepting a story idea records an editorial decision without publishing an unverified story.

Keep Supabase service keys, reviewer passwords and session secrets in server environment variables. Never commit a populated `.env` file or place server credentials in `public/`.
