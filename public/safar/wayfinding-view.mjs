import { getRouteStationIds } from './core.mjs';
import { escapeHTML as e, localTime } from './ui.mjs';
import { answerLabel, featureLabels, observationsAt, settingLabels, signGuide, stationStories, storySetting } from './wayfinding.mjs';

const named = (stations, id) => stations.find(item => item.id === id) || { name_mr: id, name_en: id };
const settingTag = story => {
  const words = settingLabels[storySetting(story)];
  return `<span class="place-tag">${e(words.mr)} <small lang="en">${e(words.en)}</small></span>`;
};

function noteMarkup(notes, empty) {
  if (!notes.length) return `<p class="atlas-empty">${empty}<small lang="en">No dated note on this device for these features yet.</small></p>`;
  return `<ol class="atlas-notes">${notes.slice(0, 4).map(result => {
    const feature = featureLabels[result.feature] || { mr: result.feature, en: result.feature };
    const answer = answerLabel(result.feature, result.answer);
    return `<li><strong>${e(feature.mr)} · ${e(answer.mr)}</strong><span lang="en">${e(feature.en)} · ${e(answer.en)}</span>${result.location ? `<p>${e(result.location)}</p>` : '<p>संपूर्ण स्थानकाची नोंद · Station-level note; fixture unknown</p>'}<small lang="en">${e(localTime(result.observedAt))} · Unverified</small></li>`;
  }).join('')}</ol>`;
}

function signs() {
  return `<details class="sign-guide"><summary>फलक समजून घ्या · Common signs</summary><div class="sign-list">${signGuide.map(sign => `<div><span aria-hidden="true">${e(sign.mark)}</span><strong>${e(sign.mr)}<small lang="en">${e(sign.en)}</small></strong><p>${e(sign.meaningMr)}<small lang="en">${e(sign.meaningEn)}</small></p></div>`).join('')}</div><p class="atlas-hint" lang="en">Use the words on the actual station sign. These examples do not identify a specific exit.</p></details>`;
}

function quest(story, canCheck, canGive) {
  const learn = story ? `<a class="atlas-action" href="#${e(story.id)}"><strong>◆ शिका · Learn</strong><span>${e(story.title_mr)}</span><small lang="en">${e(story.title_en)}</small></a>` : '<a class="atlas-action" href="#stories"><strong>◆ शिका · Learn</strong><span>मार्गावरील कथा पाहा</span><small lang="en">Browse stories along the line</small></a>';
  return `<div class="quest-grid">${learn}<div class="atlas-action"><strong>◎ पाहा · Notice</strong><span>स्थानकात प्रत्यक्ष दिसलेलं नोंदवा</span><small lang="en">Save one dated observation</small><button type="button" class="text-button" data-map-check ${canCheck ? '' : 'disabled'}>${canCheck ? 'पाहा कृती उघडा · Open Pahā' : 'या प्रवासातील कृती वापरल्या · Checks used'}</button></div><div class="atlas-action"><strong>＋ द्या · Give</strong><span>${story ? 'या कथेसाठी स्पष्ट शब्द सुचवा' : 'प्रवासातील एक गोष्ट स्पष्ट करा'}</span><small lang="en">A small wording contribution</small><button type="button" class="text-button" data-map-give ${canGive ? '' : 'disabled'}>${canGive ? 'सूचना उघडा · Open contribution' : 'या प्रवासातील कृती वापरल्या · Tasks used'}</button></div></div>`;
}

