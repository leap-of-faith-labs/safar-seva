// Validate a whole saved ledger before exposing it to rendering or overwriting it.
import { validatePacketShape } from './contributions.mjs';
const KINDS = new Set(['learn', 'give', 'check']);
const STATUSES = new Set(['pending', 'completed', 'skipped']);
const ANSWERS = new Set(['working', 'not_working', 'clear', 'blocked', 'not_observed']);

function invalid(path, reason) {
  throw new TypeError(`Invalid saved ledger: ${path} ${reason}.`);
}

function object(value, path) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    invalid(path, 'must be a plain object');
  }
}

function text(value, path, { blank = false, max = Infinity } = {}) {
  if (typeof value !== 'string' || (!blank && !value.trim()) || value.length > max) {
    invalid(path, `must be ${blank ? '' : 'nonblank '}text${Number.isFinite(max) ? ` of at most ${max} characters` : ''}`);
  }
}

function timestamp(value, path) {
  // Date.parse alone normalises impossible dates, such as 30 February.
  const parts = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) invalid(path, 'must be an ISO timestamp with a timezone');
  const [, y, m, d, h, minute, second] = parts;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || Number(h) > 23 || Number(minute) > 59 || Number(second) > 59 || !Number.isFinite(Date.parse(value))) {
    invalid(path, 'must be a valid calendar timestamp');
  }
}

function validateResult(task, ride, path) {
  if (task.status === 'pending') {
    if (task.result !== null) invalid(`${path}.result`, 'must be null while pending');
    return;
  }
  const result = task.result;
  object(result, `${path}.result`);
  if (task.kind === 'learn') {
    if (task.status !== 'completed' || result.acknowledged !== true) invalid(`${path}.result`, 'must acknowledge a completed learning task');
    return;
  }
  if (task.kind === 'give') {
    if (task.status !== 'completed') invalid(`${path}.status`, 'cannot skip a giving task');
    text(result.text, `${path}.result.text`, { max: 2000 });
    return;
  }
  if (!(ride.routeStationIds || [ride.from, ride.to]).includes(result.stationId)) invalid(`${path}.result.stationId`, 'must be on the ride');
  text(result.feature, `${path}.result.feature`);
  if (task.feature !== undefined && task.feature !== result.feature) invalid(`${path}.result.feature`, 'must match the check task');
  if (!ANSWERS.has(result.answer) || (task.answerValues && !task.answerValues.includes(result.answer))) {
    invalid(`${path}.result.answer`, 'must be supported by the check task');
  }
  text(result.note, `${path}.result.note`, { blank: true, max: 1000 });
  if (task.status === 'skipped') {
    if (result.answer !== 'not_observed' || result.observedAt !== null || result.location !== '') {
      invalid(`${path}.result`, 'must contain no observation when skipped');
    }
  } else {
    if (result.answer === 'not_observed') invalid(`${path}.status`, 'must be skipped for a not-observed answer');
    if (task.allowStationScope) {
      if (!['station', 'location-note'].includes(result.scope) || result.assetId !== null) invalid(`${path}.result.scope`, 'must distinguish a station note from a location note');
      text(result.location, `${path}.result.location`, { blank: result.scope === 'station', max: 160 });
      if (result.scope === 'station' && result.location !== '') invalid(`${path}.result.location`, 'must be empty for a station-only observation');
    } else text(result.location, `${path}.result.location`, { max: 160 });
    timestamp(result.observedAt, `${path}.result.observedAt`);
  }
}

