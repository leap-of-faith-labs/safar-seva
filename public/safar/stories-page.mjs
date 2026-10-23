import "./assets.js";
import { createSafeStorage } from "./safe-storage.mjs";
import { sendSubmission } from "./submission-client.mjs";
import { escapeHTML as e, sourceLinks, downloadJSON, istInput } from "./ui.mjs";
import { parseStoredState } from "./storage.mjs";
import { validateCatalog } from "./contributions.mjs";
import { linkStations } from "./core.mjs";
import { getYatraProgress } from "./journey.mjs";
import { mountFloatingStamp } from "./floating-stamp.mjs";
import { mountRouteSidecar } from "./route-sidecar.mjs";
import {
  experimentKey,
  parseExperiments,
  imageContribution,
  storySuggestion,
} from "./story-experiments.mjs";

const $ = (selector) => document.querySelector(selector);
const localStore = createSafeStorage(
  () => window.localStorage,
  () =>
    warn(
      "Browser storage is unavailable. Drafts stay in this tab; download them before closing. You can still send contributions online.",
    ),
);
const slug = new URLSearchParams(location.search).get("test");
const session = /^[a-z0-9_-]{1,40}$/i.test(slug || "") ? slug : null;
const query = session ? `?test=${encodeURIComponent(session)}` : "";
const legacyKey = session
  ? session === "1"
    ? "safar-seva:test-ledger:v1"
    : `safar-seva:test-ledger:${session}:v1`
  : "safar-seva:ledger:v1";
const ledgerKey = legacyKey.replace(/v1$/, "v2"),
  localKey = experimentKey(session);
let ledger = {
  schemaVersion: 1,
  rides: [],
  currentRideId: null,
  currentTaskId: null,
  forms: {},
  storyReads: [],
};
let experiments = { schemaVersion: 1, images: [], suggestions: [] },
  catalog,
  season,
  stations = [],
  lines = [],
  floatingStamp,
  routeSidecar,
  toastTimer,
  publicImages = [];
