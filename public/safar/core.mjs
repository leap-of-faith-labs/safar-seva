// Pure ride and ledger logic shared by the browser app and its Node tests.
const CHECK_ANSWERS = new Set(['working', 'not_working', 'clear', 'blocked', 'not_observed']);
const MAX_FUTURE_MS = 5 * 60 * 1000;

function identifier(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function isoDate(value, name = 'timestamp') {
  const milliseconds = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(milliseconds)) throw new TypeError(`${name} must be a valid timestamp.`);
  return new Date(milliseconds).toISOString();
}

function nonblank(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} is required.`);
  return value.trim();
}

function stationId(station) {
  return typeof station === 'string' ? station : station?.id;
}

function instanceFromTask(task, id, optional) {
  const instance = { id, taskId: task.id, kind: task.kind, optional, status: 'pending', result: null };
  if (task.contentSnapshot) instance.contentSnapshot = JSON.parse(JSON.stringify(task.contentSnapshot));
  if (task.storyId) instance.storyId = task.storyId;
  if (task.storyVersion) instance.storyVersion = task.storyVersion;
  if (task.targetField) instance.targetField = task.targetField;
  if (task.originalText !== undefined) instance.originalText = task.originalText;
  if (task.kind === 'check') {
    if (task.feature) instance.feature = nonblank(task.feature, 'Check feature');
    if (task.allow_station_scope) instance.allowStationScope = true;
    if (Array.isArray(task.answerOptions)) {
      instance.answerValues = task.answerOptions.map(option => typeof option === 'string' ? option : option.value);
      if (!instance.answerValues.length || instance.answerValues.some(value => !CHECK_ANSWERS.has(value))) throw new TypeError('Check answer options must contain supported values.');
    }
  }
  return instance;
}

// Stations may carry an `adj` list (built by linkStations) for a multi-line network;
// without it, the array order is treated as one line (legacy behaviour).
export function linkStations(stations, lines = []) {
  const adj = new Map(stations.map(station => [stationId(station), new Set()]));
  for (const line of lines) line.stations.forEach((id, index, list) => {
    if (index && adj.has(id) && adj.has(list[index - 1])) { adj.get(id).add(list[index - 1]); adj.get(list[index - 1]).add(id); }
  });
  return stations.map(station => ({ ...station, adj: [...adj.get(stationId(station))] }));
}

export function getRouteStationIds(stations, from, to) {
  if (!Array.isArray(stations)) throw new TypeError('Stations must be an array.');
  const start = stations.findIndex(station => stationId(station) === from);
  const end = stations.findIndex(station => stationId(station) === to);
  if (typeof from !== 'string' || typeof to !== 'string' || start < 0 || end < 0) throw new RangeError('Choose two known stations.');
  if (start === end) throw new RangeError('Start and end stations must differ.');
  if (!stations.some(station => Array.isArray(station.adj))) {
    const route = stations.slice(Math.min(start, end), Math.max(start, end) + 1).map(stationId);
    return start < end ? route : route.reverse();
  }
  const byId = new Map(stations.map(station => [stationId(station), station]));
  const previous = new Map([[from, null]]), queue = [from];
  while (queue.length) {
    const id = queue.shift();
    if (id === to) break;
    for (const next of byId.get(id)?.adj || []) if (!previous.has(next)) { previous.set(next, id); queue.push(next); }
  }
  if (!previous.has(to)) throw new RangeError('These stations are not connected.');
  const route = []; for (let id = to; id; id = previous.get(id)) route.unshift(id);
  return route;
}

export function getStopCount(stations, from, to) {
  return getRouteStationIds(stations, from, to).length - 1;
}

export function getCardTier(stops) {
  if (!Number.isInteger(stops) || stops < 1) throw new RangeError('Stops must be a positive integer.');
  return {
    requiredKinds: stops <= 3 ? ['check'] : stops <= 7 ? ['learn', 'check'] : ['learn', 'give', 'check'],
    bonusKinds: stops >= 13 ? ['give'] : [],
  };
}

export function createRide({ stations, tasks, from, to, lightweight = false, now = new Date().toISOString(), id = identifier('ride') }) {
  const stopCount = getStopCount(stations, from, to);
  const routeStationIds = getRouteStationIds(stations, from, to);
  if (!Array.isArray(tasks)) throw new TypeError('Tasks must be an array.');
  nonblank(id, 'Ride ID');
  const createdAt = isoDate(now, 'Ride creation time');
  const tier = lightweight ? { requiredKinds: ['learn', 'give', 'check'], bonusKinds: [] } : getCardTier(stopCount);
  const usedTaskIds = new Set();
  const selected = [...tier.requiredKinds.map(kind => ({ kind, optional: false })), ...tier.bonusKinds.map(kind => ({ kind, optional: true }))];
  const instances = selected.map(({ kind, optional }, index) => {
    const task = tasks.find(candidate => candidate.kind === kind && typeof candidate.id === 'string' && candidate.id.trim() && !usedTaskIds.has(candidate.id));
    if (!task) throw new RangeError(`No distinct ${kind} task is available.`);
    usedTaskIds.add(task.id);
    return instanceFromTask(task, `${id}:task:${index + 1}`, optional);
  });
  return { id, from, to, stopCount, routeStationIds, createdAt, tasks: instances, stamp: null };
}

export function addOptionalTask(ride, task) {
  if (ride.tasks.some(item => item.taskId === task.id)) throw new RangeError('That activity is already on this card.');
  const id = `${ride.id}:extra:${identifier('task')}`;
  return { ...ride, tasks: [...ride.tasks, instanceFromTask(task, id, true)] };
}

function normaliseResult(ride, task, result, now) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new TypeError('A task result is required.');
  if (task.kind === 'learn') {
    if (result.acknowledged !== true) throw new TypeError('Acknowledge the learning task to finish it.');
    return { status: 'completed', result: { acknowledged: true } };
  }
  if (task.kind === 'give') {
    const text = nonblank(result.text, 'Contribution text');
    if (task.contentSnapshot?.format === 'choice' && !task.contentSnapshot.choices?.some(choice => choice.mr === text)) throw new RangeError('Choose one of the two titles.');
    if (text.length > 2000) throw new RangeError('Contribution text must be 2,000 characters or fewer.');
    return { status: 'completed', result: { text } };
  }
  if (task.kind !== 'check') throw new TypeError('Unsupported task kind.');
  if (!(ride.routeStationIds || [ride.from, ride.to]).includes(result.stationId)) throw new RangeError('A check must be at a station on this ride.');
  const feature = nonblank(result.feature, 'Check feature');
  if (task.feature && feature !== task.feature) throw new RangeError('The feature must match the selected check task.');
  if (!CHECK_ANSWERS.has(result.answer) || (task.answerValues && !task.answerValues.includes(result.answer))) {
    throw new RangeError('Choose an answer supported by this check.');
  }
  const note = result.note == null ? '' : typeof result.note === 'string' ? result.note.trim() : null;
  if (note === null) throw new TypeError('Check note must be text.');
  if (note.length > 1000) throw new RangeError('Check note must be 1,000 characters or fewer.');
  if (result.answer === 'not_observed') {
    return { status: 'skipped', result: { stationId: result.stationId, feature, answer: 'not_observed', location: '', note, observedAt: null } };
  }
  const stationScope = task.allowStationScope && (!result.location || !result.location.trim());
  const location = stationScope ? '' : nonblank(result.location, 'Exit or fixture location');
  if (location.length > 160) throw new RangeError('Exit or fixture location must be 160 characters or fewer.');
  const observedAt = isoDate(result.observedAt, 'Observation time');
  if (Date.parse(observedAt) > Date.parse(now) + MAX_FUTURE_MS) throw new RangeError('Observation time cannot be more than five minutes in the future.');
  return { status: 'completed', result: { stationId: result.stationId, location, feature, answer: result.answer, note, observedAt, ...(task.allowStationScope ? { scope: stationScope ? 'station' : 'location-note', assetId: null } : {}) } };
}

export function completeTask(ride, instanceId, result, nowIso = new Date().toISOString()) {
  const now = isoDate(nowIso, 'Completion time');
  const task = ride.tasks.find(candidate => candidate.id === instanceId);
  if (!task) throw new RangeError('Task does not belong to this ride.');
  const resolved = normaliseResult(ride, task, result, now);
  const tasks = ride.tasks.map(candidate => candidate.id === instanceId ? { ...candidate, ...resolved, completedAt: candidate.completedAt || now, updatedAt: now } : candidate);
  const requiredResolved = tasks.filter(candidate => !candidate.optional).every(candidate => candidate.status === 'completed' || candidate.status === 'skipped');
  const stamp = ride.stamp ?? (requiredResolved ? { id: `${ride.id}:stamp`, awardedAt: now, kind: 'participation' } : null);
  return { ...ride, tasks, stamp };
}

export function swapTask(ride, instanceId, replacement) {
  const previous = ride.tasks.find(task => task.id === instanceId);
  if (!previous || previous.status !== 'pending') throw new RangeError('Only an unfinished activity can be swapped.');
  if (replacement.kind !== previous.kind) throw new RangeError('Choose the same kind of activity.');
  if (ride.tasks.some(task => task.id !== instanceId && task.taskId === replacement.id)) throw new RangeError('That activity is already on this card.');
  return { ...ride, tasks: ride.tasks.map(task => task.id === instanceId ? instanceFromTask(replacement, previous.id, previous.optional) : task) };
}

export function undoTask(ride, instanceId) {
  if (!ride.tasks.some(task => task.id === instanceId)) throw new RangeError('Task does not belong to this ride.');
  const tasks = ride.tasks.map(task => {
    if (task.id !== instanceId) return task;
    const { completedAt, updatedAt, ...rest } = task;
    return { ...rest, status: 'pending', result: null };
  });
  return { ...ride, tasks, stamp: tasks.filter(task => !task.optional).every(task => task.status !== 'pending') ? ride.stamp : null };
}

function observationRecords(rides) {
  return rides.flatMap(ride => ride.tasks.filter(task => task.kind === 'check' && task.status === 'completed' && task.result && task.result.answer !== 'not_observed').map(task => ({
    stationId: task.result.stationId,
    location: task.result.location,
    feature: task.result.feature,
    answer: task.result.answer,
    observedAt: task.result.observedAt,
    note: task.result.note,
    taskId: task.taskId,
    rideId: ride.id,
    ...(task.result.scope ? { scope: task.result.scope, assetId: task.result.assetId } : {}),
  })));
}

export function makeExport(rides, { now = new Date().toISOString() } = {}) {
  const exportedAt = isoDate(now, 'Export time');
  const snapshot = JSON.parse(JSON.stringify(rides));
  return {
    schemaVersion: 1,
    exportedAt,
    rides: snapshot,
    stamps: snapshot.filter(ride => ride.stamp).map(ride => ({ ...ride.stamp, rideId: ride.id })),
    contributions: snapshot.flatMap(ride => ride.tasks.filter(task => task.kind === 'give' && task.status === 'completed').map(task => ({
      rideId: ride.id, taskId: task.taskId, text: task.result.text, reviewStatus: 'unreviewed',
      ...(task.storyId ? { storyId: task.storyId, storyVersion: task.storyVersion, targetField: task.targetField, originalText: task.originalText, completedAt: task.completedAt } : {}),
    }))),
    observations: observationRecords(snapshot),
  };
}

export function getLedgerStats(rides) {
  const completedRides = rides.filter(ride => ride.stamp).length;
  const drafts = rides.reduce((count, ride) => count + ride.tasks.filter(task => task.kind === 'give' && task.status === 'completed').length, 0);
  return { completedRides, drafts, observations: observationRecords(rides).length };
}
