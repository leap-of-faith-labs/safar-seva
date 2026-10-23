export async function sendSubmission(kind, item, { practice = false, fetcher = fetch } = {}) {
  if (practice)
    throw new Error(
      "Practice drafts stay in this test session and are not sent to the live reviewer inbox.",
    );
  if (!item.id) throw new Error("Save this draft again before submitting.");
  const submissionId = kind === "wording" ? (item.submissionId ||= crypto.randomUUID()) : item.id;
  const response = await fetcher("/api/public/submissions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: submissionId, kind, payload: item, website: "" }),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "Online submission is not configured here. Your draft is kept; download it or retry after the site is deployed.",
    );
  }
  if (!response.ok)
    throw new Error(body.error || "Not sent. Your draft is kept; retry when online.");
  return body;
}
