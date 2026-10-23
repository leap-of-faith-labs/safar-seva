import './assets.js';
import { routeContext, seasonDates, runFormAction } from './ux.mjs';
import qrcode from './vendor/qrcode.mjs';
import { impressionCount, addImpression, sealMarkup, earnedImpressions, canStamp, markInvited, aiSessionUnlocked, AI_SESSION_URL, AI_SESSION_THRESHOLD, yatraBadges } from './stamps.mjs';
import { createLightRide, choiceTask, invitationURL, readInvitation } from './lightweight.mjs';
import { linkStations, getStopCount, getRouteStationIds, getCardTier, createRide, completeTask, addOptionalTask, swapTask, undoTask, makeExport, getLedgerStats } from './core.mjs';
import { parseStoredState } from './storage.mjs';
import { hydrateTasks, rankTasks, getYatraProgress } from './journey.mjs';
import { createContribution, validateCatalog, validatePacket } from './contributions.mjs';
import { addShortTripStory, swapCoherently, assembleSuggestion, suggestionInput, matchingPacket, contributionState, startRevision, firstSentence, matchGivingPreservingDraft } from './experience.mjs';
import { $, escapeHTML as e, localTime, istInput, sourceLinks, downloadJSON } from './ui.mjs';
import { renderWayfinding } from './wayfinding-view.mjs';
import { settingLabels, storySetting, stationStories } from './wayfinding.mjs';

const ASSETS = globalThis.SAFAR_OFFLINE_ASSETS;
const slug = new URLSearchParams(location.search).get('test');
const TEST_SESSION = /^[a-z0-9_-]{1,40}$/i.test(slug || '') ? slug : null;
const TEST_MODE = Boolean(TEST_SESSION);
const LEGACY_KEY = TEST_MODE ? (TEST_SESSION === '1' ? 'safar-seva:test-ledger:v1' : `safar-seva:test-ledger:${TEST_SESSION}:v1`) : 'safar-seva:ledger:v1';
const STORAGE_KEY = LEGACY_KEY.replace(/v1$/, 'v2');
const kinds = { learn:{mr:'शिका',en:'Learn',icon:'◆'}, give:{mr:'द्या',en:'Give',icon:'＋'}, check:{mr:'पाहा',en:'Notice',icon:'◎'} };
const stageWords = {
  saved: ['या फोनवर जतन केलं','Saved here'], ready:['शेअर करण्यासाठी तयार','Ready to share'],
  'handed-over':['तुम्ही शेअर केल्याची नोंद','Handed over by you · decision pending'],
  used:['प्रकाशित कथेत वापरलं','Used in the story'], declined:['बदल स्वीकारला नाही','Not adopted'],
};
let lines = [];
let stations = [], tasks = [], legacyTasks = [], taskData, catalog, season;
let state = { schemaVersion:1, rides:[], currentRideId:null, currentTaskId:null, forms:{}, outbox:[], storyReads:[], handoffs:[] };
let storageAvailable = true, unreadableSave = null, showBuilder = true, offlineReady = false, offlineFailed = false, toastTimer;
let yatraOpen = false, shareHash = null, invitation = null;
const editing = new Set(), swapping = new Set(), selectedTasks = new Map();
const atlasStations = new Map(), atlasViews = new Map(), atlasOpen = new Map();
const rideNow = () => state.rides.find(ride => ride.id === state.currentRideId);
const station = id => stations.find(item => item.id === id) || { id,name_mr:id,name_en:id };
const contentOf = task => task.contentSnapshot || [...tasks,...legacyTasks].find(item => item.id === task.taskId);
const inputOf = task => state.forms[task.id] || (task.kind === 'give' ? suggestionInput(task) : { ...(task.result || {}), observedAt:task.result?.observedAt ? istInput(task.result.observedAt) : '' });
const hasWriting = task => ['text','note','location'].some(key => String(state.forms[task.id]?.[key] || '').trim());
const taskPool = route => rankTasks(tasks,{stations,from:route.from,to:route.to,rides:state.rides,storyReads:state.storyReads,season});
const progressNow = () => getYatraProgress(state.rides,season,new Date().toISOString(),state.storyReads);
const packetByHash = hash => state.outbox.find(packet => packet.hash === hash);
const statusOf = packet => contributionState(packet,catalog,state.handoffs);

function warning(message) { $('#storage-warning').hidden = false; $('#storage-warning').textContent = message; }
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    unreadableSave = raw;
    const restored = parseStoredState(raw);
    state = {...restored,outbox:restored.outbox || [],storyReads:restored.storyReads || [],handoffs:restored.handoffs || []};
    state.rides.forEach(ride => ride.tasks.forEach(task => { if(task.kind === 'check' && task.status === 'pending') task.allowStationScope = true; }));
    unreadableSave = null;
  } catch {
    storageAvailable = false;
    warning('जुन्या नोंदी बदललेल्या नाहीत. Saved data could not be read and will not be overwritten. Download your work before closing.');
  }
}
function persist() {
  if (!storageAvailable) return false;
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); return true; }
  catch { storageAvailable = false; warning('या सत्रातलं काम डाउनलोड करा. Device storage is unavailable; download your work before closing.'); return false; }
}
function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  const feedback = document.querySelector('dialog[open] .dialog-feedback');
  if(feedback) feedback.textContent = message;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; },5000);
}
function options(selected) {
  if(!lines.length) return stations.map(item => `<option value="${e(item.id)}" ${item.id === selected ? 'selected' : ''}>${e(item.name_mr)} · ${e(item.name_en)}</option>`).join('');
  let picked = false;
  return lines.map(line => `<optgroup label="${e(line.name_mr)} · ${e(line.name_en)}${line.status === 'upcoming' ? ' (upcoming)' : ''}">${line.stations.map(id => {
    const item = station(id), on = !picked && id === selected; if(on) picked = true;
    return `<option value="${e(id)}" ${on ? 'selected' : ''}>${e(item.name_mr)} · ${e(item.name_en)}${item.interchange ? ' ⇄' : ''}</option>`;
  }).join('')}</optgroup>`).join('');
}
// A full cycle is a completed ride between the two end stations of one line.
function fullCycle(ride) {
  return lines.some(line => { const ends = [line.stations[0],line.stations.at(-1)]; return ends.includes(ride.from) && ends.includes(ride.to); });
}
function routeLabel(ride) {
  const route = ride.routeStationIds || getRouteStationIds(stations,ride.from,ride.to);
  const context = routeContext(route,lines);
  const names = context.segments.map(line => line.name_en).join(' → ') || 'Route preview';
  return `${names}${context.upcoming ? ' · Includes an upcoming line' : ''}`;
}
function updatePreview() {
  $('#journey-error').textContent = '';
  try {
    const count = getStopCount(stations,$('#from').value,$('#to').value);
    const label = routeLabel({from:$('#from').value,to:$('#to').value});
    $('#ride-preview').innerHTML = `<span class="stop-number">${count}</span><span class="preview-description">थांबे · एक छोटी सफर<small lang="en">${count} ${count === 1 ? 'stop' : 'stops'} · ${e(label)}</small><small lang="en">Three small activities · go at your own pace</small></span>`;
    $('#from').removeAttribute('aria-invalid'); $('#to').removeAttribute('aria-invalid');
    $('#start-button').disabled = false;
  } catch { $('#ride-preview').textContent = 'वेगळी दोन स्थानकं निवडा. Choose different start and end stations.'; $('#to').setAttribute('aria-invalid','true'); $('#start-button').disabled = true; }
}