const emptyLedger = () => ({
  schemaVersion: 1,
  rides: [],
  currentRideId: null,
  currentTaskId: null,
  forms: {},
  storyReads: [],
});
function warn(message) {
  $("#stories-warning").hidden = false;
  $("#stories-warning").textContent = message;
}
function toast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 5000);
}
function readLedger() {
  const raw = localStore.getItem(ledgerKey) ?? localStore.getItem(legacyKey);
  return raw ? parseStoredState(raw) : emptyLedger();
}
function mutateLedger(change) {
  const latest = readLedger();
  change(latest);
  parseStoredState(JSON.stringify(latest));
  localStore.setItem(ledgerKey, JSON.stringify(latest));
  ledger = latest;
}
function mutateExperiments(change) {
  const latest = parseExperiments(localStore.getItem(localKey));
  change(latest);
  localStore.setItem(localKey, JSON.stringify(latest));
  experiments = latest;
}
const station = (id) => stations.find((item) => item.id === id);
function imageMarkup(story) {
  const image =
    experiments.images.find((item) => item.storyId === story.id) ||
    publicImages.find((item) => item.storyId === story.id);
  return image
    ? `<figure class="contributed-image"><img src="${e(image.imageURL)}" alt="${e(image.caption)}" loading="lazy" referrerpolicy="no-referrer"><p class="image-unavailable" hidden lang="en">This web image is unavailable. Your source and credit are kept below.</p><figcaption><span>${e(image.caption)}</span><a href="${e(image.sourceURL)}" target="_blank" rel="noopener noreferrer" lang="en">${e(image.credit)} ↗</a></figcaption><div class="image-actions">${image.submissionId ? '<span class="submission-status">Sent to reviewer</span>' : publicImages.some((item) => item.id === image.id) ? '<span class="submission-status">Reviewed image</span>' : `<button type="button" data-submit-image="${e(story.id)}">Send to reviewer</button>`}<button type="button" data-add-image="${e(story.id)}">Change image</button>${experiments.images.some((item) => item.storyId === story.id) ? `<button type="button" data-remove-image="${e(story.id)}">Remove draft</button>` : ""}</div></figure>`
    : `<div class="image-placeholder"><span class="image-window" aria-hidden="true">↗</span><p>ही जागा तुमच्या नजरेसाठी.<small lang="en">A picture could begin another story.</small></p><button type="button" class="text-button" data-add-image="${e(story.id)}">＋ इंटरनेटवरचं चित्र जोडा <span lang="en">Add a web image</span></button></div>`;
}
function renderStories() {
  const open = new Set(
    [...document.querySelectorAll(".story-reading[open]")].map(
      (item) => item.closest(".story-card").id,
    ),
  );
  const counted = getYatraProgress(
    ledger.rides,
    season,
    new Date().toISOString(),
    ledger.storyReads || [],
  ).discovered;
  const read = new Set([
    ...(ledger.storyReads || []).map((item) => item.storyId),
    ...ledger.rides.flatMap((ride) =>
      ride.tasks
        .filter((task) => task.kind === "learn" && task.status === "completed")
        .map((task) => task.storyId),
    ),
  ]);
  $("#story-library").innerHTML = catalog.stories
    .map(
      (story, index) =>
        `<article class="story-card" id="${e(story.id)}"><div class="story-image-space">${imageMarkup(story)}</div><div class="story-card-copy"><p class="eyebrow"><span lang="en">${String(index + 1).padStart(2, "0")} /</span> ${e(station(story.station_ids[0])?.name_mr || "")}</p><h2>${e(story.title_mr)}<span lang="en">${e(story.title_en)}</span></h2><details class="story-reading" ${open.has(story.id) || location.hash === "#" + story.id ? "open" : ""}><summary>गोष्ट वाचा <span lang="en">Read the story</span><span aria-hidden="true">＋</span></summary><div class="story-reading-body"><p>${e(story.body_mr)}</p><details class="english"><summary lang="en">English</summary><p lang="en">${e(story.body_en)}</p></details>${sourceLinks(story.sources)}<button class="secondary-button" data-read-story="${e(story.id)}">${read.has(story.id) ? "✓ वाचलं आहे · Read again" : "वाचलं · I’ve read this"}</button><p class="task-hint" lang="en">${counted.includes(story.id) ? "Counted for your Yatra. Reading again adds no extra light." : "Reading is saved on this device. Each story counts once during the season."}</p>${story.appliedContributions.length ? '<p class="badge">Includes a published contribution</p>' : ""}</div></details></div></article>`,
    )
    .join("");
}
function renderSuggestions() {
  $("#saved-suggestions").innerHTML = experiments.suggestions.length
    ? experiments.suggestions
        .map(
          (item) =>
            `<article class="suggestion-card"><p class="eyebrow">${e(station(item.stationId)?.name_mr || item.stationId)} <span lang="en">/ SAVED IDEA</span></p><h3>${e(item.title)}</h3><p class="suggestion-summary">${e(item.summary)}</p>${item.sourceURL ? `<a href="${e(item.sourceURL)}" target="_blank" rel="noopener noreferrer" lang="en">Source ↗</a>` : ""}${item.submissionId ? '<p class="submission-status">Sent to reviewer</p>' : `<button class="secondary-button" type="button" data-submit-suggestion="${e(item.id)}">Send to reviewer ↗</button>`}<button class="text-button" type="button" data-remove-suggestion="${e(item.id)}" lang="en">Remove idea</button></article>`,
        )
        .join("")
    : '<p class="suggestion-empty">पुढची गोष्ट तुमच्याकडून.<span lang="en">A familiar landmark? A forgotten craft? Keep your first story idea here.</span></p>';
  $("#download-experiments").disabled =
    !experiments.images.length && !experiments.suggestions.length;
}
function render() {
  renderStories();
  renderSuggestions();
  floatingStamp?.render();
  routeSidecar?.render(
    ledger.rides.find((ride) => ride.id === ledger.currentRideId),
    stations,
    lines,
    catalog,
  );
}
async function submitDraft(kind, id) {
  const group = kind === "image" ? "images" : "suggestions";
  const item = experiments[group].find((item) => item.id === id);
  if (!item) return;
  try {
    const result = await sendSubmission(kind, item, { practice: Boolean(session) });
    mutateExperiments((data) => {
      const draft = data[group].find((item) => item.id === id);
      if (draft) draft.submissionId = result.id;
    });
    toast("योगदान पाठवलं · Sent to the reviewer. It will appear publicly only after review.");
  } catch (error) {
    toast(
      `${localStore.persistent ? "Draft saved." : "Draft kept in this tab; download before closing."} ${error.message}`,
    );
  }
  render();
}
function openImage(id) {
  const story = catalog.stories.find((item) => item.id === id);
  if (!story) return;
  const form = $("#image-form");
  form.reset();
  form.querySelector(".field-error").textContent = "";
  form.elements.storyId.value = id;
  $("#image-story-title").textContent = story.title_en;
  const image = experiments.images.find((item) => item.storyId === id);
  if (image)
    for (const field of ["imageURL", "sourceURL", "credit", "caption"])
      form.elements[field].value = image[field];
  $("#image-dialog").showModal();
}
function openSuggestion() {
  $("#suggestion-form").querySelector(".field-error").textContent = "";
  $("#suggestion-dialog").showModal();
}
function openHash() {
  let id;
  try {
    id = decodeURIComponent(location.hash.slice(1));
  } catch {
    return;
  }
  const target = document.getElementById(id);
  if (!target?.matches(".story-card")) return;
  target.querySelector(".story-reading").open = true;
  target.scrollIntoView({ block: "start" });
}
function bind() {
  $("#suggest-story").addEventListener("click", openSuggestion);
  $("#suggest-another").addEventListener("click", openSuggestion);
  document
    .querySelectorAll("[data-close-dialog]")
    .forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  document.querySelectorAll("dialog").forEach((dialog) =>
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          dialog.close();
      }
    }),
  );
  $("#image-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      const image = imageContribution(
        Object.fromEntries(new FormData(form)),
        catalog.stories.map((item) => item.id),
      );
      mutateExperiments((data) => {
        data.images = [...data.images.filter((item) => item.storyId !== image.storyId), image];
      });
      $("#image-dialog").close();
      render();
      document
        .querySelector(`[data-add-image="${CSS.escape(image.storyId)}"]`)
        ?.focus({ preventScroll: true });
      await submitDraft("image", image.id);
    } catch (error) {
      form.querySelector(".field-error").textContent = error.message;
    }
  });
  $("#suggestion-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      const idea = storySuggestion(
        Object.fromEntries(new FormData(form)),
        stations.map((item) => item.id),
      );
      mutateExperiments((data) => {
        data.suggestions.push(idea);
      });
      $("#suggestion-dialog").close();
      form.reset();
      renderSuggestions();
      $("#suggestions-title").scrollIntoView({ block: "start" });
      await submitDraft("story", idea.id);
    } catch (error) {
      form.querySelector(".field-error").textContent = error.message;
    }
  });
  $("#download-experiments").addEventListener("click", () => {
    downloadJSON(
      {
        ...experiments,
        scope: session ? "test-session-do-not-publish" : "this-device-only",
        exportedAt: new Date().toISOString(),
      },
      "safar-seva-story-experiments.json",
    );
    toast("Download ready. Your contributions have not been sent or published.");
  });
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    try {
      if (button.dataset.submitImage || button.dataset.submitSuggestion) {
        const item = button.dataset.submitImage
          ? experiments.images.find((item) => item.storyId === button.dataset.submitImage)
          : experiments.suggestions.find((item) => item.id === button.dataset.submitSuggestion);
        if (item) {
          button.disabled = true;
          await submitDraft(button.dataset.submitImage ? "image" : "story", item.id);
        }
      }
      if (button.dataset.addImage) openImage(button.dataset.addImage);
      if (button.dataset.removeImage) {
        mutateExperiments((data) => {
          data.images = data.images.filter((item) => item.storyId !== button.dataset.removeImage);
        });
        render();
        toast("Image link removed from this device.");
      }
      if (button.dataset.removeSuggestion) {
        mutateExperiments((data) => {
          data.suggestions = data.suggestions.filter(
            (item) => item.id !== button.dataset.removeSuggestion,
          );
        });
        renderSuggestions();
        toast("Story idea removed from this device.");
      }
      if (button.dataset.readStory) {
        const storyId = button.dataset.readStory;
        if (!catalog.stories.some((story) => story.id === storyId))
          throw new Error("This story is unavailable.");
        mutateLedger((data) => {
          data.storyReads ||= [];
          const now = new Date().toISOString(),
            today = istInput(now).slice(0, 10);
          const counted = getYatraProgress(data.rides, season, now, data.storyReads).discovered;
          if (
            !counted.includes(storyId) &&
            !data.storyReads.some(
              (read) => read.storyId === storyId && istInput(read.readAt).slice(0, 10) === today,
            )
          )
            data.storyReads.push({ storyId, readAt: now });
        });
        render();
        document
          .querySelector(`[data-read-story="${CSS.escape(storyId)}"]`)
          ?.focus({ preventScroll: true });
        toast("वाचल्याची नोंद केली · Reading saved on this device.");
      }
    } catch (error) {
      toast(error.message);
    }
  });
  $("#story-library").addEventListener(
    "error",
    (event) => {
      const img = event.target;
      if (img.tagName === "IMG") {
        img.hidden = true;
        img.nextElementSibling.hidden = false;
      }
    },
    true,
  );
  window.addEventListener("hashchange", openHash);
  window.addEventListener("storage", (event) => {
    try {
      if (event.key === ledgerKey || event.key === localKey) {
        ledger = readLedger();
        experiments = parseExperiments(localStore.getItem(localKey));
        if (experiments.images.some((item) => !item.id))
          mutateExperiments((data) => {
            data.images.forEach((item) => {
              item.id ||= crypto.randomUUID();
            });
          });
        render();
      }
    } catch (error) {
      warn(error.message);
    }
  });
}
async function init() {
  for (const [id, hash] of [
    ["stories-home", ""],
    ["stories-ride", ""],
    ["stories-notebook", "#ledger"],
  ])
    document.getElementById(id).href = `./index.html${query}${hash}`;
  const json = async (file) => {
    const response = await fetch(file);
    if (!response.ok) throw new Error("Stories could not be opened. Reconnect and reload.");
    return response.json();
  };
  try {
    ledger = readLedger();
    experiments = parseExperiments(localStore.getItem(localKey));
    if (experiments.images.some((item) => !item.id))
      mutateExperiments((data) => {
        data.images.forEach((item) => {
          item.id ||= crypto.randomUUID();
        });
      });
  } catch (error) {
    warn(error.message);
  }
  try {
    const [publication, network, loadedSeason] = await Promise.all([
      json("./stories.json"),
      json("./stations.json"),
      json("./season.json"),
    ]);
    catalog = validateCatalog(publication);
    season = loadedSeason;
    lines = network.lines || [];
    stations = linkStations(network.stations, lines);
    if (session) {
      const test = await json("./test-publication.json");
      if (test.sessions?.[session]) catalog = validateCatalog(test.sessions[session]);
      warn(`Practice session · ${session}. Separate local contributions.`);
    }
    $("#suggestion-station").innerHTML += stations
      .map(
        (item) => `<option value="${e(item.id)}">${e(item.name_mr)} · ${e(item.name_en)}</option>`,
      )
      .join("");
    bind();
    routeSidecar = mountRouteSidecar();
    floatingStamp = mountFloatingStamp({
      getState: () => ledger,
      stationName: (id) => station(id)?.name_en || id,
      notify: toast,
      onImpression: (updated) => {
        mutateLedger((data) => {
          const index = data.rides.findIndex((ride) => ride.id === updated.id);
          if (index < 0) throw new Error("This ride is no longer available.");
          data.rides[index] = updated;
        });
        render();
      },
      onDownload: () => {
        location.href = `./index.html${query}#ledger`;
      },
    });
    render();
    requestAnimationFrame(openHash);
    if (!session)
      fetch("/api/public/images", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (Array.isArray(data?.images)) {
            publicImages = data.images;
            renderStories();
          }
        })
        .catch(() => {});
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(() => {});
    const connection = () => {
      $("#stories-connection").innerHTML =
        `<i></i>${navigator.onLine ? "Stories along the line" : "Offline · saved here"}`;
    };
    connection();
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
  } catch (error) {
    warn(error.message);
    $("#story-library").textContent = "Reconnect and reload to open the story shelf.";
  }
}
init();
