import { escapeHTML as e, downloadJSON, localTime } from "./ui.mjs";
const $ = (selector) => document.querySelector(selector);
let page = 0,
  items = [];
function error(message) {
  $("#admin-error").hidden = !message;
  $("#admin-error").textContent = message;
}
function showLogin() {
  $("#admin-login").hidden = false;
  $("#admin-desk").hidden = true;
  $("#admin-items").replaceChildren();
  items = [];
}
async function api(path, options = {}) {
  const response = await fetch(`/api/admin/${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
  });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "The reviewer service is not available here. Deploy the Netlify Functions and configure the server environment variables.",
    );
  }
  if (response.status === 401) {
    showLogin();
    throw new Error(
      "Sign in again. If sign-in is blocked in this embedded view, open the site directly in your browser.",
    );
  }
  if (!response.ok) throw new Error(body.error || "The request failed.");
  return body;
}
const post = (body) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
function details(item) {
  const p = item.payload;
  if (item.kind === "image")
    return `<h3>${e(p.caption)}</h3><p><strong>Story:</strong> ${e(p.storyId)}<br><strong>Credit:</strong> ${e(p.credit)}</p><p><a href="${e(p.sourceURL)}" target="_blank" rel="noopener noreferrer">Source page ↗</a> · <a href="${e(p.imageURL)}" target="_blank" rel="noopener noreferrer">Image link ↗</a></p><button class="text-button" type="button" data-preview-image="${e(item.id)}">Preview image</button><div class="admin-image-preview"></div><p class="task-hint">Approving makes this image visible on its public story. A newer approved image replaces the previous one.</p>`;
  if (item.kind === "story")
    return `<h3>${e(p.title)}</h3><p class="admin-submitted-text">${e(p.summary)}</p><p>Nearest station: <strong>${e(p.stationId)}</strong></p>${p.sourceURL ? `<p><a href="${e(p.sourceURL)}" target="_blank" rel="noopener noreferrer">Suggested source ↗</a></p>` : ""}<p class="task-hint">Accepting an idea adds an editorial decision. It does not publish this draft as a factual story. Prepare a sourced Marathi and English story in the publication before a later release.</p>`;
  return `<h3>${e(p.storyId)} / ${e(p.field)}</h3><div class="review-comparison"><div><h4>Original · v${e(p.baseVersion)}</h4><p>${e(p.originalText)}</p></div><div><h4>Suggested wording</h4><p>${e(p.suggestedText)}</p></div></div><p class="task-hint">Accepting records an editorial decision; it does not change the public story text. Use the reviewed contribution file in the existing story editor to prepare the publication.</p>`;
}
function render() {
  $("#admin-items").innerHTML = items.length
    ? items
        .map(
          (item) =>
            `<article class="admin-item" data-id="${e(item.id)}"><div class="admin-item-meta"><span class="badge">${e(item.kind)} / ${e(item.status)}</span><span>${e(localTime(item.created_at))}</span></div>${details(item)}<label for="note-${e(item.id)}">Private reviewer note</label><textarea id="note-${e(item.id)}" maxlength="1000" rows="3">${e(item.review_note || "")}</textarea><div class="admin-review-actions"><button class="primary-button" type="button" data-review="approved">${item.kind === "image" ? "Approve & publish image" : "Accept for editorial work"}</button><button class="secondary-button" type="button" data-review="declined">Decline</button><button class="text-button" type="button" data-review="pending">Return to pending</button></div><p class="field-error" role="alert"></p></article>`,
        )
        .join("")
    : '<p class="empty-ledger">No submissions match this filter.</p>';
}
async function refresh() {
  error("");
  $("#admin-status").textContent = "Opening the inbox…";
  try {
    const query = new URLSearchParams({ page: String(page) });
    if ($("#filter-status").value) query.set("status", $("#filter-status").value);
    if ($("#filter-kind").value) query.set("kind", $("#filter-kind").value);
    const [inbox, counter] = await Promise.all([api(`submissions?${query}`), api("counter")]);
    items = inbox.items;
    render();
    $("#admin-counter").innerHTML = [
      ["participants", "Completed rides"],
      ["observations", "Station notes"],
      ["contributions", "Choices / wording"],
      ["groups", "Invitations"],
    ]
      .map(
        ([key, label]) =>
          `<div class="stat"><span class="stat-number">${Number(counter[key] || 0)}</span><span class="stat-description">${label}</span></div>`,
      )
      .join("");
    $("#admin-status").textContent =
      `${items.length} item${items.length === 1 ? "" : "s"} on this page. Counter epoch: ${counter.epoch}.`;
    $("#admin-page").textContent = `Page ${page + 1}`;
    $("#admin-prev").disabled = page === 0;
    $("#admin-next").disabled = !inbox.hasMore;
  } catch (err) {
    error(err.message);
    $("#admin-status").textContent = "Inbox could not be refreshed.";
  }
}
async function signedIn() {
  const session = await api("session");
  $("#admin-login").hidden = true;
  $("#admin-desk").hidden = false;
  $("#admin-session").textContent = `Reviewer session / ${session.namespace}`;
  await refresh();
}
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.target.querySelector("button");
  button.disabled = true;
  error("");
  try {
    await api("login", post({ password: $("#admin-password").value }));
    $("#admin-password").value = "";
    await signedIn();
  } catch (err) {
    error(err.message);
  } finally {
    button.disabled = false;
  }
});
$("#admin-logout").addEventListener("click", async () => {
  try {
    await api("logout", post({}));
    showLogin();
    error("");
  } catch (err) {
    error(err.message);
  }
});
$("#admin-filters").addEventListener("submit", (event) => {
  event.preventDefault();
  page = 0;
  refresh();
});
$("#admin-prev").addEventListener("click", () => {
  page = Math.max(0, page - 1);
  refresh();
});
$("#admin-next").addEventListener("click", () => {
  page++;
  refresh();
});
$("#admin-download").addEventListener("click", () =>
  downloadJSON(
    { exportedAt: new Date().toISOString(), scope: "private-reviewer-page", items },
    "safar-reviewer-inbox-page.json",
  ),
);
$("#admin-items").addEventListener("click", async (event) => {
  const button = event.target.closest("button"),
    card = button?.closest("[data-id]");
  if (!card) return;
  const item = items.find((item) => item.id === card.dataset.id);
  if (button.dataset.previewImage) {
    const img = document.createElement("img");
    img.src = item.payload.imageURL;
    img.alt = item.payload.caption;
    img.referrerPolicy = "no-referrer";
    card.querySelector(".admin-image-preview").replaceChildren(img);
    return;
  }
  if (!button.dataset.review) return;
  const buttons = [...card.querySelectorAll("button")];
  buttons.forEach((b) => (b.disabled = true));
  try {
    await api("submissions", {
      ...post({
        id: item.id,
        status: button.dataset.review,
        note: card.querySelector("textarea").value,
        version: item.version,
      }),
      method: "PATCH",
    });
    await refresh();
  } catch (err) {
    card.querySelector(".field-error").textContent = err.message;
    buttons.forEach((b) => (b.disabled = false));
  }
});
api("session")
  .then(signedIn)
  .catch(() => showLogin());