function renderYatra() {
  const progress = progressNow(), active = Boolean(rideNow()) && !showBuilder;
  const existing = $('#yatra details');
  if(existing) yatraOpen = existing.open;
  const open = yatraOpen ?? !active;
  const dates = seasonDates(season);
  const phase = progress.state === 'upcoming' ? `Starts ${dates.start}` : progress.state === 'ended' ? 'Season ended' : `Till ${dates.end}`;
  const badges = yatraBadges(progress.count).map(b => `<li class="yatra-badge" data-earned="${b.earned}"><span aria-hidden="true">${b.earned ? '🪔' : '◌'}</span><strong>${b.mr}<small lang="en">${b.en} · ${b.at} ${b.at === 1 ? 'story' : 'stories'}</small></strong></li>`).join('');
  $('#yatra').innerHTML = `<details class="yatra-disclosure" ${open ? 'open' : ''}><summary><h2 id="yatra-title">${e(season.title_mr)} <small lang="en">Diwali Yatra</small></h2><span>${progress.count} / ${progress.target} <small lang="en">on this device · ${phase}</small></span></summary><div class="yatra-full"><div class="yatra-copy"><p class="eyebrow" lang="en">${progress.state === 'upcoming' ? 'STARTS ' + e(dates.start) : progress.state === 'ended' ? 'SEASON ENDED' : e(dates.start) + ' – ' + e(dates.end)} / ${e(season.title_en)}</p><p>${e(season.mission_mr)}</p><p class="yatra-phase" lang="en">${progress.state === 'upcoming' ? `Read now; seasonal counting starts ${dates.start}.` : progress.state === 'ended' ? 'This season has ended. Your stories and badges are kept here; keep reading at your own pace.' : 'Read a story to light a diya. Light 1, 4 and 8 diyas to earn Yatra badges — each story read also earns another stamp on your ride.'}</p></div><div class="yatra-progress"><div class="progress-track" role="progressbar" aria-label="Distinct stories read on this device this season" aria-valuenow="${progress.count}" aria-valuemin="0" aria-valuemax="${progress.target}"><span style="width:${Math.min(100,progress.count/progress.target*100)}%"></span></div><p class="yatra-detail">तुमचे सहभागाचे शिक्के: ${state.rides.filter(ride => ride.stamp).length}<br><span lang="en">${state.rides.filter(ride => ride.stamp).length} participation stamps · kept on this device</span></p><a class="text-button" href="#stories">कथा निवडा · Choose a story →</a></div><ul class="yatra-badges" aria-label="Diwali Yatra badges">${badges}</ul><div class="yatra-lamps">${catalog.stories.map(story => `<a href="#${e(story.id)}" class="yatra-lamp ${progress.discovered.includes(story.id) ? 'lit' : ''}" aria-label="${e(story.title_mr)}${progress.discovered.includes(story.id) ? ' · counted this season' : ''}"><span class="diya" aria-hidden="true"></span><small>${e(station(story.station_ids[0]).name_mr)}</small></a>`).join('')}</div></div></details>`;
}
function renderStories() {
  const opened = new Set([...document.querySelectorAll('.library-story[open]')].map(item => item.id));
  const counted = progressNow().discovered;
  const readBefore = new Set([...state.storyReads.map(read => read.storyId), ...state.rides.flatMap(ride => ride.tasks.filter(task => task.kind === 'learn' && task.status === 'completed').map(task => task.storyId))]);
  $('#story-library').innerHTML = catalog.stories.map(story => `<details class="library-story" id="${e(story.id)}" ${opened.has(story.id) || location.hash === '#'+story.id ? 'open' : ''}><summary><small>${e(station(story.station_ids[0]).name_mr)} · v${story.version} · ${e(settingLabels[storySetting(story)].mr)} / ${e(settingLabels[storySetting(story)].en)}</small><strong>${e(story.title_mr)}</strong><span lang="en">${e(story.title_en)}</span></summary><div class="library-story-body"><p>${e(story.body_mr)}</p><details class="english"><summary lang="en">English</summary><p lang="en">${e(story.body_en)}</p></details>${sourceLinks(story.sources)}<button class="secondary-button" data-read-story="${e(story.id)}">${counted.includes(story.id) ? '✓ यात्रेत नोंद झाली · Read again' : readBefore.has(story.id) ? '✓ वाचल्याची नोंद आहे · Read again' : 'वाचलं · I’ve read this'}</button><p class="task-hint" lang="en">${counted.includes(story.id) ? 'Already counted this season. Reading again adds no extra light.' : readBefore.has(story.id) ? `Reading saved here. Seasonal counting runs ${e(seasonDates(season).start)}–${e(seasonDates(season).end)}; earlier reading is not backdated.` : 'An explicit read here counts just like a ride-card story, during the season.'}</p>${story.appliedContributions.length ? '<p class="badge">वाचकाच्या सूचनेतून सुधारलेली · Includes a published contribution</p>' : ''}</div></details>`).join('');
}

