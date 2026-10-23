import test from "node:test";
import assert from "node:assert/strict";
import {
  webURL,
  imageContribution,
  storySuggestion,
  parseExperiments,
  experimentKey,
} from "../public/safar/story-experiments.mjs";
import { stampAllowance } from "../public/safar/floating-stamp.mjs";

test("web image contributions require HTTPS, a known story and attribution", () => {
  for (const value of [
    "javascript:alert(1)",
    "data:image/png;base64,a",
    "http://example.com/photo.jpg",
    "https://name:password@example.com/photo.jpg",
  ])
    assert.throws(() => webURL(value));
  const values = {
    storyId: "story-vanaz",
    imageURL: "https://example.com/image.jpg",
    sourceURL: "https://example.com/source",
    credit: " Photographer ",
    caption: " Vanaz factory ",
  };
  const image = imageContribution(values, ["story-vanaz"]);
  assert.equal(image.credit, "Photographer");
  assert.equal(image.caption, "Vanaz factory");
  assert.throws(() => imageContribution(values, ["story-other"]));
  assert.throws(() => imageContribution({ ...values, credit: "" }, ["story-vanaz"]));
});
test("story suggestions validate a station and keep drafts separate from the ledger", () => {
  const suggestion = storySuggestion(
    {
      title: " A new Pune story ",
      stationId: "vanaz",
      summary: "An old craft along Paud Road.",
      sourceURL: "",
    },
    ["vanaz"],
  );
  assert.equal(suggestion.title, "A new Pune story");
  assert.equal(suggestion.sourceURL, "");
  assert.ok(suggestion.id);
  assert.ok(suggestion.savedAt);
  assert.throws(() => storySuggestion({ ...suggestion, stationId: "unknown" }, ["vanaz"]));
  assert.notEqual(experimentKey(null), experimentKey("practice"));
  assert.deepEqual(parseExperiments(null), { schemaVersion: 1, images: [], suggestions: [] });
  assert.deepEqual(
    parseExperiments(JSON.stringify({ schemaVersion: 1, images: [], suggestions: [suggestion] }))
      .suggestions,
    [suggestion],
  );
  assert.throws(() => parseExperiments("{bad data"));
  assert.throws(() =>
    parseExperiments(
      JSON.stringify({
        schemaVersion: 1,
        images: [{ storyId: "x", imageURL: "javascript:alert(1)" }],
        suggestions: [],
      }),
    ),
  );
});
test("the floating stamp counts distinct later reads only before the next ride", () => {
  const ride = {
    id: "one",
    createdAt: "2026-10-24T09:00:00Z",
    tasks: [],
    stamp: { awardedAt: "2026-10-24T10:00:00Z", impressions: 0 },
  };
  const next = { id: "two", createdAt: "2026-10-24T12:00:00Z" };
  const reads = [
    { storyId: "before", readAt: "2026-10-24T09:30:00Z" },
    { storyId: "a", readAt: "2026-10-24T11:00:00Z" },
    { storyId: "a", readAt: "2026-10-24T11:10:00Z" },
    { storyId: "after", readAt: "2026-10-24T13:00:00Z" },
  ];
  assert.equal(stampAllowance(ride, [ride, next], reads), 2);
  assert.equal(stampAllowance(undefined, [ride, next], reads), 0);
});
