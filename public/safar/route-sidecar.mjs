import { escapeHTML as e } from "./ui.mjs";
import { getRouteStationIds } from "./core.mjs";
import { routeContext } from "./ux.mjs";

export function mountRouteSidecar() {
  const host = document.createElement("div");
  host.innerHTML = `<button id="route-toggle" class="route-toggle" type="button" popovertarget="route-sidecar" aria-controls="route-sidecar" aria-expanded="false" hidden><span aria-hidden="true">☷</span><span>मार्ग <small lang="en">Route</small></span></button>
  <aside id="route-sidecar" class="route-sidecar" popover="auto" aria-labelledby="sidecar-title"><div class="sidecar-header"><div><p class="eyebrow" lang="en">YOUR RIDE / ROUTE</p><h2 id="sidecar-title">मेट्रोचा प्रवास <small lang="en">Along your route</small></h2></div><button class="secondary-button icon-button" type="button" popovertarget="route-sidecar" popovertargetaction="hide" aria-label="Collapse route menu">×</button></div><div id="sidecar-content"></div></aside>`;
  document.body.append(...host.children);
  const drawer = document.getElementById("route-sidecar"),
    toggle = document.getElementById("route-toggle"),
    content = document.getElementById("sidecar-content");
  let signature = "";
  drawer.addEventListener("toggle", () => {
    toggle.setAttribute("aria-expanded", String(drawer.matches(":popover-open")));
  });
  return {
    render(ride, stations, lines, catalog, visible = true) {
      toggle.hidden = !ride || !visible;
      if (!ride || !visible) {
        if (drawer.matches(":popover-open")) drawer.hidePopover();
        return;
      }
      const next = `${ride.id}:${ride.from}:${ride.to}`;
      if (next === signature) return;
      signature = next;
      const route = ride.routeStationIds || getRouteStationIds(stations, ride.from, ride.to);
      const context = routeContext(route, lines);
      content.innerHTML = `<p class="sidecar-line" lang="en">${e(context.segments.map((line) => line.name_en).join(" → "))}${context.upcoming ? " · Includes an upcoming line" : ""}</p><p class="sidecar-stops"><strong>${route.length - 1}</strong> थांबे <span lang="en">stops</span></p><ol class="sidecar-stations">${route
        .map((id, index) => {
          const station = stations.find((item) => item.id === id) || { name_mr: id, name_en: id };
          const story = catalog.stories.find((item) => item.station_ids.includes(id));
          return `<li class="${index === 0 || index === route.length - 1 ? "endpoint" : ""}"><span class="sidecar-node" aria-hidden="true"></span><div>${index === 0 ? '<small class="station-end" lang="en">FROM</small>' : index === route.length - 1 ? '<small class="station-end" lang="en">TO</small>' : ""}<strong>${e(station.name_mr)}</strong><span lang="en">${e(station.name_en)}</span>${station.interchange ? '<small lang="en">Interchange</small>' : ""}${story ? `<a href="./stories.html${location.search}#${e(story.id)}" lang="en">Read a story ↗</a>` : ""}</div></li>`;
        })
        .join(
          "",
        )}</ol><p class="task-hint" lang="en">Your chosen route, not live train tracking.</p>`;
    },
  };
}
