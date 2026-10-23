import { createRide, addOptionalTask, getRouteStationIds } from './core.mjs';

// Editorial alternatives, not claims that a reader's choice was published.
const titles = {
  'story-vanaz': ['वनाजची औद्योगिक गोष्ट', 'Vanaz’s industrial story'],
  'story-garware': ['गरवारे कॉलेजची सुरुवात', 'The beginnings of Garware College'],
  'story-deccan': ['पुण्याचा ऑलिंपिकशी संबंध', 'Pune’s Olympic connection'],
  'story-district-court': ['दोन मेट्रो मार्गांची भेट', 'Two Metro lines meet'],
  'story-ruby-hall': ['रुबी हॉलची छोटी सुरुवात', 'Ruby Hall’s small beginning'],
  'story-bund-garden': ['बंड गार्डनचा इतिहास', 'The history of Bund Garden'],
  'story-yerawada': ['आगाखान पॅलेस आणि रोजगार', 'Aga Khan Palace and employment'],
  'story-ramwadi': ['मेट्रोचा मार्ग टप्प्याटप्प्याने', 'A Metro line built in stages'],
};

export function choiceTask(story) {
  const alternative = titles[story.id];
  if (!alternative) throw new Error('This story has no title choices yet.');
  const content = {
    id: `choice-${story.id}`, kind: 'give', format: 'choice',
    title_mr: 'कोणतं शीर्षक अधिक स्पष्ट वाटतं?', title_en: 'Which title feels clearer?',
    body_mr: 'पुढच्या वाचकासाठी तुमची पसंती निवडा.', body_en: 'Choose the title you prefer for the next reader.',
    choices: [{ value: 'a', mr: story.title_mr, en: story.title_en }, { value: 'b', mr: alternative[0], en: alternative[1] }],
  };
  return { ...content, storyId: story.id, storyVersion: story.version, targetField: 'title_mr', originalText: story.title_mr, contentSnapshot: content };
}

export function createLightRide({ stations, tasks, catalog, from, to, storyId, now, id }) {
  const route = getRouteStationIds(stations, from, to);
  const story = storyId ? catalog.stories.find(item => item.id === storyId) : catalog.stories.find(item => item.id === tasks.find(task => task.kind === 'learn' && task.format === 'story' && task.station_ids.some(id => route.includes(id)))?.storyId);
  // Some short sections have no story of their own. Use the nearest ranked story.
  const selected = story || (!storyId && catalog.stories.find(item => item.id === tasks.find(task => task.kind === 'learn' && task.format === 'story')?.storyId));
  if (!selected) throw new Error('Choose a story available for this ride.');
  const learn = tasks.find(task => task.kind === 'learn' && task.format === 'story' && task.storyId === selected.id);
  const check = tasks.find(task => task.kind === 'check');
  if (!learn || !check) throw new Error('The ride activities are unavailable.');
  const chosen = [learn, choiceTask(selected), check];
  let ride = createRide({ stations, tasks: chosen, from, to, lightweight: true, ...(now ? { now } : {}), ...(id ? { id } : {}) });
  for (const task of chosen) if (!ride.tasks.some(item => item.taskId === task.id)) ride = addOptionalTask(ride, task);
  return { ...ride, tasks: chosen.map(task => ({ ...ride.tasks.find(item => item.taskId === task.id), optional: false })) };
}

export function invitationURL(base, ride) {
  const url = new URL(base);
  url.search = '';
  const storyId = ride.tasks.find(task => task.kind === 'learn')?.storyId;
  const payload = new URLSearchParams({ together: '1', from: ride.from, to: ride.to });
  if (storyId) payload.set('story', storyId);
  url.hash = payload.toString();
  return url.href;
}

export function readInvitation(hash, stations, catalog) {
  const data = new URLSearchParams(hash.replace(/^#/, ''));
  if (!data.has('together')) return null;
  if (hash.length > 400 || data.get('together') !== '1' || [...data.keys()].some(key => !['together', 'from', 'to', 'story'].includes(key)) || [...data.keys()].some(key => data.getAll(key).length !== 1)) throw new Error('This invitation is not valid. Choose your own ride instead.');
  const from = data.get('from'), to = data.get('to'), storyId = data.get('story');
  getRouteStationIds(stations, from, to);
  if (storyId && !catalog.stories.some(story => story.id === storyId)) throw new Error('The invited story is unavailable. Choose your own ride instead.');
  return { from, to, storyId };
}