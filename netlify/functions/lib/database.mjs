export function database(env, fetcher = fetch) {
  async function request(path, { method = "GET", body, prefer } = {}) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
      throw new Error("Database not configured");
    const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" };
    if (!env.SUPABASE_SERVICE_ROLE_KEY.startsWith("sb_"))
      headers.Authorization = `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`;
    if (prefer) headers.Prefer = prefer;
    const response = await fetcher(`${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Database request failed (${response.status})`);
    return response.status === 204 ? null : response.json();
  }
  const query = (params) => new URLSearchParams(params).toString();
  return {
    async counts({ namespace, epoch }) {
      const rows = await request(
        `safar_live_counts?${query({ namespace: `eq.${namespace}`, epoch: `eq.${epoch}`, select: "metric,value" })}`,
      );
      return Object.fromEntries(
        ["participants", "observations", "contributions", "groups"].map((metric) => [
          metric,
          Number(rows.find((row) => row.metric === metric)?.value || 0),
        ]),
      );
    },
    bump(scope, event) {
      return request("rpc/safar_record_pulse", {
        method: "POST",
        body: {
          p_namespace: scope.namespace,
          p_epoch: scope.epoch,
          p_id: event.id,
          p_metric: event.metric,
          p_n: event.n,
        },
      });
    },
    async insert(scope, item) {
      const rows = await request("safar_submissions?on_conflict=namespace,id", {
        method: "POST",
        body: { namespace: scope.namespace, ...item },
        prefer: "resolution=ignore-duplicates,return=representation",
      });
      if (rows.length) return rows[0];
      const existing = await request(
        `safar_submissions?${query({ namespace: `eq.${scope.namespace}`, id: `eq.${item.id}`, select: "id,kind,payload,status,version" })}`,
      );
      if (
        !existing[0] ||
        existing[0].kind !== item.kind ||
        JSON.stringify(existing[0].payload) !== JSON.stringify(item.payload)
      ) {
        // Postgres JSONB key order differs; compare canonical keys recursively.
        const stable = (value) =>
          Array.isArray(value)
            ? value.map(stable)
            : value && typeof value === "object"
              ? Object.fromEntries(
                  Object.keys(value)
                    .sort()
                    .map((key) => [key, stable(value[key])]),
                )
              : value;
        if (
          !existing[0] ||
          existing[0].kind !== item.kind ||
          JSON.stringify(stable(existing[0].payload)) !== JSON.stringify(stable(item.payload))
        )
          throw Object.assign(
            new Error("This submission ID is already in use. Save a new draft."),
            { status: 409 },
          );
      }
      return existing[0];
    },
    list(scope, { status, kind, offset = 0 } = {}) {
      return request(
        `safar_submissions?${query({ namespace: `eq.${scope.namespace}`, select: "id,kind,payload,status,review_note,created_at,reviewed_at,version", order: "created_at.desc,id.desc", limit: "51", offset: String(offset), ...(status ? { status: `eq.${status}` } : {}), ...(kind ? { kind: `eq.${kind}` } : {}) })}`,
      );
    },
    images(scope) {
      return request(
        `safar_submissions?${query({ namespace: `eq.${scope.namespace}`, kind: "eq.image", status: "eq.approved", select: "id,payload,reviewed_at", order: "reviewed_at.desc", limit: "500" })}`,
      );
    },
    async review(scope, item) {
      const rows = await request(
        `safar_submissions?${query({ namespace: `eq.${scope.namespace}`, id: `eq.${item.id}`, version: `eq.${item.version}` })}`,
        {
          method: "PATCH",
          body: {
            status: item.status,
            review_note: item.note,
            reviewed_at: new Date().toISOString(),
            version: item.version + 1,
          },
          prefer: "return=representation",
        },
      );
      if (!rows.length)
        throw Object.assign(
          new Error("This item changed. Refresh the inbox before reviewing it."),
          { status: 409 },
        );
      return rows[0];
    },
  };
}
