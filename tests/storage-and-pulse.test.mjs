import test from "node:test";
import assert from "node:assert/strict";
import { createSafeStorage } from "../public/safar/safe-storage.mjs";
import { createPulseReporter } from "../public/safar/pulse-client.mjs";

test("blocked localStorage getter keeps drafts usable in memory without throwing", () => {
  let warnings = 0;
  const store = createSafeStorage(
    () => {
      throw new DOMException("Access denied", "SecurityError");
    },
    () => warnings++,
  );
  assert.equal(store.getItem("draft"), null);
  assert.equal(store.setItem("draft", "saved"), false);
  assert.equal(store.getItem("draft"), "saved");
  assert.equal(store.persistent, false);
  assert.equal(warnings, 1);
  store.removeItem("draft");
  assert.equal(store.getItem("draft"), null);
});
test("quota failure keeps the latest draft and previously read values", () => {
  const store = createSafeStorage(() => ({
    getItem: () => "old",
    setItem: () => {
      throw new Error("quota");
    },
  }));
  assert.equal(store.getItem("a"), "old");
  store.setItem("b", "new");
  assert.equal(store.getItem("a"), "old");
  assert.equal(store.getItem("b"), "new");
});
test("counter ignores old notebook totals and deduplicates a lost response retry", async () => {
  const storage = createSafeStorage(() => {
    throw new Error("blocked");
  });
  let current = { participants: 8, observations: 0, contributions: 0, groups: 0 };
  let totals = { participants: 0, observations: 0, contributions: 0, groups: 0 };
  let epoch = "launch-v1",
    lose = true;
  const events = new Set(),
    requests = [];
  const fetcher = async (url, options = {}) => {
    if (options.method === "POST") {
      const event = JSON.parse(options.body);
      requests.push(event);
      if (!events.has(event.id)) {
        events.add(event.id);
        totals[event.metric] += event.n;
      }
      if (lose) {
        lose = false;
        throw new Error("response lost");
      }
    }
    return Response.json({ ...totals, epoch });
  };
  const initial = { ...current };
  const sync = createPulseReporter({
    storage,
    key: "counter",
    getLocal: () => current,
    getInitial: () => initial,
    fetcher,
  });
  await sync();
  assert.equal(requests.length, 0);
  current = { ...current, participants: 9 };
  await assert.rejects(sync(), /response lost/);
  await sync();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].id, requests[1].id);
  assert.equal(totals.participants, 1);
  await sync();
  assert.equal(requests.length, 2);
  epoch = "new-launch";
  totals = { participants: 0, observations: 0, contributions: 0, groups: 0 };
  await sync();
  assert.equal(totals.participants, 0);
  current = { ...current, participants: 10 };
  await sync();
  assert.equal(totals.participants, 1);
});
