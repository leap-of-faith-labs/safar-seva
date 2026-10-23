// Small, offline route and observation helpers. Story settings describe editorial
// context; they do not claim a landmark is visible from a moving train.
const STORY_SETTINGS = {
  'story-vanaz': 'neighbourhood',
  'story-garware': 'neighbourhood',
  'story-deccan': 'neighbourhood',
  'story-district-court': 'inside',
  'story-ruby-hall': 'neighbourhood',
  'story-bund-garden': 'neighbourhood',
  'story-yerawada': 'neighbourhood',
  'story-ramwadi': 'line',
};

export const storySetting = story => STORY_SETTINGS[story.id] || 'neighbourhood';

export const settingLabels = {
  visible: { mr: 'खिडकीतून दिसतं', en: 'Visible from the train' },
  inside: { mr: 'स्थानकाच्या आत', en: 'Inside the station' },
  neighbourhood: { mr: 'परिसरात', en: 'In the neighbourhood' },
  line: { mr: 'मार्गाची गोष्ट', en: 'Along the line' },
};

export const featureLabels = {
  lift: { mr: 'लिफ्ट', en: 'Lift' },
  ramp: { mr: 'रॅम्पची वाट', en: 'Ramp route' },
  water: { mr: 'पाण्याचं ठिकाण', en: 'Water point' },
  lighting: { mr: 'बाहेरचे दिवे', en: 'Exit lighting' },
};

const ANSWER_LABELS = {
  lift: { working: ['चालू दिसली', 'Observed working'], not_working: ['बंद दिसली', 'Observed not working'] },
  ramp: { clear: ['वाट मोकळी दिसली', 'Visible route clear'], blocked: ['अडथळा दिसला', 'Obstruction observed'] },
  water: { working: ['पाणी येताना दिसलं', 'Water observed flowing'], not_working: ['पाणी येत नसल्याचं दिसलं', 'Water observed not flowing'] },
  lighting: { working: ['दिवे चालू दिसले', 'Lights observed on'], not_working: ['दिवे बंद दिसले', 'Lights observed off'] },
};

export function answerLabel(feature, answer) {
  const [mr, en] = ANSWER_LABELS[feature]?.[answer] || [answer, answer];
  return { mr, en };
}

export const signGuide = [
  { mark: '↗', mr: 'बाहेर पडण्याचा मार्ग', en: 'Exit', meaningMr: 'स्थानकातून रस्त्याकडे जाण्याची वाट', meaningEn: 'Follow to the street.' },
  { mark: '↕', mr: 'लिफ्ट', en: 'Lift', meaningMr: 'मजले बदलण्यासाठी लिफ्टची दिशा', meaningEn: 'Follow to change levels.' },
  { mark: '▤', mr: 'फलाट', en: 'Platform', meaningMr: 'गाडी पकडण्याची जागा', meaningEn: 'Follow to board the train.' },
  { mark: 'B', mr: 'बस थांबा', en: 'Bus stop', meaningMr: 'बाहेर बस थांबा शोधा', meaningEn: 'Look for the stop outside.' },
];

export function observationsAt(rides, stationId, features = null) {
  const allowed = features ? new Set(features) : null;
  return rides.flatMap(ride => ride.tasks
    .filter(task => task.kind === 'check' && task.status === 'completed' && task.result?.stationId === stationId && (!allowed || allowed.has(task.result.feature)))
    .map(task => task.result))
    .filter(result => result.answer !== 'not_observed')
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
}

export function stationStories(catalog, stationId) {
  return catalog.stories.filter(story => story.station_ids.includes(stationId));
}
