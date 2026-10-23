import { getRouteStationIds } from './core.mjs';
import { firstSentence } from './experience.mjs';
export function hydrateTasks(tasks, catalog) {
  return tasks.map(task => {
    const story = catalog.stories.find(item => item.id === task.story_id);
    const content = { ...task };
    if (story) {
      content.sources = story.sources;
      content.storyTitle_mr = story.title_mr;
      content.storyTitle_en = story.title_en;
      content.storyBody_mr = story.body_mr;
      content.storyBody_en = story.body_en;
      if (task.format === 'story') Object.assign(content, { title_mr: story.title_mr, title_en: story.title_en, body_mr: story.body_mr, body_en: story.body_en });
    }
    if (task.kind === 'give' && story && task.target_field === 'body_mr') content.focusText = firstSentence(story.body_mr);
    const hydrated = { ...content, ...(story ? { storyId: story.id, storyVersion: story.version } : {}) };
    if (task.kind === 'give' && story) Object.assign(hydrated, { targetField: task.target_field, originalText: story[task.target_field] });
    return { ...hydrated, contentSnapshot: content };
  });
}

export function getYatraProgress(rides, season, now = new Date().toISOString(), storyReads = []) {
  const start = Date.parse(season.startAt), end = Date.parse(season.endAtExclusive), clock = Date.parse(now);
  if (![start, end, clock].every(Number.isFinite) || start >= end) throw new Error('Invalid season dates.');
  const discovered = new Set();
  for (const ride of rides) for (const task of ride.tasks) {
    const time = Date.parse(task.completedAt);
    if (task.status === 'completed' && task.kind === 'learn' && task.contentSnapshot?.format === 'story' && task.storyId && time >= start && time < end && time <= clock) discovered.add(task.storyId);
  }
  for (const read of storyReads) {
    const time = Date.parse(read.readAt);
    if (read.storyId && time >= start && time < end && time <= clock) discovered.add(read.storyId);
  }
  return { state: clock < start ? 'upcoming' : clock >= end ? 'ended' : 'active', discovered: [...discovered], count: discovered.size, target: season.storyTarget };
}

export function rankTasks(tasks, { stations, from, to, rides = [], storyReads = [], season, now = new Date().toISOString() }) {
  const route = getRouteStationIds(stations, from, to);
  // Unread-first selection applies year round; seasonal accounting remains date bounded.
  const read = new Set(rides.flatMap(ride => ride.tasks.filter(task => task.status === 'completed' && task.kind === 'learn' && task.contentSnapshot?.format === 'story').map(task => task.storyId)));
  for (const item of storyReads) read.add(item.storyId);
  const used = new Set(rides.flatMap(ride => ride.tasks.filter(task => task.status === 'completed').map(task => task.taskId)));
  const hour = (new Date(now).getUTCHours() + 5.5) % 24;
  const score = task => {
    const overlaps = !task.station_ids?.length || task.station_ids.some(id => route.includes(id));
    let value = overlaps ? 0 : 100;
    if (task.kind === 'learn') value += task.format === 'story' ? (read.has(task.storyId) ? 25 : 0) : task.format === 'quiz' ? 35 : 45;
    else value += used.has(task.id) ? 20 : 0;
    if (task.station_ids?.length) value += Math.min(...task.station_ids.map(id => { const index = route.indexOf(id); return index < 0 ? 20 : index / 100; }));
    return value;
  };
  const pool = tasks.filter(task => task.id !== 'check-lighting' || hour >= 18 || hour < 6).slice().sort((x, y) => score(x) - score(y));
  const learn = pool.find(task => task.kind === 'learn');
  // A giving activity associated with today's story creates a coherent card.
  const gives = pool.filter(task => task.kind === 'give').sort((x, y) => Number(y.storyId === learn?.storyId) - Number(x.storyId === learn?.storyId));
  return [...pool.filter(task => task.kind === 'learn'), ...gives, ...pool.filter(task => task.kind === 'check')];
}