function statusMarkup(instance, packet = matchingPacket(instance,state.outbox)) {
  const {stage,receipt,stale} = statusOf(packet), words = stageWords[stage];
  return `<div class="contribution-status" data-stage="${stage}"><strong>${e(words[0])}</strong><span lang="en">${e(words[1])}${receipt?.publishedVersion ? ` · version ${receipt.publishedVersion}` : ''}</span>${receipt ? `<small lang="en">${e(receipt.reviewerName)} · ${e(localTime(receipt.reviewedAt))}${TEST_MODE ? ' · TEST ONLY' : ''}</small>` : ''}<ol class="status-steps" aria-label="Contribution progress"><li class="done">Saved</li><li class="${packet ? 'done' : ''}">${packet ? 'Ready to share ✓' : 'File not prepared'}</li><li class="${receipt ? 'done' : ''}">${receipt ? 'Decision received ✓' : 'Decision not received'}</li></ol>${stale && !receipt ? `<p class="task-hint">कथा बदलली आहे. तुमचा आधीचा मसुदा जपला आहे.<br><span lang="en">The story has changed; keep your draft and compare it with the latest wording.</span></p><button type="button" class="secondary-button" data-revise="${e(packet.hash)}">नवीन मजकुरासोबत सूचना सुधारा · Update suggestion</button>` : ''}</div>`;
}
function packetActions(packet) {
  const {stage} = statusOf(packet);
  return `<div class="packet-actions"><button class="secondary-button" type="button" data-redownload="${e(packet.hash)}">फाइल पुन्हा डाउनलोड करा · Download again</button>${['ready','handed-over'].includes(stage) ? `<button class="text-button" type="button" data-share-info="${e(packet.hash)}">कुठे द्यायची? · How to hand it over</button>${stage === 'ready' ? `<button class="text-button" type="button" data-handed-over="${e(packet.hash)}">मी फाइल दिली आहे · I’ve handed it over</button>` : '<p class="task-hint" lang="en">Your handoff is recorded on this device. A reviewer’s decision has not arrived in the available publication.</p>'}` : `<a href="#${e(packet.storyId)}" class="text-button">कथा पाहा · Read the story →</a>`}</div>`;
}
function formMarkup(ride,instance,task) {
  const saved = inputOf(instance), id = name => e(`${instance.id}-${name}`);
  let fields;
  if(instance.kind === 'learn') {
    fields = `${task.format === 'quiz' ? `<details class="quiz-answer"><summary>उत्तर पाहा · Reveal answer</summary><p>${e(task.answer_mr)}</p><p lang="en">${e(task.answer_en)}</p></details>` : ''}<button class="task-button" type="submit"><span>वाचलं<small lang="en">I’ve read this</small></span><span aria-hidden="true">✓</span></button>`;
  } else if(instance.kind === 'give' && task.format === 'choice') {
    fields = `<div class="title-choices" role="group" aria-label="Choose a clearer title">${task.choices.map(choice => `<button type="button" class="secondary-button title-choice" data-title-choice="${choice.value}" data-instance="${e(instance.id)}"><b>${choice.value.toUpperCase()}</b><span>${e(choice.mr)}<small lang="en">${e(choice.en)}</small></span></button>`).join('')}</div><p class="task-hint" lang="en">Your preference stays in your notebook. It is not a published edit.</p>`;
  } else if(instance.kind === 'give') {
    const original = instance.originalText || [...tasks,...legacyTasks].find(item => item.id === task.source_task_id)?.body_mr || '';
    const mode = saved.editMode || (task.focusText ? 'sentence' : 'whole');
    const excerpt = mode === 'sentence' && task.focusText ? task.focusText : original;
    const oldPacket = task.revisionOf ? packetByHash(task.revisionOf.hash) : null;
    fields = `${oldPacket ? `<div class="revision-compare"><h4>नवीन मजकूर · Latest wording (v${instance.storyVersion})</h4><p>${e(original)}</p><details><summary>आधीचा मजकूर · Earlier wording</summary><p>${e(oldPacket.originalText)}</p></details><p class="task-hint" lang="en">Your earlier suggestion is copied into the field below. Compare it, make any needed changes, then save a new draft. The earlier file remains in your notebook.</p></div>` : ''}${task.format === 'translate' ? `<blockquote class="source-text"><small lang="en">ENGLISH SENTENCE</small>${e(firstSentence(task.storyBody_en || ''))}</blockquote>` : ''}<blockquote class="source-text"><small lang="en">${mode === 'sentence' ? 'ONE SENTENCE TO IMPROVE' : instance.targetField === 'title_mr' ? 'CURRENT TITLE' : 'CURRENT WORDING'} · v${instance.storyVersion || 'legacy'}</small>${e(excerpt)}</blockquote><input type="hidden" name="editMode" value="${e(mode)}"><label for="${id('text')}">${instance.targetField === 'title_mr' ? 'लहान, स्पष्ट शीर्षक सुचवा' : mode === 'sentence' ? 'हे एक वाक्य सोपं करा' : 'तुमची सुधारलेली सूचना'}<small lang="en">${instance.targetField === 'title_mr' ? 'Suggest a shorter, clearer title' : mode === 'sentence' ? 'Make this one sentence clearer' : 'Your revised wording'}</small></label><textarea id="${id('text')}" name="text" maxlength="${instance.targetField === 'title_mr' ? 160 : 2000}" required placeholder="तुमच्या शब्दांत लिहा…">${e(saved.text || '')}</textarea><div class="draft-tools"><button type="button" class="text-button" data-use-original="${e(instance.id)}">सध्याचं वाक्य घेऊन सुरुवात करा · Start from current wording</button>${task.focusText && mode === 'sentence' ? `<button class="text-button" type="button" data-edit-whole="${e(instance.id)}">पूर्ण परिच्छेद संपादित करा · Edit the whole passage</button>` : ''}</div><p class="task-hint" lang="en">${mode === 'sentence' && task.focusText ? 'The rest of the passage stays intact. ' : ''}Names, dates, and meaning should stay accurate. Saving keeps the suggestion on this device.</p><button class="task-button" type="submit"><span>सूचना जतन करा<small lang="en">Save suggestion</small></span><span aria-hidden="true">＋</span></button>`;
  } else {
    const selected = saved.stationId || ride.to, routeIds = ride.routeStationIds || [ride.from,ride.to];
    fields = `<p class="station-question">कुठल्या स्थानकात पाहिलं? <small lang="en">Where did you notice this?</small></p><label class="sr-only" for="${id('station')}">निरीक्षणाचं स्थानक · Observation station</label><select id="${id('station')}" name="stationId" class="observation-station"><option value="">स्थानक निवडा · Choose a station</option>${routeIds.map(stationId => `<option value="${e(stationId)}" ${stationId === selected ? 'selected' : ''}>${e(station(stationId).name_mr)} · ${e(station(stationId).name_en)}</option>`).join('')}</select><div class="quick-answers" role="group" aria-label="What did you observe?">${task.answerOptions.map(answer => `<button type="button" class="quick-answer" data-check-answer="${answer.value}" data-instance="${e(instance.id)}" ${!selected && answer.value !== 'not_observed' ? 'disabled' : ''}><span>${e(answer.label_mr)}</span><small lang="en">${e(answer.label_en)}</small></button>`).join('')}</div><p class="task-hint" lang="en">Only answer if you directly saw it while safely at the station. Otherwise, skip.</p><details class="check-details"><summary>जागा किंवा आधीची वेळ जोडा · Add details</summary><p class="task-hint" lang="en">${e(task.body_en)} Station-only notes remain unverified; no particular fixture is identified.</p><label for="${id('location')}">नेमकी जागा <small lang="en">Optional location note</small></label><input id="${id('location')}" name="location" maxlength="160" value="${e(saved.location || '')}" placeholder="फलकावरचं नाव · As signed"><label for="${id('time')}">आधीची वेळ <small lang="en">Earlier observation time · IST</small></label><input id="${id('time')}" type="datetime-local" name="observedAt" value="${e(saved.observedAt || '')}"><p class="task-hint" lang="en">Leave blank to use the time you tap the answer.</p><label for="${id('note')}">अजून काही? <small lang="en">Optional note</small></label><textarea class="note-field" id="${id('note')}" name="note" maxlength="1000">${e(saved.note || '')}</textarea></details>`;
  }
  return `<form class="task-form ${instance.kind === 'check' ? 'quick-check-form' : ''}" data-task-form="${e(instance.id)}">${fields}<p class="field-error" role="alert"></p></form>`;
}
function completedMarkup(instance,task) {
  const result = instance.result;
  if(instance.kind === 'learn') return '<p class="completed-note">✓ वाचलं · Read</p>';
  const edit = `<button class="text-button" type="button" data-edit="${e(instance.id)}">बदला · Edit</button>`;
  if(instance.kind === 'give') {
    if(task.format === 'choice') return `<p class="completed-note">✓ पसंती जतन केली · Choice saved here</p><p class="saved-result">${e(result.text)}</p>${edit}`;
    return `<p class="saved-result">${e(result.text)}</p><p class="task-hint" lang="en">Your earlier suggestion is kept here and in your notebook download.</p>${edit}`;

  }
  const answer = task.answerOptions.find(item => item.value === result.answer);
  return `<div class="saved-confirmation" id="saved-${e(instance.id)}" tabindex="-1"><p class="completed-note">${instance.status === 'skipped' ? '— पाहिलं नाही · No observation saved' : '✓ या फोनवर नोंद जतन केली · Saved here'}</p>${instance.status === 'skipped' ? '' : `<p class="saved-result"><strong>${e(station(result.stationId).name_mr)} · ${e(answer?.label_mr || result.answer)}</strong></p><p class="result-meta" lang="en">${e(localTime(result.observedAt))}<br>${result.scope === 'station' ? 'Station-level note · fixture unknown' : 'Location note: '+e(result.location)} · Unverified</p>${result.note ? `<p>${e(result.note)}</p>` : ''}`}${edit}<button class="text-button undo-button" type="button" data-undo="${e(instance.id)}">मागे घ्या · Undo</button></div>`;
}
function swapMarkup(ride,instance) {
  if(instance.kind !== 'learn' || instance.status !== 'pending') return '';
  const alternatives = taskPool(ride).filter(task => task.kind === 'learn' && task.format === 'story' && !ride.tasks.some(item => item.id !== instance.id && item.taskId === task.id));
  return `<label class="story-selector"><span aria-hidden="true">↻</span><select data-story-select="${e(instance.id)}" aria-label="Choose another story" ${hasWriting(instance) ? 'disabled' : ''}>${alternatives.map(task => `<option value="${e(task.id)}" ${task.id === instance.taskId ? 'selected' : ''}>${e(station(task.station_ids?.[0]).name_mr)} · ${e(task.title_en)}</option>`).join('')}</select></label>`;
}
function selectStory(id, selected) {
  const ride = rideNow(), instance = ride?.tasks.find(task => task.id === id);
  const replacement = tasks.find(task => task.id === selected && task.kind === 'learn' && task.format === 'story');
  if(!ride || !instance || !replacement || instance.taskId === selected) return;
  if(hasWriting(instance)) throw new Error('Save your unfinished writing first.');
  const result = swapCoherently(ride,id,replacement,tasks,state.forms);
  const give = ride.tasks.find(task => task.kind === 'give' && task.contentSnapshot?.format === 'choice');
  const story = catalog.stories.find(story => story.id === replacement.storyId);
  if(give?.status === 'pending' && story) result.ride = swapTask(result.ride,give.id,choiceTask(story));
  state.rides = state.rides.map(item => item.id === ride.id ? result.ride : item);
  result.changed.forEach(key => { delete state.forms[key]; });
  persist(); render();
  document.querySelector('[data-story-select]')?.focus({preventScroll:true});
}
const playMove = (button, action) => runFormAction(button,action,{reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches});
let stampingRideId = null, stampingBusy = false;
const stampDate = ride => new Date(ride.stamp.awardedAt).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}).toUpperCase();
function stampReplicas(ride, prefix, limit = 6) {
  const count = impressionCount(ride);
  return Array.from({length:Math.min(count,limit)},(_,index) => `<span class="stamp-replica">${sealMarkup(`${prefix}-${index}`,stampDate(ride))}</span>`).join('');
}
function laterReads(ride) {
  if(!ride?.stamp) return 0;
  const after = Date.parse(ride.stamp.awardedAt), next = state.rides.map(item => Date.parse(item.createdAt)).filter(time => time > after).sort((a,b) => a-b)[0] ?? Infinity;
  return new Set(state.storyReads.filter(read => { const time = Date.parse(read.readAt); return time > after && time < next; }).map(read => read.storyId)).size;
}
const earnedFor = ride => earnedImpressions(ride,{laterReads:laterReads(ride)});
const aiCard = ride => aiSessionUnlocked(ride) ? `<div class="ai-session"><p class="eyebrow" lang="en">SPECIAL MILESTONE</p><strong>विशेष संधी · AI for ALL</strong><p>तुम्ही ${impressionCount(ride)} शिक्के मिळवले! मोफत सत्रात सहभागी व्हा. <span lang="en">You earned ${impressionCount(ride)} stamps on this ride. Join an AI for ALL session.</span></p><a class="primary-button" href="${AI_SESSION_URL}" target="_blank" rel="noopener noreferrer">सत्रात सहभागी व्हा · Join AI for ALL ↗</a></div>` : '';
function renderStampPaper() {
  const ride = state.rides.find(item => item.id === stampingRideId); if(!ride?.stamp) return;
  const count = impressionCount(ride), earned = earnedFor(ride), open = canStamp(ride,earned);
  $('#press-stamp').disabled = !open;
  $('#stamp-earn').innerHTML = open ? '' : `<strong>पुढचा शिक्का कमवा · Earn your next stamp</strong><span lang="en">Read another story, invite a co-rider, or finish one more activity. ${Math.max(0,AI_SESSION_THRESHOLD-count) ? `${AI_SESSION_THRESHOLD-count} more to unlock AI for ALL.` : ''}</span>`;
  $('#stamp-ai').innerHTML = aiCard(ride);
  $('#stamp-paper').innerHTML = count ? stampReplicas(ride,'popup',6) : '<span class="stamp-empty" aria-hidden="true">＋</span>';
  $('#stamp-count').textContent = count;
  $('#stamp-action-label').textContent = count ? 'आणखी एक शिक्का · Stamp again' : 'शिक्का मारा · Stamp my ride';
  $('#stamp-status').textContent = count ? `${count} ${count === 1 ? 'impression' : 'impressions'} · One participation award` : 'Your ride is complete.';
}
function openStamp(id) {
  const ride = state.rides.find(item => item.id === id); if(!ride?.stamp) return;
  stampingRideId = id; renderStampPaper();
  $('#stamp-route').textContent = `${station(ride.from).name_en} → ${station(ride.to).name_en}`;
  $('#stamp-cycle').hidden = !fullCycle(ride);
  if(!$('#stamp-dialog').open) $('#stamp-dialog').showModal();
}
async function pressStamp() {
  if(stampingBusy) return;
  const ride = state.rides.find(item => item.id === stampingRideId); if(!ride?.stamp) return;
  stampingBusy = true; $('#press-stamp').disabled = true;
  $('#stamp-dialog').classList.add('is-pressing');
  try {
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise(resolve => setTimeout(resolve,260));
    const updated = addImpression(ride,earnedFor(ride));
    state.rides = state.rides.map(item => item.id === ride.id ? updated : item);
    const saved = persist(); render(); renderStampPaper();
    $('#stamp-paper').lastElementChild?.classList.add('fresh-impression');
    $('#stamp-status').textContent = `${impressionCount(updated)} / ${earnedFor(updated)} earned · ${saved ? 'Saved on this device' : 'Not saved; download your notebook'}`;
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise(resolve => setTimeout(resolve,420));
  } finally { stampingBusy = false; $('#stamp-dialog').classList.remove('is-pressing'); renderStampPaper(); }
}
function renderTask(ride,instance) {
  const task = contentOf(instance);
  if(!task) return '<p class="warning">This older activity is unavailable. Its saved result remains in your notebook download.</p>';
  const kind = kinds[instance.kind], resolved = instance.status !== 'pending' && !editing.has(instance.id);
  const learn = ride.tasks.find(item => item.kind === 'learn' && !item.optional);
  const mismatch = instance.kind === 'give' && !instance.optional && instance.status === 'pending' && learn?.storyId && learn.storyId !== instance.storyId;
  const currentStory = catalog.stories.find(item => item.id === instance.storyId);
  const checkLimit = instance.kind === 'check' ? ({water:'पाण्याच्या गुणवत्तेचा अंदाज नको · Operation only, not water quality.',ramp:'फक्त दिसणारा अडथळा · Visible obstruction only; accessibility is not assessed.',lighting:'बाहेर अंधार असेल तेव्हाच · Answer only if it is actually dark.'})[instance.feature] : '';
  const description = instance.kind === 'check' ? `<p class="task-body">${e(task.body_mr)}</p><p class="task-hint" lang="en">${e(task.body_en)}</p>` : `<p class="task-body">${e(task.body_mr)}</p><details class="english"><summary lang="en">English</summary><p>${e(task.body_en)}</p></details>${sourceLinks(task.sources)}`;
  return `<article class="task-card" data-kind="${instance.kind}" aria-labelledby="heading-${e(instance.id)}"><div class="task-label"><strong><span class="task-label-icon" aria-hidden="true">${kind.icon}</span>${kind.mr} / <span lang="en">${kind.en}</span></strong>${swapMarkup(ride,instance)}<small lang="en">${task.format === 'choice' ? '5 SEC' : `${instance.optional ? 'OPTIONAL · ' : ''}~${task.minutes || 1} MIN`}</small></div><h2 id="heading-${e(instance.id)}" tabindex="-1">${e(task.title_mr)}</h2><p class="task-title-en" lang="en">${e(task.title_en)}</p>${checkLimit && !resolved ? `<p class="task-hint notice-limit">${e(checkLimit)}</p>` : ''}${mismatch ? `<div class="coherence-note"><p lang="en">This saved writing is about ${e(currentStory?.title_en || 'another story')}. It is kept safely.</p><button type="button" class="secondary-button" data-match-give="${e(instance.id)}">हा मसुदा जपून जुळणारी कृती निवडा · Keep draft and use a matching task</button></div>` : ''}${!resolved ? `${description}${formMarkup(ride,instance,task)}` : `${instance.kind === 'learn' ? description : ''}${completedMarkup(instance,task)}`}</article>`;
}
function activeTask(ride) {
  return ride.tasks.find(task => task.id === selectedTasks.get(ride.id)) || ride.tasks.find(task => task.id === state.currentTaskId) || ride.tasks.find(task => !task.optional && task.status === 'pending') || ride.tasks.find(task => task.status === 'pending' && task.contentSnapshot?.revisionOf) || ride.tasks.find(task => !task.optional) || ride.tasks[0];
}
function atlasChoice(ride, kind, stationId, view = 'line') {
  const story = stationStories(catalog, stationId)[0];
  const pending = ride.tasks.filter(item => item.kind === kind && item.status === 'pending');
  const available = taskPool(ride).filter(item => item.kind === kind && !ride.tasks.some(saved => saved.taskId === item.id));
  if (kind === 'give' && story) {
    const instance = pending.find(item => item.storyId === story.id);
    if (instance) return { instance };
    const task = available.find(item => item.storyId === story.id);
    if (task) return { task };
    return null;
  }
  if (kind === 'check') {
    const preference = view === 'exit' ? ['lighting','ramp','water','lift'] : ['lift','ramp','water','lighting'];
    for (const feature of preference) {
      const instance = pending.find(item => item.feature === feature);
      if (instance) return { instance };
      const task = available.find(item => item.feature === feature);
      if (task) return { task };
    }
  }
  return pending.length ? { instance: pending[0] } : available.length ? { task: available[0] } : null;
}
function renderAtlas() {
  const ride = rideNow(); if (!ride || showBuilder) return;
  const selectedStationId = atlasStations.get(ride.id) || ride.from;
  const view = atlasViews.get(ride.id) || 'line';
  $('#ride-atlas').innerHTML = renderWayfinding({
    ride, stations, catalog, rides: state.rides, selectedStationId, view,
    canCheck: Boolean(atlasChoice(ride,'check',selectedStationId,view)),
    canGive: Boolean(atlasChoice(ride,'give',selectedStationId,view)),
  });
}
function renderMetroTimeline(ride) {
  const route = ride.routeStationIds || getRouteStationIds(stations, ride.from, ride.to);
  const active = activeTask(ride)?.id;
  return `<section class="metro-timeline" aria-labelledby="metro-timeline-title">
    <div class="metro-timeline-heading"><div><p class="eyebrow" lang="en">YOUR ROUTE</p><h2 id="metro-timeline-title">मेट्रोचा प्रवास <small lang="en">Metro map</small></h2></div><span>${route.length - 1} <small lang="en">stops</small></span></div>
    <ol class="metro-line" aria-label="Stations on this ride">${route.map((id, index) => `<li class="${id === ride.from || id === ride.to ? 'endpoint' : ''} ${index === 0 ? 'current' : ''}"><span class="metro-node" aria-hidden="true"></span><span class="metro-station"><strong>${e(station(id).name_mr)}</strong><small lang="en">${e(station(id).name_en)}</small></span>${index < route.length - 1 ? '<span class="metro-connector" aria-hidden="true"></span>' : ''}</li>`).join('')}</ol>
    <p class="metro-timeline-note" lang="en">Tap a ride step above to keep the activity in focus. The map is a quiet route reference.</p>
  </section>`;
}
function openAtlasAction(kind) {
  const ride = rideNow(), selectedStationId = atlasStations.get(ride.id) || ride.from;
  const choice = atlasChoice(ride,kind,selectedStationId,atlasViews.get(ride.id) || 'line');
  if (!choice) return;
  let instance = choice.instance;
  if (choice.task) {
    const updated = addOptionalTask(ride,choice.task);
    instance = updated.tasks.at(-1);
    state.rides = state.rides.map(item => item.id === ride.id ? updated : item);
  }
  if (kind === 'check') state.forms[instance.id] = { ...state.forms[instance.id], stationId:selectedStationId };
  persist(); showTask(instance.id);
}
function renderActive() {
  const ride = rideNow(), visible = Boolean(ride) && !showBuilder;
  $('#journey').classList.toggle('is-active',visible);
  $('#ride-builder').hidden = !showBuilder; $('#active-ride').hidden = !visible; $('#resume-ride').hidden = !ride || !showBuilder;
  if(!visible) return;
  const current = activeTask(ride), required = ride.tasks.filter(task => !task.optional);
  const social = current.kind === 'learn' ? ['ही गोष्ट आधी ऐकली होती का?', 'Heard this story before?'] : current.kind === 'give' ? ['तुम्हाला कोणतं आवडतं? एकमेकांना विचारा.', 'Which do you prefer? Compare with each other.'] : ['तुमच्या नेहमीच्या वाटेवर काय दिसलं?', 'What did you notice on your usual route?'];
  $('#active-ride').innerHTML = `<div class="ride-heading"><div><p class="eyebrow" lang="en">PUNE METRO / ${e(routeLabel(ride))}</p><h1 id="active-title" tabindex="-1">तुमची छोटी सफर</h1></div><button type="button" class="text-button" data-new-ride>↺ नवा प्रवास · New ride</button></div><div class="route-summary"><div><strong>${e(station(ride.from).name_mr)} → ${e(station(ride.to).name_mr)}</strong><small lang="en">${e(station(ride.from).name_en)} → ${e(station(ride.to).name_en)} · ${ride.stopCount} ${ride.stopCount === 1 ? 'stop' : 'stops'}</small></div><button class="secondary-button" type="button" data-together>▦ सोबत सफर <small lang="en">Ride together</small></button></div><nav class="activity-steps" aria-label="Ride activities">${required.map((task,index) => `<button class="step-button" type="button" data-status="${task.status}" data-focus-task="${e(task.id)}" aria-pressed="${task.id === current.id}"><span aria-hidden="true">${task.status === 'pending' ? index+1 : task.status === 'skipped' ? '—' : '✓'}</span><strong>${kinds[task.kind].mr}<small lang="en">${kinds[task.kind].en}</small></strong></button>`).join('')}</nav>${renderMetroTimeline(ride)}${ride.stamp ? `<div class="stamp-banner"><span class="ride-seal">${impressionCount(ride) ? sealMarkup('ride-seal',stampDate(ride)) : '<span class="uninked-seal" aria-hidden="true">◎</span>'}</span><div><h3>सफर पूर्ण झाली!</h3><p lang="en">${impressionCount(ride)} ink impressions · One participation award</p><button class="secondary-button" type="button" data-open-stamp="${e(ride.id)}">शिक्का मारा · Stamp my ride</button></div></div>` : ''}${renderTask(ride,current)}<aside class="conversation-prompt"><span aria-hidden="true">↗</span><strong>${social[0]}</strong><small lang="en">${social[1]}</small><small lang="en">Only if they’d like to talk. A quiet ride counts too.</small></aside>`;
}

