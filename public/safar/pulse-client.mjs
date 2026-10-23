const metrics = ["participants", "observations", "contributions", "groups"];
export function createPulseReporter({
  storage,
  key,
  getLocal,
  getInitial,
  fetcher = fetch,
  onTotals = () => {},
}) {
  let busy = false;
  return async function sync() {
    if (busy) return;
    busy = true;
    try {
      const response = await fetcher("/api/public/pulse", { cache: "no-store" });
      if (!response.ok) return;
      const totals = await response.json();
      if (typeof totals.epoch !== "string") return;
      let saved;
      try {
        saved = JSON.parse(storage.getItem(key));
      } catch {
        /* Keep a corrupt sync checkpoint from causing page errors. */
      }
      const valid =
        saved &&
        typeof saved.epoch === "string" &&
        saved.reported &&
        metrics.every(
          (metric) => Number.isSafeInteger(saved.reported[metric]) && saved.reported[metric] >= 0,
        );
      if (!valid || saved.epoch !== totals.epoch) {
        saved = {
          epoch: totals.epoch,
          reported: { ...(valid ? getLocal() : getInitial()) },
          baseline: { ...(valid ? getLocal() : getInitial()) },
          pending: null,
        };
        storage.setItem(key, JSON.stringify(saved));
      }
      saved.baseline ||= { ...saved.reported };
      onTotals(totals, saved);
      for (const metric of metrics) {
        while ((getLocal()[metric] || 0) > (saved.reported[metric] || 0)) {
          const n = Math.min(5, getLocal()[metric] - (saved.reported[metric] || 0));
          if (!saved.pending) saved.pending = { id: crypto.randomUUID(), metric, n };
          const event = saved.pending;
          // A failed response must retry the same ID, even after a reload.
          storage.setItem(key, JSON.stringify(saved));
          const sent = await fetcher("/api/public/pulse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...event, epoch: saved.epoch }),
          });
          if (!sent.ok) return;
          const updated = await sent.json();
          saved.reported[event.metric] = (saved.reported[event.metric] || 0) + event.n;
          saved.pending = null;
          storage.setItem(key, JSON.stringify(saved));
          onTotals(updated, saved);
        }
      }
    } finally {
      busy = false;
    }
  };
}
