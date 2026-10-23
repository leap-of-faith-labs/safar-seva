<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Safar Seva authored static app lives in public/safar/ (plain HTML/JS); / redirects there. Production Netlify Functions in netlify/functions handle anonymous counters, explicit contributions and a cookie-protected reviewer desk. No rider accounts, analytics or automatic notebook uploads.
- Lightweight rides use lightweight.mjs to assemble three activities on the existing validated ledger schema; retain legacy results without rewriting them.
- Ride invitations use allowlisted station/story identifiers in a URL fragment and locally generated QR codes; never serialize records or imply live synchronization.
- Vendor browser dependencies locally and include new app modules in assets.js with a release bump so offline installations update together.
- Browser storage can deny its getter or writes: use safe-storage.mjs, keep tab-only work usable and label it honestly. Never put Supabase service keys or reviewer passwords in public files.
- Decorative stamp impressions live on the existing ride.stamp and are handled by stamps.mjs; they never increase participation totals, preserving ledger semantics and old awards.
- Live totals use /api/public/pulse with launch epochs and idempotent +1..5 event IDs; safar_record_pulse and safar_live_counts are the Netlify production schema (supabase/production-setup.sql). Old pulse_counts migrations are historical. Never replay existing notebooks into a fresh launch counter.
- Stations form a multi-line network (stations.json `lines`; linkStations + BFS in core.mjs); routes may change lines at interchanges. Why: Aqua, Purple and Hinjewadi lines share stations.
