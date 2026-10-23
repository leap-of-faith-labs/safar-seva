// Contributions are a separate local experiment; never rewrite the ride ledger.
export const experimentKey = (session) => `safar-seva:story-experiments:${session || "local"}:v1`;
export function webURL(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error("Use a complete https:// web link.");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Use an HTTPS link without login details.");
  return url.href;
}
function text(value, max, label) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Error(`${label} is required (up to ${max} characters).`);
  return value.trim();
}
export function imageContribution(values, storyIds) {
  if (!storyIds.includes(values.storyId)) throw new Error("Choose an available story.");
  return {
    id: /^[0-9a-f-]{36}$/i.test(values.id || "") ? values.id : crypto.randomUUID(),
    storyId: values.storyId,
    imageURL: webURL(values.imageURL),
    sourceURL: webURL(values.sourceURL),
    credit: text(values.credit, 160, "Image credit"),
    caption: text(values.caption, 240, "Image description"),
    savedAt: new Date().toISOString(),
  };
}
export function storySuggestion(values, stationIds) {
  if (!stationIds.includes(values.stationId)) throw new Error("Choose a station along the line.");
  return {
    id: crypto.randomUUID(),
    title: text(values.title, 160, "Story title"),
    stationId: values.stationId,
    summary: text(values.summary, 2000, "Story idea"),
    sourceURL: values.sourceURL?.trim() ? webURL(values.sourceURL) : "",
    savedAt: new Date().toISOString(),
  };
}
export function parseExperiments(raw) {
  if (raw === null) return { schemaVersion: 1, images: [], suggestions: [] };
  const data = JSON.parse(raw);
  if (data?.schemaVersion !== 1 || !Array.isArray(data.images) || !Array.isArray(data.suggestions))
    throw new Error("Saved experiments could not be read. They have been left unchanged.");
  for (const item of data.images) {
    imageContribution(item, [item.storyId]);
    if (
      !item.storyId ||
      typeof item.savedAt !== "string" ||
      !Number.isFinite(Date.parse(item.savedAt))
    )
      throw new Error("Invalid saved image.");
  }
  for (const item of data.suggestions) {
    if (
      !item?.id ||
      typeof item.id !== "string" ||
      typeof item.stationId !== "string" ||
      !item.stationId
    )
      throw new Error("Invalid saved suggestion.");
    text(item.title, 160, "Story title");
    text(item.summary, 2000, "Story idea");
    if (item.sourceURL) webURL(item.sourceURL);
    if (!Number.isFinite(Date.parse(item.savedAt)))
      throw new Error("Invalid saved suggestion date.");
  }
  return data;
}