function openTogether() {
  let ride = rideNow(); if(!ride) return;
  const url = invitationURL(location.href,ride), code = qrcode(0,'M');
  code.addData(url); code.make();
  $('#together-code').innerHTML = code.createSvgTag({ cellSize:4, margin:16, scalable:true });
  $('#together-link').value = url;
  $('#together-route').textContent = `${station(ride.from).name_en} → ${station(ride.to).name_en}`;
  $('#together-dialog .dialog-feedback').textContent = '';
  $('#together-dialog').dataset.rideId = ride.id;
  $('#together-dialog').showModal();
}

function recordInvitation() {
  const ride = state.rides.find(item => item.id === $('#together-dialog').dataset.rideId);
  if(!ride?.stamp || ride.stamp.invited) return;
  state.rides = state.rides.map(item => item.id === ride.id ? markInvited(item) : item);
  persist(); render();
}

// Shared season totals: this device reports only its own new counts as anonymous +n bumps.
const PULSE_KEY = 'safar-seva-pulse-reported', PULSE_URL = '/api/public/pulse';
let pulse = null, pulseBusy = false, pulseTimer;
function localPulse() {
  const stats = getLedgerStats(state.rides);
  return {participants:stats.completedRides,observations:stats.observations,contributions:stats.drafts,groups:state.rides.filter(ride => ride.stamp?.invited).length};
}
async function syncPulse() {
  if(pulseBusy || TEST_MODE || !navigator.onLine) return; pulseBusy = true;
  try {
    let reported = {}; try { reported = JSON.parse(localStorage.getItem(PULSE_KEY)) || {}; } catch {}
    for(const [metric,value] of Object.entries(localPulse())) {
      let delta = value - (reported[metric] || 0);
      while(delta > 0) {
        const n = Math.min(delta,5);
        const response = await fetch(PULSE_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({metric,n})});
        if(!response.ok) throw new Error('pulse');
        pulse = await response.json(); reported[metric] = (reported[metric] || 0) + n; delta -= n;
        try { localStorage.setItem(PULSE_KEY,JSON.stringify(reported)); } catch {}
      }
    }
    const response = await fetch(PULSE_URL,{cache:'no-store'}); if(response.ok) pulse = await response.json();
  } catch {} finally { pulseBusy = false; renderLiveStats(false); }
}
function renderLiveStats(sync = true) {
  if(sync) { clearTimeout(pulseTimer); pulseTimer = setTimeout(syncPulse,400); }
  const base = season.liveBaseline || {}, stats = getLedgerStats(state.rides);
  const live = key => pulse && Number.isFinite(pulse[key]) ? pulse[key] : (base[key]||0) + localPulse()[key];
  const values = [[live('participants'),stats.completedRides,'सहप्रवासी','Riders'],[live('observations'),stats.observations,'निरीक्षणे','Notes'],[live('contributions'),stats.drafts,'शब्द पर्याय','Choices'],[live('groups'),state.rides.filter(ride => ride.stamp?.invited).length,'एकत्र सफर','Groups']];
  const bar = $('#live-stats'), old = [...bar.querySelectorAll('.live-number')].map(node => node.textContent);
  const signature = JSON.stringify({values,live:Boolean(pulse),online:navigator.onLine});
  if(bar.dataset.signature === signature) return;
  bar.dataset.signature = signature; bar.dataset.live = Boolean(pulse);
  bar.innerHTML = `<span class="live-dot" aria-hidden="true"></span>${values.map(([all,mine,mr,en],i) => `<div class="live-stat"><span class="live-number ${old[i] !== undefined && old[i] !== String(all) ? 'bumped' : ''}">${all}</span>${mine ? `<span class="live-mine" title="From this device">+${mine}</span>` : ''}<span class="live-label">${mr}<small lang="en">${en}</small></span></div>`).join('')}<p class="live-legend" lang="en">${TEST_MODE ? 'Practice session · sample season totals' : pulse ? 'Live season totals' : navigator.onLine ? 'Saved season baseline · live totals unavailable' : 'Offline · saved season baseline'} · <span class="live-mine">+n</span> from this device</p>`;
}
function renderNotebook() {
  const stats = getLedgerStats(state.rides); $('#nav-count').textContent = stats.completedRides;
  $('#ledger-stats').innerHTML = [[stats.completedRides,'सहभागाचे शिक्के','Participation stamps'],[stats.drafts,'पसंती आणि सूचना','Choices & suggestions'],[stats.observations,'वेळेसह नोंदी','Dated notes · unverified']].map(([n,mr,en]) => `<div class="stat"><span class="stat-number">${n}</span><div class="stat-description">${mr}<small lang="en">${en}</small></div></div>`).join('');
  $('#ledger-rides').innerHTML = state.rides.length ? [...state.rides].reverse().map(ride => `<div class="ledger-ride"><div><strong>${e(station(ride.from).name_mr)} → ${e(station(ride.to).name_mr)}</strong><small lang="en">${e(localTime(ride.createdAt))} · ${ride.stamp ? `${impressionCount(ride)} ink impressions · Participation award` : 'In progress'}</small></div>${ride.stamp ? `<button class="notebook-stamp" type="button" data-open-stamp="${e(ride.id)}" aria-label="Open stamps for ${e(station(ride.from).name_en)} to ${e(station(ride.to).name_en)}"><span class="notebook-replicas">${stampReplicas(ride,`notebook-${state.rides.indexOf(ride)}`,3) || '<span aria-hidden="true">◎</span>'}</span><span class="replica-count">×${impressionCount(ride)}</span></button>` : ''}${aiSessionUnlocked(ride) ? `<a class="ai-badge" href="${AI_SESSION_URL}" target="_blank" rel="noopener noreferrer">AI for ALL ↗</a>` : ''}<button class="text-button" type="button" data-resume="${e(ride.id)}">${ride.stamp ? 'पाहा · View' : 'पुढे सुरू करा · Resume'}</button></div>`).join('') : '<div class="empty-ledger"><p>पहिल्या प्रवासापासून सुरुवात करूया.<span lang="en">Your notebook starts with your first ride.</span></p></div>';
  const {observations} = makeExport(state.rides);
  $('#observation-history').innerHTML = observations.length ? `<details class="observation-history"><summary>निरीक्षणांच्या नोंदी · Dated notes (${observations.length})</summary><p class="task-hint" lang="en">These notes may describe different fixtures and times. They are not a verified live station status.</p>${[...observations].reverse().map(item => `<div class="observation-record"><strong>${e(station(item.stationId).name_mr)} · ${e(item.location || 'Station-level note')}</strong><p>${e(item.feature)} · ${e(item.answer)}</p><small>${e(localTime(item.observedAt))} · Unverified</small></div>`).join('')}</details>` : '';
  const drafts = state.rides.flatMap(ride => ride.tasks.filter(task => task.kind === 'give' && task.status === 'completed').map(task => `<div class="ledger-ride"><div><strong>${e(task.result.text)}</strong><small lang="en">${task.contentSnapshot?.format === 'choice' ? 'Title preference · saved here' : 'Earlier suggestion · kept here'} · ${e(localTime(task.completedAt || ride.createdAt))}</small></div><button class="text-button" data-open-draft="${e(task.id)}">पाहा · View</button></div>`));
  $('#review-status').innerHTML = drafts.reverse().join('') || '<p class="ledger-context">अजून पसंती नाही · No choices yet.</p>';

}
function render() { renderActive(); renderYatra(); renderNotebook(); renderStories(); renderLiveStats(); }
function showTask(id,{scroll = true} = {}) {
  const ride = state.rides.find(item => item.tasks.some(task => task.id === id)); if(!ride) return;
  state.currentRideId = ride.id; state.currentTaskId = id; showBuilder = false; selectedTasks.set(ride.id,id); persist(); render();
  if(scroll) document.getElementById(`heading-${id}`)?.focus();
}
function openRide(id) {
  const ride = state.rides.find(item => item.id === id); if(!ride) return;
  state.currentRideId = id; state.currentTaskId = activeTask(ride).id; showBuilder = false; persist(); render(); $('#active-title').focus();
}
function saveInput(form) {
  state.forms[form.dataset.taskForm] = Object.fromEntries(new FormData(form)); persist();
}
function commitTask(instance,result) {
  const ride = rideNow(), updated = completeTask(ride,instance.id,result);
  state.rides = state.rides.map(item => item.id === ride.id ? updated : item);
  delete state.forms[instance.id]; editing.delete(instance.id);
  const next = updated.tasks.find(task => !task.optional && task.status === 'pending');
  const selected = next ? next.id : instance.id;
  selectedTasks.set(ride.id,selected); state.currentTaskId = selected;
  if(!ride.stamp && updated.stamp) updated.stamp.impressions = 0;
  const saved = persist(); render();
  const target = `heading-${activeTask(updated).id}`;
  if(!ride.stamp && updated.stamp) openStamp(updated.id);
  else document.getElementById(target)?.focus();
  toast(saved ? `${kinds[instance.kind].mr}: जतन केलं. Saved here.${!ride.stamp && updated.stamp ? ' Participation stamp saved.' : ''}` : 'Download your work before closing: device storage is unavailable.');
}
function exportNotebook() {
  const data = {...makeExport(state.rides),appVersion:globalThis.SAFAR_RELEASE,scope:TEST_MODE ? 'test-session-do-not-publish' : 'this-device-only',outbox:state.outbox,storyReads:state.storyReads,handoffs:state.handoffs,unfinishedInputs:state.forms,currentRideId:state.currentRideId,currentTaskId:state.currentTaskId,...(unreadableSave ? {unreadablePreviousSave:unreadableSave} : {})};
  $('#export-json').value = downloadJSON(data,`safar-seva-${TEST_MODE ? 'TEST-' : ''}notebook-${istInput().slice(0,10)}.json`);
  $('#export-preview').hidden = false; $('#export-preview').open = false;
  toast('वही डाउनलोडसाठी तयार आहे. Notebook download ready.');
}
async function getJSON(file) { const response = await fetch(file,{cache:'no-store'}); if(!response.ok) throw new Error(`Could not load ${file}`); return response.json(); }
async function readPublication() {
  const base = validateCatalog(await getJSON('./stories.json')); if(!TEST_MODE) return base;
  const test = await getJSON('./test-publication.json');
  return validateCatalog(test.sessions && Object.hasOwn(test.sessions,TEST_SESSION) ? test.sessions[TEST_SESSION] : base);
}
async function refreshPublication() { catalog = await readPublication(); tasks = hydrateTasks(taskData.tasks,catalog); render(); if(shareHash && !$('#share-panel').hidden) showShare(packetByHash(shareHash),{focus:false}); }
function showShare(packet,{download = false,focus = true} = {}) {
  shareHash = packet.hash;
  if(download) downloadJSON(packet,`safar-seva-${TEST_MODE ? 'TEST-' : ''}contribution-${packet.hash.slice(0,10)}.json`);
  $('#share-panel').hidden = false;
  $('#share-panel').innerHTML = `<h3 id="share-title" tabindex="-1">शेअर करण्यासाठी फाइल तयार आहे</h3><p lang="en">Your contribution file is ready. It contains your suggested wording and the story version; your journeys and station notes stay here.</p><ol class="handoff-instructions"><li>फाइल डाउनलोड करा. <span lang="en">Download the contribution file.</span></li><li>पायलटच्या आयोजकांनी सांगितलेल्या LOFL संपादकाला ती द्या. <span lang="en">Give it to the LOFL reviewer named by your pilot organiser, using your agreed channel.</span></li><li>निर्णय आला का हे नंतर वहीत तपासा. <span lang="en">Check your notebook later for the published decision.</span></li></ol><p class="handoff-honesty" lang="en">This demo has no automatic inbox. If no reviewer or channel has been agreed, keep the file here. “I’ve handed it over” records your action on this device; it does not confirm delivery.</p>${packetActions(packet)}<details id="contribution-preview" class="export-preview"><summary>डाउनलोड झालं नाही? मजकूर कॉपी करा · Download trouble?</summary><label class="sr-only" for="contribution-json">Contribution-only JSON</label><textarea id="contribution-json" readonly spellcheck="false">${e(JSON.stringify(packet,null,2))}</textarea></details>`;
  if(focus) $('#share-title').focus();
}
async function prepareContribution(id) {
  const ride = rideNow(), instance = ride.tasks.find(task => task.id === id);
  const permission = [...document.querySelectorAll('[data-permission]')].find(input => input.dataset.permission === id)?.checked;
  const packet = await createContribution(ride,instance,{permission,testSession:TEST_SESSION});
  if(!state.outbox.some(item => item.id === packet.id && item.hash === packet.hash)) state.outbox.push(packet);
  persist(); render(); showShare(packet,{download:true});
  toast('फाइल तयार केली. Downloading does not send it to a reviewer.');
}
function revisePacket(packet) {
  const story = catalog.stories.find(item => item.id === packet.storyId);
  const ride = state.rides.find(item => item.tasks.some(task => `contribution:${task.id}` === packet.id));
  if(!ride || !story) throw new Error('Open the original suggestion on this device to update it.');
  const existing = ride.tasks.find(task => task.status === 'pending' && task.storyVersion === story.version && task.contentSnapshot?.revisionOf?.hash === packet.hash);
  if(existing) { showTask(existing.id); return; }
  const template = tasks.find(task => task.kind === 'give' && task.storyId === story.id && task.targetField === packet.field) || tasks.find(task => task.kind === 'give');
  const updated = startRevision(ride,packet,story,template), revision = updated.tasks.at(-1);
  state.rides = state.rides.map(item => item.id === ride.id ? updated : item);
  state.forms[revision.id] = {text:packet.suggestedText,editMode:'whole'};
  persist(); showTask(revision.id); toast('आधीचा मसुदा जपला आहे. Your earlier draft and receipt are kept.');
}
function matchGiving(id) {
  const ride = rideNow(), old = ride.tasks.find(task => task.id === id), learn = ride.tasks.find(task => task.kind === 'learn' && !task.optional);
  const match = tasks.find(task => task.kind === 'give' && task.storyId === learn?.storyId && !ride.tasks.some(item => item.taskId === task.id));
  if(!match || old.status !== 'pending') throw new Error('Choose another giving activity from the activity list.');
  const updated = matchGivingPreservingDraft(ride,old.id,match);
  const added = updated.tasks.find(task => task.taskId === match.id);
  state.rides = state.rides.map(item => item.id === ride.id ? updated : item);
  persist(); showTask(added.id); toast('तुमचं आधीचं लेखन जपलं आहे. Your earlier writing is kept as an optional card.');
}