export function renderWayfinding({ ride, stations, catalog, rides, selectedStationId, view, canCheck, canGive }) {
  const route = ride.routeStationIds || getRouteStationIds(stations, ride.from, ride.to);
  const here = route.includes(selectedStationId) ? selectedStationId : route[0];
  const current = named(stations, here), story = stationStories(catalog, here)[0];
  const insideNotes = observationsAt(rides, here, ['lift', 'ramp', 'water']);
  const exitNotes = observationsAt(rides, here, ['lighting']);
  const noteAction = `<button type="button" class="secondary-button atlas-check" data-map-check ${canCheck ? '' : 'disabled'}>${canCheck ? 'इथे पाहा नोंद करा · Open a Pahā check here' : 'या प्रवासातील पाहा कृती वापरल्या · Checks used on this ride'}</button>`;
  const selectedIndex = route.indexOf(here);
  const stopNav = `<nav class="atlas-stop-nav" aria-label="Nearby stops"><button type="button" data-map-move="-1" ${selectedIndex === 0 ? 'disabled' : ''}>← मागचं स्थानक <small lang="en">Previous stop</small></button><button type="button" data-map-move="1" ${selectedIndex === route.length - 1 ? 'disabled' : ''}>पुढचं स्थानक → <small lang="en">Next stop</small></button></nav>`;
  const visibleCount = catalog.stories.filter(item => storySetting(item) === 'visible').length;
  const tabs = [
    ['line', 'मार्गावर', 'Along the line'],
    ['station', 'स्थानकात', 'Inside the station'],
    ['exit', 'एक्झिटबाहेर', 'Around the exit'],
  ];
  const tabMarkup = `<div class="atlas-tabs" role="tablist" aria-label="Connected journey views">${tabs.map(([key, mr, en]) => `<button type="button" id="atlas-tab-${key}" role="tab" aria-controls="atlas-panel" aria-selected="${view === key}" data-map-view="${key}">${mr}<small lang="en">${en}</small></button>`).join('')}</div>`;
  const storyMarkup = story ? `<p class="atlas-story">${settingTag(story)} <a href="#${e(story.id)}">${e(story.title_mr)} · <span lang="en">${e(story.title_en)}</span> →</a></p>` : '<p class="atlas-empty">इथे अजून कथा नाही.<small lang="en">No story linked to this stop yet.</small></p>';
  let panel;
  if (view === 'station') {
    panel = `<p class="atlas-lede">रस्त्यापासून गाडीपर्यंत, प्रत्येक भागावरची खूण तपासा.<small lang="en">Follow signs on site from street to train; each part needs its own check.</small></p><ol class="path-steps"><li>रस्ता <small lang="en">Street</small></li><li>प्रवेश <small lang="en">Entrance</small></li><li>तिकीट गेट <small lang="en">Ticket gate</small></li><li>फलाट <small lang="en">Platform</small></li><li>गाडी <small lang="en">Train</small></li></ol><h4>या फोनवरील नोंदी <small lang="en">Your dated station notes</small></h4>${noteMarkup(insideNotes, 'लिफ्ट, रॅम्प किंवा पाण्याची नोंद नाही.')}${noteAction}${signs()}<p class="atlas-hint" lang="en">These are personal, unverified observations. Check current conditions with station staff before relying on a route.</p>`;
  } else if (view === 'exit') {
    panel = `<p class="atlas-lede">बाहेर पडताना दिशा, रस्ता ओलांडण्याची जागा आणि पुढचा प्रवास पाहा.<small lang="en">At the exit, check the direction, crossing or kerb, then the onward walk or bus/auto stop.</small></p><ol class="path-steps"><li>एक्झिट फलक <small lang="en">Exit sign</small></li><li>रस्ता ओलांडण्याची जागा <small lang="en">Crossing / kerb</small></li><li>पुढची वाट <small lang="en">Onward walk / stop</small></li></ol><h4>या फोनवरील नोंदी <small lang="en">Your dated exit-light notes</small></h4>${noteMarkup(exitNotes, 'एक्झिटच्या दिव्यांची नोंद नाही.')}${noteAction}${signs()}<div class="future-layers"><strong>पुढील नोंदी <small lang="en">Later walking layers</small></strong><p>सावली · बसायला जागा · दिवे · पाणी</p><small lang="en">Shade and seating still need check templates. Lighting and water notes remain dated personal observations until enough checked evidence exists for a public layer.</small></div>`;
  } else {
    panel = `<p class="atlas-lede">${e(named(stations, ride.from).name_mr)} पासून ${e(named(stations, ride.to).name_mr)} पर्यंत. थांबा निवडा.<small lang="en">Choose a stop to see its story and one small act.</small></p><ol class="route-board" aria-label="Stops on this ride, in travel order">${route.map((id, index) => {
      const item = named(stations, id), stories = stationStories(catalog, id), notes = observationsAt(rides, id);
      return `<li><button type="button" data-map-station="${e(id)}" aria-pressed="${id === here}"><span class="route-dot" aria-hidden="true"></span><strong>${e(item.name_mr)}</strong><small lang="en">${e(item.name_en)}</small><span class="route-badges">${stories.length ? '◆ कथा · Story' : ''}${notes.length ? ` ◎ ${notes.length} नोंद${notes.length === 1 ? '' : 'ी'}` : ''}</span></button></li>`;
    }).join('')}</ol><div class="atlas-legend"><span>◆ कथा · Story</span><span>◎ या फोनवरील नोंद · Note on this device</span></div><div class="story-context"><strong>कथा कुठे आहे? <small lang="en">Where is the story?</small></strong><span>${settingLabels.visible.mr} / ${settingLabels.visible.en}: ${visibleCount ? visibleCount : 'अजून तपासलेली नाही · None verified yet'}</span><span>${settingLabels.inside.mr} / ${settingLabels.inside.en}</span><span>${settingLabels.neighbourhood.mr} / ${settingLabels.neighbourhood.en}</span></div>${quest(story, canCheck, canGive)}`;
  }
  return `<section class="ride-atlas" aria-labelledby="atlas-title"><div class="atlas-heading"><div><p class="eyebrow" lang="en">THE JOURNEY, IN THREE VIEWS</p><h2 id="atlas-title">प्रवासाचा नकाशा <small lang="en">Your journey guide</small></h2></div><a href="https://www.punemetrorail.org/project-profile" target="_blank" rel="noopener noreferrer" lang="en">Official station list ↗</a></div>${tabMarkup}<div id="atlas-panel" role="tabpanel" aria-labelledby="atlas-tab-${view}"><div class="atlas-selected"><div><small lang="en">STOP ${route.indexOf(here) + 1} OF ${route.length}</small><h3 id="atlas-station-title" tabindex="-1">${e(current.name_mr)} <span lang="en">${e(current.name_en)}</span></h3></div>${view !== 'line' ? `<span class="atlas-note-count" lang="en">${observationsAt(rides, here).length} dated note(s) here · this device</span>` : ''}</div>${stopNav}${storyMarkup}${panel}</div></section>`;
}
