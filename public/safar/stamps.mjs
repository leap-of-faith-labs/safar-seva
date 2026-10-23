// Decorative impressions belong to the existing participation award, never extra rides.
export const AI_SESSION_THRESHOLD = 3;
export const AI_SESSION_URL = 'https://lofl.world/ai-for-all';

export function impressionCount(ride) {
  if (!ride?.stamp) return 0;
  return Number.isSafeInteger(ride.stamp.impressions) && ride.stamp.impressions >= 0 ? ride.stamp.impressions : 1;
}

// Each impression must be backed by genuine use: finishing the ride, each extra
// completed activity, sharing a ride-together invitation, and stories read after the award.
export function earnedImpressions(ride, { laterReads = 0 } = {}) {
  if (!ride?.stamp) return 0;
  const extras = ride.tasks.filter(task => task.optional && task.status === 'completed').length;
  const reads = Number.isSafeInteger(laterReads) && laterReads > 0 ? laterReads : 0;
  return 1 + extras + (ride.stamp.invited === true ? 1 : 0) + reads;
}

export function canStamp(ride, earned) {
  return Boolean(ride?.stamp) && impressionCount(ride) < earned;
}

export function addImpression(ride, earned = 1) {
  if (!ride?.stamp) throw new Error('Finish your ride before stamping.');
  const count = impressionCount(ride);
  if (count >= earned) throw new Error('Earn another stamp: read a story, invite a co-rider, or do one more activity.');
  return { ...ride, stamp: { ...ride.stamp, impressions: count + 1 } };
}

export function markInvited(ride) {
  if (!ride?.stamp || ride.stamp.invited === true) return ride;
  return { ...ride, stamp: { ...ride.stamp, invited: true } };
}

// Diwali Yatra badges are earned by distinct stories counted this season.
export const YATRA_BADGES = Object.freeze([
  { id:'first-diya', at:1, mr:'पहिला दिवा', en:'First diya' },
  { id:'half-yatra', at:4, mr:'अर्धी यात्रा', en:'Half yatra' },
  { id:'full-yatra', at:8, mr:'पूर्ण यात्रा', en:'Full yatra' },
]);
export const yatraBadges = count => YATRA_BADGES.map(badge => ({ ...badge, earned: count >= badge.at }));

export const aiSessionUnlocked = ride => impressionCount(ride) >= AI_SESSION_THRESHOLD;

export function sealMarkup(id, date = '') {
  // Local vector artwork stays crisp at notebook and full-size scales.
  return `<svg class="ink-seal" viewBox="0 0 200 200" role="img" aria-label="SAFAR SEVA · Participation seal"><defs><path id="${id}-arc" d="M 31,103 A 69,69 0 0,1 169,103"/><filter id="${id}-ink"><feTurbulence type="fractalNoise" baseFrequency=".38" numOctaves="3" seed="7" result="grain"/><feColorMatrix in="grain" type="luminanceToAlpha"/><feComponentTransfer><feFuncA type="discrete" tableValues="0 .6 1 1"/></feComponentTransfer><feComposite in="SourceGraphic" operator="in"/></filter></defs><g filter="url(#${id}-ink)" fill="none" stroke="currentColor"><circle cx="100" cy="100" r="91" stroke-width="3.5"/><circle cx="100" cy="100" r="85" stroke-width="1.2"/><circle cx="100" cy="100" r="62" stroke-width="1.5" stroke-dasharray="1 3"/><path d="M51 121H149M58 143H142" stroke-width="1.5"/></g><g fill="currentColor" filter="url(#${id}-ink)" text-anchor="middle"><text class="seal-brand"><textPath href="#${id}-arc" startOffset="50%">SAFAR SEVA</textPath></text><text x="100" y="104" class="seal-marathi">सफर सेवा</text><text x="100" y="136" class="seal-status">PARTICIPATED</text><text x="100" y="160" class="seal-date">${date}</text><text x="25" y="113" class="seal-star">✦</text><text x="175" y="113" class="seal-star">✦</text><text x="100" y="181" class="seal-bottom">PUNE METRO</text></g></svg>`;
}