function bindEvents() {
  $('#close-stamp').addEventListener('click',() => $('#stamp-dialog').close());
  $('#stamp-dialog').addEventListener('close',() => { document.querySelector(`[data-open-stamp="${CSS.escape(stampingRideId || '')}"]`)?.focus({preventScroll:true}); });
  $('#cycle-download').addEventListener('click',() => $('#export-ledger').click());
  $('#stamp-done').addEventListener('click',() => $('#stamp-dialog').close());
  $('#press-stamp').addEventListener('click',() => pressStamp().catch(error => toast(error.message)));
  $('#stamp-dialog').addEventListener('click',event => { if(event.target === $('#stamp-dialog')) $('#stamp-dialog').close(); });
  $('#close-together').addEventListener('click',() => $('#together-dialog').close());
  $('#together-dialog').addEventListener('click',event => { if(event.target === $('#together-dialog')) $('#together-dialog').close(); });
  $('#together-dialog').addEventListener('close',() => document.querySelector('[data-together]')?.focus({preventScroll:true}));
  $('#copy-together').addEventListener('click',async () => {
    try { await navigator.clipboard.writeText($('#together-link').value); recordInvitation(); toast('लिंक कॉपी केली · Invitation copied'); }
    catch { $('#together-link').focus(); $('#together-link').select(); toast('लिंक निवडली · Copy the selected invitation'); }
  });
  $('#share-together').addEventListener('click',async () => {
    if(!navigator.share) { $('#copy-together').click(); return; }
    try { await navigator.share({title:'Safar Seva · Ride together',url:$('#together-link').value}); recordInvitation(); } catch(error) { if(error.name !== 'AbortError') toast('Use Copy link instead.'); }
  });
  $('#together-link').addEventListener('click',event => event.target.select());
  $('#nav-home').addEventListener('click',() => { showBuilder = true; render(); });
  $('#from').addEventListener('change',updatePreview); $('#to').addEventListener('change',updatePreview);
  $('#swap-stations').addEventListener('click',() => { const from = $('#from').value; $('#from').value = $('#to').value; $('#to').value = from; updatePreview(); });
  $('#export-ledger').addEventListener('click',exportNotebook);
  $('#reload-update').addEventListener('click',() => { persist(); location.reload(); });
  $('#resume-ride').addEventListener('click',() => openRide(state.currentRideId));
  $('#nav-ride').addEventListener('click',event => { if(rideNow()) { event.preventDefault(); openRide(state.currentRideId); } });
  $('#refresh-reviews').addEventListener('click',async () => { const button = $('#refresh-reviews'); button.disabled = true; try { await refreshPublication(); toast('उपलब्ध प्रकाशन तपासलं. Checked the latest available copy for decisions.'); } catch(error) { toast(error.message); } finally { button.disabled = false; } });
  $('#journey-form').addEventListener('submit',event => {
    event.preventDefault();
    try {
      const route = {from:$('#from').value,to:$('#to').value}, pool = taskPool(route);
      const ride = createLightRide({stations,tasks:pool,catalog,...route,storyId:invitation && invitation.from === route.from && invitation.to === route.to ? invitation.storyId : null});
      invitation = null; $('#invitation-banner').hidden = true; history.replaceState(null,'',location.pathname+location.search);
      state.rides.push(ride); state.currentRideId = ride.id; state.currentTaskId = ride.tasks.find(task => !task.optional).id; showBuilder = false; yatraOpen = false;
      $('#yatra details')?.removeAttribute('open'); persist(); render(); $('#active-title').focus();
    } catch(error) { $('#journey-error').textContent = error.message; }
  });
  document.addEventListener('input',event => { const form = event.target.closest('[data-task-form]'); if(form) saveInput(form); });
  document.addEventListener('change',event => {
    if(event.target.matches('[data-story-select]')) {
      try { selectStory(event.target.dataset.storySelect,event.target.value); } catch(error) { toast(error.message); }
      return;
    }
    const form = event.target.closest('[data-task-form]'); if(!form) return;
    saveInput(form);
    if(event.target.name === 'stationId') form.querySelectorAll('[data-check-answer]').forEach(button => { button.disabled = !event.target.value && button.dataset.checkAnswer !== 'not_observed'; });
  });
  document.addEventListener('submit',async event => {
    const form = event.target.closest('[data-task-form]'); if(!form) return; event.preventDefault();
    const instance = rideNow()?.tasks.find(task => task.id === form.dataset.taskForm); if(!instance) return;
    try {
      const values = Object.fromEntries(new FormData(form));
      if(instance.kind === 'learn') await playMove(form.querySelector('[type=submit]'),() => commitTask(instance,{acknowledged:true}));
      if(instance.kind === 'give') commitTask(instance,{text:assembleSuggestion(instance,values.text,values.editMode)});
    } catch(error) { form.querySelector('.field-error').textContent = error.message; }
  });
  document.addEventListener('click',async event => {
    const button = event.target.closest('button'); if(!button) return;
    try {
      if(button.dataset.openStamp) openStamp(button.dataset.openStamp);
      if(button.hasAttribute('data-together')) openTogether();
      if(button.hasAttribute('data-title-choice')) {
        const instance = rideNow()?.tasks.find(task => task.id === button.dataset.instance);
        const choice = instance?.contentSnapshot?.choices?.find(choice => choice.value === button.dataset.titleChoice);
        if(!instance || !choice) throw new Error('Choose one of the available titles.');
        await playMove(button,() => commitTask(instance,{text:choice.mr}));
      }
      if(button.hasAttribute('data-new-ride')) { showBuilder = true; render(); $('#from').focus(); }
      if(button.dataset.resume) openRide(button.dataset.resume);
      if(button.dataset.focusTask) showTask(button.dataset.focusTask);
      if(button.dataset.mapStation) {
        const ride = rideNow();
        if((ride?.routeStationIds || []).includes(button.dataset.mapStation)) {
          atlasStations.set(ride.id,button.dataset.mapStation); renderAtlas(); $('#atlas-station-title').focus();
        }
      }
      if(button.dataset.mapMove) {
        const ride = rideNow(); if(!ride) return;
        const route = ride.routeStationIds || [ride.from,ride.to];
        const current = atlasStations.get(ride.id) || ride.from, next = route[route.indexOf(current) + Number(button.dataset.mapMove)];
        if(next) { atlasStations.set(ride.id,next); renderAtlas(); $('#atlas-station-title').focus(); }
      }
      if(button.dataset.mapView) {
        atlasViews.set(rideNow().id,button.dataset.mapView); renderAtlas(); document.getElementById(`atlas-tab-${button.dataset.mapView}`)?.focus();
      }
      if(button.hasAttribute('data-map-check')) openAtlasAction('check');
      if(button.hasAttribute('data-map-give')) openAtlasAction('give');
      if(button.dataset.openDraft) showTask(button.dataset.openDraft);
      if(button.dataset.edit) { editing.add(button.dataset.edit); renderActive(); document.getElementById(`heading-${button.dataset.edit}`)?.focus(); }
      if(button.dataset.undo) {
        const ride = rideNow(); state.rides = state.rides.map(item => item.id === ride.id ? undoTask(item,button.dataset.undo) : item);
        delete state.forms[button.dataset.undo]; editing.delete(button.dataset.undo); persist(); showTask(button.dataset.undo); toast('मागे घेतलं. Answer undone.');
      }
      if(button.dataset.matchGive) matchGiving(button.dataset.matchGive);
      if(button.dataset.useOriginal) {
        const instance = rideNow().tasks.find(task => task.id === button.dataset.useOriginal), form = button.closest('form'), content = contentOf(instance);
        form.elements.text.value = form.elements.editMode.value === 'sentence' && content.focusText ? content.focusText : instance.originalText || [...tasks,...legacyTasks].find(task => task.id === content.source_task_id)?.body_mr || '';
        saveInput(form); form.elements.text.focus();
      }
      if(button.dataset.editWhole) {
        const instance = rideNow().tasks.find(task => task.id === button.dataset.editWhole), form = button.closest('form');
        state.forms[instance.id] = {text:form.elements.text.value.trim() ? assembleSuggestion(instance,form.elements.text.value,form.elements.editMode.value) : instance.originalText,editMode:'whole'};
        persist(); renderActive(); document.getElementById(`${instance.id}-text`).focus();
      }
      if(button.dataset.checkAnswer) {
        const form = button.closest('form'), values = Object.fromEntries(new FormData(form)), ride = rideNow(), instance = ride.tasks.find(task => task.id === button.dataset.instance);
        try {
          if(!values.stationId && button.dataset.checkAnswer !== 'not_observed') throw new Error('Choose the station where you noticed this first.');
          const observedAt = values.observedAt && button.dataset.checkAnswer !== 'not_observed' ? new Date(`${values.observedAt}:00+05:30`).toISOString() : new Date().toISOString();
          await playMove(button,() => commitTask(instance,{stationId:values.stationId || ride.from,feature:instance.feature,answer:button.dataset.checkAnswer,location:values.location || '',note:values.note || '',observedAt}));
        } catch(error) { form.querySelector('.field-error').textContent = error.message; }
      }
      if(button.dataset.prepare) await prepareContribution(button.dataset.prepare);
      if(button.dataset.redownload) showShare(packetByHash(button.dataset.redownload),{download:true});
      if(button.dataset.shareInfo) showShare(packetByHash(button.dataset.shareInfo));
      if(button.dataset.handedOver) {
        const packet = packetByHash(button.dataset.handedOver);
        if(!state.handoffs.some(item => item.id === packet.id && item.hash === packet.hash)) state.handoffs.push({id:packet.id,hash:packet.hash,sharedAt:new Date().toISOString()});
        persist(); render(); if(!$('#share-panel').hidden) showShare(packet); toast('तुम्ही फाइल दिल्याची नोंद केली. Handoff recorded here; delivery is not independently confirmed.');
      }
      if(button.dataset.revise) { await refreshPublication(); revisePacket(packetByHash(button.dataset.revise)); }
      if(button.dataset.readStory) {
        const storyId = button.dataset.readStory;
        if(!catalog.stories.some(story => story.id === storyId)) throw new Error('This story is unavailable.');
        const now = new Date().toISOString(), today = istInput(now).slice(0,10);
        if(!progressNow().discovered.includes(storyId) && !state.storyReads.some(read => read.storyId === storyId && istInput(read.readAt).slice(0,10) === today)) state.storyReads.push({storyId,readAt:now});
        persist(); renderYatra(); renderStories(); document.querySelector(`#${CSS.escape(storyId)} [data-read-story]`)?.focus({preventScroll:true});
        toast(progressNow().state === 'upcoming' ? `वाचल्याची नोंद केली. Seasonal counting starts ${seasonDates(season).start}.` : progressNow().state === 'ended' ? 'वाचल्याची नोंद केली. Reading saved; the season has ended.' : 'वाचल्याची नोंद केली. Each story counts once this season.');
      }
    } catch(error) { toast(error.message); }
  });
  const openHash = (hash = location.hash) => {
    let id; try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    const target = document.getElementById(id); if(!target) return;
    if(target.matches('.library-story')) target.open = true;
    const more = target.closest('#more'); if(more) more.open = true;
    requestAnimationFrame(() => target.scrollIntoView({block:'start'}));
  };
  document.addEventListener('click',event => {
    const anchor = event.target.closest('a[href^="#"]');
    if(anchor && !event.defaultPrevented) openHash(anchor.getAttribute('href'));
  });
  window.addEventListener('hashchange',() => openHash()); window.addEventListener('online',syncPulse);
  setInterval(() => { if(document.visibilityState === 'visible') syncPulse(); },30000);
  if(location.hash) openHash();
  window.addEventListener('online',updateConnection); window.addEventListener('offline',updateConnection);
}
function updateConnection() {
  const el = $('#connection'); el.innerHTML = `<i></i>${offlineReady ? navigator.onLine ? 'Ready offline' : 'Offline · saved here' : offlineFailed ? 'Offline setup unavailable' : 'Preparing offline…'}`;
  el.dataset.state = offlineFailed ? 'error' : navigator.onLine ? 'online' : 'offline';
}
async function prepareOffline() {
  let timer;
  try {
    if(!('serviceWorker' in navigator) || !('caches' in window)) throw new Error('Offline support unavailable');
    const setup = (async () => {
      navigator.serviceWorker.addEventListener('message',event => {
        if(event.data?.type === 'SAFAR_VERSION' && event.data.release !== globalThis.SAFAR_RELEASE) $('#update-notice').hidden = false;
      });
      navigator.serviceWorker.addEventListener('controllerchange',() => navigator.serviceWorker.controller?.postMessage({type:'SAFAR_VERSION'}));
      await navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}); await navigator.serviceWorker.ready;
      if(!navigator.serviceWorker.controller) await new Promise(resolve => { navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}); if(navigator.serviceWorker.controller) resolve(); });
      navigator.serviceWorker.controller?.postMessage({type:'SAFAR_VERSION'});
      const cached = await Promise.all(ASSETS.map(asset => caches.match(new URL(asset,location.href).href)));
      if(cached.some(response => !response)) throw new Error('Missing offline content');
    })();
    await Promise.race([setup,new Promise((_,reject) => { timer = setTimeout(() => reject(new Error('Offline setup timed out')),15000); })]); offlineReady = true;
  } catch(error) { offlineFailed = true; console.warn('Safar Seva offline preparation:',error.message); }
  finally { clearTimeout(timer); } updateConnection();
}
async function init() {
  if(TEST_MODE) { $('#test-warning').hidden = false; $('#test-warning').innerHTML = `<strong>TEST · ${e(TEST_SESSION)}</strong> <span lang="en">Separate practice data; no real review claim.</span>`; }
  loadState();
  if(TEST_MODE) $('.reviewer-entry').href = './review.html?test='+encodeURIComponent(TEST_SESSION);
  try { if(storageAvailable) { localStorage.setItem('safar-seva:probe','1'); localStorage.removeItem('safar-seva:probe'); } }
  catch { storageAvailable = false; warning('Device storage is unavailable. Download your work before closing.'); }
  try {
    const [stationData,loadedTasks,loadedSeason,publication] = await Promise.all([getJSON('./stations.json'),getJSON('./tasks.json'),getJSON('./season.json'),readPublication()]);
    lines = stationData.lines || []; stations = linkStations(stationData.stations,lines); taskData = loadedTasks; season = loadedSeason; catalog = publication;
    state.rides.forEach(ride => {
      if(ride.routeStationIds) return;
      try { const route = getRouteStationIds(stations,ride.from,ride.to); if(route.length === ride.stopCount + 1) ride.routeStationIds = route; }
      catch { /* Older saved rides can still use their two endpoints. */ }
    });
    tasks = hydrateTasks(taskData.tasks,catalog); legacyTasks = taskData.legacy_tasks || [];
    if(!Array.isArray(stations) || stations.length < 2 || tasks.length < 3) throw new Error('Content is incomplete.');
    for(const packet of state.outbox) { await validatePacket(packet); if(packet.testSession !== TEST_SESSION) throw new Error('A prepared file belongs to another session. The saved data has not been overwritten.'); }
    $('#from').innerHTML = options('vanaz'); $('#to').innerHTML = options('ramwadi'); $('#from').disabled = false; $('#to').disabled = false; $('#swap-stations').disabled = false;
    try {
      invitation = readInvitation(location.hash,stations,catalog);
      if(invitation) {
        $('#from').value = invitation.from; $('#to').value = invitation.to;
        $('#invitation-banner').hidden = false;
        $('#invitation-banner').textContent = 'सोबत सफरचं आमंत्रण · Same route, same story. Start when you’re ready; your answers stay separate.';
      }
    } catch(error) { $('#invitation-banner').hidden = false; $('#invitation-banner').textContent = error.message; }
    showBuilder = Boolean(invitation) || !rideNow(); updatePreview(); bindEvents(); render(); persist(); await prepareOffline();
  } catch(error) {
    $('#retry-load').hidden = false; $('#retry-load').addEventListener('click',() => location.reload(),{once:true});
    $('#load-error').hidden = false; $('#load-error').textContent = `कथा उघडता आल्या नाहीत. Reconnect and reload. Your saved notebook can still be downloaded. ${error.message}`;
    $('#export-ledger').addEventListener('click',exportNotebook);
  $('#reload-update').addEventListener('click',() => { persist(); location.reload(); }); offlineFailed = true; updateConnection();
  }
}
init();
