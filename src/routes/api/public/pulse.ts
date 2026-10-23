import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Anonymous season totals: only four allowlisted counters, small integer bumps, no identifiers stored.
const METRICS = ["participants", "observations", "contributions", "groups"] as const;
const Bump = z.object({ metric: z.enum(METRICS), n: z.number().int().min(1).max(5) });
const headers = { "Cache-Control": "no-store" };

async function totals() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.from("pulse_counts").select("metric,value");
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((row) => [row.metric, Number(row.value)]));
}

export const Route = createFileRoute("/api/public/pulse")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return Response.json(await totals(), { headers });
        } catch {
          return Response.json({ error: "unavailable" }, { status: 503, headers });
        }
      },
      POST: async ({ request }) => {
        const parsed = Bump.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400, headers });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.rpc("bump_pulse", { p_metric: parsed.data.metric, p_n: parsed.data.n });
        if (error) return Response.json({ error: "unavailable" }, { status: 503, headers });
        return Response.json(await totals(), { headers });
      },
    },
  },
});