export function parseStoredState(raw) {
  if (typeof raw !== 'string') invalid('input', 'must be a JSON string');
  let saved;
  try { saved = JSON.parse(raw); } catch { invalid('input', 'must contain valid JSON'); }
  object(saved, 'state');
  if (saved.schemaVersion !== 1) invalid('schemaVersion', 'must be 1');
  if (!Array.isArray(saved.rides)) invalid('rides', 'must be an array');
  const rideIds = new Set();
  const taskIds = new Set();
  const stampIds = new Set();
  saved.rides.forEach((ride, rideIndex) => {
    const path = `rides[${rideIndex}]`;
    object(ride, path);
    text(ride.id, `${path}.id`);
    if (rideIds.has(ride.id)) invalid(`${path}.id`, 'must be unique');
    rideIds.add(ride.id);
    text(ride.from, `${path}.from`);
    text(ride.to, `${path}.to`);
    if (ride.from === ride.to) invalid(`${path}.to`, 'must differ from the starting station');
    if (!Number.isInteger(ride.stopCount) || ride.stopCount < 1) invalid(`${path}.stopCount`, 'must be a positive integer');
    if (ride.routeStationIds !== undefined && (!Array.isArray(ride.routeStationIds) || ride.routeStationIds.length !== ride.stopCount + 1 || ride.routeStationIds[0] !== ride.from || ride.routeStationIds.at(-1) !== ride.to || new Set(ride.routeStationIds).size !== ride.routeStationIds.length || ride.routeStationIds.some(id => typeof id !== 'string' || !id.trim()))) {
      invalid(`${path}.routeStationIds`, 'must list the ordered stations on the ride');
    }
    timestamp(ride.createdAt, `${path}.createdAt`);
    if (!Array.isArray(ride.tasks) || !ride.tasks.length) invalid(`${path}.tasks`, 'must be a nonempty array');
    ride.tasks.forEach((task, taskIndex) => {
      const taskPath = `${path}.tasks[${taskIndex}]`;
      object(task, taskPath);
      text(task.id, `${taskPath}.id`);
      if (taskIds.has(task.id)) invalid(`${taskPath}.id`, 'must be unique across rides');
      taskIds.add(task.id);
      text(task.taskId, `${taskPath}.taskId`);
      if (!KINDS.has(task.kind)) invalid(`${taskPath}.kind`, 'must name a supported task kind');
      if (typeof task.optional !== 'boolean') invalid(`${taskPath}.optional`, 'must be a boolean');
      if (!STATUSES.has(task.status)) invalid(`${taskPath}.status`, 'must name a supported status');
      if (task.feature !== undefined) text(task.feature, `${taskPath}.feature`);
      if (task.allowStationScope !== undefined && typeof task.allowStationScope !== 'boolean') invalid(`${taskPath}.allowStationScope`, 'must be a boolean');
      if (task.completedAt !== undefined) {
        timestamp(task.completedAt, `${taskPath}.completedAt`);
        if (task.status === 'pending') invalid(`${taskPath}.completedAt`, 'must not exist on an unfinished activity');
      }
      if (task.updatedAt !== undefined) timestamp(task.updatedAt, `${taskPath}.updatedAt`);
      if (task.storyId !== undefined) {
        text(task.storyId, `${taskPath}.storyId`, { max: 100 });
        if (!Number.isInteger(task.storyVersion) || task.storyVersion < 1) invalid(`${taskPath}.storyVersion`, 'must be a positive integer');
        if (task.kind === 'give') {
          if (!['title_mr','body_mr'].includes(task.targetField)) invalid(`${taskPath}.targetField`, 'must name an editable story field');
          text(task.originalText, `${taskPath}.originalText`, { max: 2000 });
        }
      }
      if (task.contentSnapshot !== undefined) {
        object(task.contentSnapshot, `${taskPath}.contentSnapshot`);
        for (const field of ['id','kind','title_mr','title_en','body_mr','body_en']) text(task.contentSnapshot[field], `${taskPath}.contentSnapshot.${field}`);
        if (task.contentSnapshot.id !== task.taskId || task.contentSnapshot.kind !== task.kind) invalid(`${taskPath}.contentSnapshot`, 'must match the saved task');
        if (task.kind === 'check') {
          const answers = task.contentSnapshot.answerOptions;
          if (!Array.isArray(answers) || !answers.length) invalid(`${taskPath}.contentSnapshot.answerOptions`, 'must contain check answers');
          for (const answer of answers) {
            object(answer, 'check answer');
            if (!ANSWERS.has(answer.value)) invalid('check answer', 'must be supported');
            text(answer.label_mr, 'Marathi answer'); text(answer.label_en, 'English answer');
          }
        }
        if (task.contentSnapshot.focusText !== undefined) {
          text(task.contentSnapshot.focusText, 'sentence to edit', { max: 2000 });
          if (task.kind !== 'give' || !task.originalText?.startsWith(task.contentSnapshot.focusText)) invalid('sentence to edit', 'must belong to the original passage');
        }
        if (task.contentSnapshot.revisionOf !== undefined) {
          object(task.contentSnapshot.revisionOf, 'revision'); text(task.contentSnapshot.revisionOf.id, 'previous contribution');
          if (!/^[a-f0-9]{64}$/.test(task.contentSnapshot.revisionOf.hash)) invalid('revision fingerprint', 'must identify the earlier draft');
        }
        if (task.contentSnapshot.sources !== undefined) {
          if (!Array.isArray(task.contentSnapshot.sources)) invalid(`${taskPath}.contentSnapshot.sources`, 'must be an array');
          for (const source of task.contentSnapshot.sources) {
            object(source, 'source'); text(source.title, 'source title');
            if (typeof source.url !== 'string' || !source.url.startsWith('https://')) invalid('source URL', 'must use HTTPS');
          }
        }
      }
      if (task.answerValues !== undefined && (!Array.isArray(task.answerValues) || !task.answerValues.length || task.answerValues.some(answer => !ANSWERS.has(answer)) || new Set(task.answerValues).size !== task.answerValues.length)) {
        invalid(`${taskPath}.answerValues`, 'must contain distinct supported check answers');
      }
      validateResult(task, ride, taskPath);
    });
    const required = ride.tasks.filter(task => !task.optional);
    if (!required.length) invalid(`${path}.tasks`, 'must include required tasks');
    const resolved = required.every(task => task.status === 'completed' || task.status === 'skipped');
    if (ride.stamp !== null) {
      object(ride.stamp, `${path}.stamp`);
      text(ride.stamp.id, `${path}.stamp.id`);
      if (stampIds.has(ride.stamp.id)) invalid(`${path}.stamp.id`, 'must be unique');
      stampIds.add(ride.stamp.id);
      if (ride.stamp.kind !== 'participation') invalid(`${path}.stamp.kind`, 'must be participation');
      timestamp(ride.stamp.awardedAt, `${path}.stamp.awardedAt`);
      if (ride.stamp.impressions !== undefined && (!Number.isSafeInteger(ride.stamp.impressions) || ride.stamp.impressions < 0)) invalid(`${path}.stamp.impressions`, 'must be a nonnegative safe integer');
      if (ride.stamp.invited !== undefined && typeof ride.stamp.invited !== 'boolean') invalid(`${path}.stamp.invited`, 'must be true or false');
      if (!resolved) invalid(`${path}.stamp`, 'requires all required tasks to be resolved');
    } else if (resolved) {
      invalid(`${path}.stamp`, 'is required for a resolved ride');
    }
  });
  if (saved.currentRideId !== null && (typeof saved.currentRideId !== 'string' || !rideIds.has(saved.currentRideId))) {
    invalid('currentRideId', 'must be null or identify a saved ride');
  }
  if (saved.currentTaskId !== undefined && saved.currentTaskId !== null && !saved.rides.find(ride => ride.id === saved.currentRideId)?.tasks.some(task => task.id === saved.currentTaskId)) invalid('currentTaskId', 'must identify an activity on the current ride');
  object(saved.forms, 'forms');
  Object.entries(saved.forms).forEach(([id, form]) => {
    if (!taskIds.has(id)) invalid(`forms[${id}]`, 'must identify a saved task instance');
    object(form, `forms[${id}]`);
    Object.entries(form).forEach(([name, value]) => text(value, `forms[${id}].${name}`, { blank: true }));
  });
  if (saved.outbox !== undefined) {
    if (!Array.isArray(saved.outbox)) invalid('outbox', 'must be an array');
    saved.outbox.forEach(validatePacketShape);
  }
  if (saved.storyReads !== undefined) {
    if (!Array.isArray(saved.storyReads)) invalid('storyReads', 'must be an array');
    for (const read of saved.storyReads) { object(read, 'story read'); text(read.storyId, 'storyId', { max: 100 }); timestamp(read.readAt, 'readAt'); }
  }
  if (saved.handoffs !== undefined) {
    if (!Array.isArray(saved.handoffs)) invalid('handoffs', 'must be an array');
    for (const handoff of saved.handoffs) {
      object(handoff, 'handoff'); text(handoff.id, 'contribution ID'); timestamp(handoff.sharedAt, 'sharedAt');
      if (!saved.outbox?.some(packet => packet.id === handoff.id && packet.hash === handoff.hash)) invalid('handoff', 'must match a prepared contribution');
    }
  }
  return { schemaVersion: 1, rides: saved.rides, currentRideId: saved.currentRideId, forms: saved.forms, ...(saved.currentTaskId !== undefined ? { currentTaskId:saved.currentTaskId } : {}), ...(saved.outbox !== undefined ? { outbox: saved.outbox } : {}), ...(saved.storyReads !== undefined ? { storyReads: saved.storyReads } : {}), ...(saved.handoffs !== undefined ? { handoffs: saved.handoffs } : {}) };
}
