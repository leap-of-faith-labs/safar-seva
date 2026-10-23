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
- Safar Seva static app lives in public/safar/ (authored source, plain HTML/JS); / redirects there. Keep it static except one anonymous season counter: no accounts, analytics or personal data.
- Lightweight rides use lightweight.mjs to assemble three activities on the existing validated ledger schema; retain legacy results without rewriting them.
- Ride invitations use allowlisted station/story identifiers in a URL fragment and locally generated QR codes; never serialize records or imply live synchronization.
- Vendor browser dependencies locally and include new app modules in assets.js with a release bump so offline installations update together.
- Decorative stamp impressions live on the existing ride.stamp and are handled by stamps.mjs; they never increase participation totals, preserving ledger semantics and old awards.
- Season totals come from /api/public/pulse (four allowlisted counters, +1..5 bumps via a service-role-only DB function); the app reports only its own unreported local deltas and falls back to baseline + local offline.
- Stations form a multi-line network (stations.json `lines`; linkStations + BFS in core.mjs); routes may change lines at interchanges. Why: Aqua, Purple and Hinjewadi lines share stations.
