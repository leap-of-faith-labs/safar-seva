import {
  impressionCount,
  addImpression,
  earnedImpressions,
  canStamp,
  sealMarkup,
  aiSessionUnlocked,
  AI_SESSION_URL,
  AI_SESSION_THRESHOLD,
} from "./stamps.mjs";
import { escapeHTML as e } from "./ui.mjs";

// Reads and impressions retain the existing award semantics on both pages.
export function stampAllowance(ride, rides, reads) {
  const after = Date.parse(ride?.stamp?.awardedAt);
  const next = Math.min(
    ...rides.map((item) => Date.parse(item.createdAt)).filter((time) => time > after),
    Infinity,
  );
  const laterReads = new Set(
    reads
      .filter((read) => Date.parse(read.readAt) > after && Date.parse(read.readAt) < next)
      .map((read) => read.storyId),
  ).size;
  return earnedImpressions(ride, { laterReads });
}

export function mountFloatingStamp({
  getState,
  stationName,
  onImpression,
  onDownload,
  notify,
  isFullCycle = () => false,
}) {
  const host = document.createElement("div");
  host.innerHTML = `<section id="stamp-dialog" class="stamp-dialog stamp-floater-panel" popover="manual" role="dialog" aria-labelledby="stamp-title">
    <div class="dialog-top"><h2 id="stamp-title">सफरेचा शिक्का <small lang="en">Seal your ride</small></h2><button id="close-stamp" class="secondary-button icon-button" aria-label="Minimise stamp" type="button">×</button></div>
    <p id="stamp-route" class="stamp-route" lang="en"></p>
    <div class="stamp-counter"><span>शिक्क्याच्या छाप <small lang="en">Ink impressions</small></span><output id="stamp-count">0</output></div>
    <div id="stamp-paper" class="stamp-paper" aria-label="Your stamp impressions"></div>
    <button id="press-stamp" class="primary-button stamp-press" type="button"><span class="stamp-tool" aria-hidden="true"><i></i><b></b></span><span id="stamp-action-label">शिक्का मारा · Stamp my ride</span></button>
    <p id="stamp-status" class="stamp-status" role="status" lang="en"></p><p id="stamp-earn" class="stamp-earn"></p><div id="stamp-ai"></div>
    <p id="stamp-cycle" class="stamp-earn" hidden>पूर्ण फेरी! End to end on one line. <button id="cycle-download" class="text-button" type="button">Download notebook ↓</button></p>
    <button id="stamp-done" class="text-button" type="button">झालं · Minimise ↘</button>
  </section><div id="stamp-floater" class="stamp-floater" popover="manual"><button id="stamp-launcher" type="button" aria-controls="stamp-dialog" aria-expanded="false"><span class="floating-seal" aria-hidden="true"></span><span class="floating-stamp-label">शिक्का <small lang="en">Stamp</small></span><span class="floating-stamp-count" aria-hidden="true"></span></button></div>`;
  document.body.append(...host.children);
  const panel = document.getElementById("stamp-dialog"),
    floater = document.getElementById("stamp-floater"),
    launcher = document.getElementById("stamp-launcher");
  const $ = (selector) => panel.querySelector(selector);
  let selectedId = null,
    busy = false,
    animation = null,
    previousFocus = null,
    desiredOpen = false;
  const isOpen = () => panel.matches(":popover-open");
  const selected = () => {
    const { rides, currentRideId } = getState();
    return (
      rides.find((ride) => ride.id === selectedId) ||
      rides.find((ride) => ride.id === currentRideId) ||
      rides.at(-1)
    );
  };
  const lift = () => {
    // A child of an open modal stays interactive as well as visually on top.
    const parent = document.querySelector("dialog[open]") || document.body;
    const panelWasOpen = isOpen();
    if (floater.matches(":popover-open")) floater.hidePopover();
    if (panel.parentElement !== parent) {
      if (panelWasOpen) panel.hidePopover();
      parent.append(panel);
      if (panelWasOpen) panel.showPopover();
    }
    if (floater.parentElement !== parent) parent.append(floater);
    floater.showPopover();
  };
  function render() {
    const state = getState(),
      ride = selected(),
      count = impressionCount(ride);
    const earned = stampAllowance(ride, state.rides, state.storyReads || []);
    const ready = canStamp(ride, earned);
    const date = ride?.stamp
      ? new Date(ride.stamp.awardedAt)
          .toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            timeZone: "Asia/Kolkata",
          })
          .toUpperCase()
      : "";
    launcher.querySelector(".floating-seal").innerHTML = ride?.stamp
      ? sealMarkup("floating-seal", date)
      : '<span class="stamp-tool"><i></i><b></b></span>';
    launcher.querySelector(".floating-stamp-count").textContent = count || "";
    launcher.dataset.ready = ready;
    launcher.setAttribute(
      "aria-label",
      ready
        ? "Open stamp · a new impression is ready"
        : ride?.stamp
          ? `Open stamp · ${count} ink impressions`
          : "Open stamp · complete your ride to earn it",
    );
    $("#stamp-route").textContent = ride
      ? `${stationName(ride.from)} → ${stationName(ride.to)}`
      : "A little good, sealed along the way.";
    $("#stamp-count").textContent = count;
    $("#stamp-paper").innerHTML = count
      ? Array.from(
          { length: Math.min(count, 6) },
          (_, index) =>
            `<span class="stamp-replica">${sealMarkup(`floating-paper-${index}`, date)}</span>`,
        ).join("")
      : '<span class="stamp-empty" aria-hidden="true">＋</span>';
    $("#press-stamp").disabled = !ready || busy;
    $("#stamp-action-label").textContent = count
      ? "आणखी एक शिक्का · Stamp again"
      : "शिक्का मारा · Stamp my ride";
    $("#stamp-status").textContent = ride?.stamp
      ? `${count} / ${earned} earned impressions · One participation award`
      : "Your stamp is waiting. Finish Learn, Give and Notice on a ride to earn it.";
    $("#stamp-earn").innerHTML = ready
      ? ""
      : ride?.stamp
        ? '<strong>पुढचा शिक्का कमवा · Earn your next stamp</strong><span lang="en">Read another story, invite a co-rider, or finish one more activity.</span>'
        : '<a class="text-button" href="./index.html#journey">सफर करूया · Go to your ride →</a>';
    $("#stamp-ai").innerHTML = aiSessionUnlocked(ride)
      ? `<div class="ai-session"><p class="eyebrow" lang="en">SPECIAL MILESTONE</p><strong>विशेष संधी · AI for ALL</strong><p lang="en">${count} stamps on this ride. Join an AI for ALL session.</p><a class="primary-button" href="${AI_SESSION_URL}" target="_blank" rel="noopener noreferrer">Join AI for ALL ↗</a></div>`
      : ride?.stamp
        ? `<p class="task-hint" lang="en">${Math.max(0, AI_SESSION_THRESHOLD - count)} more impressions to unlock AI for ALL.</p>`
        : "";
    $("#stamp-cycle").hidden = !ride?.stamp || !isFullCycle(ride);
  }
  function genie(opening) {
    animation?.cancel();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
    const source = launcher.getBoundingClientRect(),
      target = panel.getBoundingClientRect();
    const dx = source.x + source.width / 2 - (target.x + target.width / 2),
      dy = source.y + source.height / 2 - (target.y + target.height / 2);
    const frames = [
      {
        opacity: 0,
        transform: `translate(${dx}px,${dy}px) scale(.05,.02) skewX(-18deg)`,
        clipPath: "inset(0 38% 0 38% round 50%)",
      },
      {
        opacity: 0.8,
        transform: `translate(${dx * 0.22}px,${dy * 0.3}px) scale(.65,.45) skewX(7deg)`,
        clipPath: "inset(0 12% 0 12% round 24px)",
        offset: 0.55,
      },
      {
        opacity: 1,
        transform: "translate(0,0) scale(1) skewX(0)",
        clipPath: "inset(0 0 0 0 round 12px)",
      },
    ];
    animation = panel.animate(
      opening ? frames : [...frames].reverse().map(({ offset, ...frame }) => frame),
      { duration: opening ? 540 : 340, easing: "cubic-bezier(.22,.8,.24,1)", fill: "both" },
    );
    return animation.finished.catch(() => {});
  }
  async function open(id) {
    selectedId =
      id || getState().currentRideId || getState().rides.findLast((ride) => ride.stamp)?.id || null;
    render();
    if (desiredOpen && isOpen()) return;
    desiredOpen = true;
    if (!isOpen()) {
      previousFocus = document.activeElement;
      panel.showPopover();
    }
    launcher.setAttribute("aria-expanded", "true");
    lift();
    await genie(true);
    if (desiredOpen && isOpen()) $("#close-stamp").focus({ preventScroll: true });
  }
  async function close() {
    if (!isOpen()) return;
    desiredOpen = false;
    launcher.setAttribute("aria-expanded", "false");
    await genie(false);
    if (desiredOpen) return;
    if (isOpen()) panel.hidePopover();
    animation?.cancel();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    else launcher.focus({ preventScroll: true });
  }
  panel.addEventListener("toggle", (event) => {
    launcher.setAttribute("aria-expanded", String(event.newState === "open"));
    if (event.newState === "closed" && !isOpen()) desiredOpen = false;
  });
  launcher.addEventListener("click", () => (desiredOpen ? close() : open()));
  $("#close-stamp").addEventListener("click", close);
  $("#stamp-done").addEventListener("click", close);
  $("#cycle-download").addEventListener("click", onDownload);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  $("#press-stamp").addEventListener("click", async () => {
    if (busy) return;
    const ride = selected(),
      state = getState();
    if (!ride?.stamp) return;
    busy = true;
    $("#press-stamp").disabled = true;
    panel.classList.add("is-pressing");
    try {
      if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
        await new Promise((resolve) => setTimeout(resolve, 260));
      const updated = addImpression(
        ride,
        stampAllowance(ride, state.rides, state.storyReads || []),
      );
      await onImpression(updated);
      render();
      $("#stamp-paper").lastElementChild?.classList.add("fresh-impression");
      notify("शिक्का जतन केला · Stamp saved on this device.");
    } catch (error) {
      notify(error.message);
    } finally {
      busy = false;
      panel.classList.remove("is-pressing");
      render();
    }
  });
  // Put the transparent control above dialogs as they enter the top layer.
  const observer = new MutationObserver(lift);
  document
    .querySelectorAll("dialog")
    .forEach((dialog) => observer.observe(dialog, { attributes: true, attributeFilter: ["open"] }));
  document.addEventListener(
    "toggle",
    (event) => {
      if (event.target.id === "route-sidecar" && event.newState === "open") lift();
    },
    true,
  );
  render();
  lift();
  return { render, open, close };
}
