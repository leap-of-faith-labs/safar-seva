export const EDIT_FIELDS = ['title_mr', 'body_mr'];
const SESSION = /^[a-z0-9_-]{1,40}$/i;
const HEX = /^[a-f0-9]{64}$/;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 2000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function validatePacketShape(packet) {
  assert(plain(packet) && packet.kind === 'safar-seva-contribution' && packet.schemaVersion === 1, 'Choose a contribution-only file, not a whole ledger.');
  assert(text(packet.id, 250) && text(packet.storyId, 100), 'Missing contribution or story identifier.');
  assert(Number.isInteger(packet.baseVersion) && packet.baseVersion > 0 && EDIT_FIELDS.includes(packet.field), 'Invalid story version or editable field.');
  assert(text(packet.originalText) && text(packet.suggestedText, packet.field === 'title_mr' ? 160 : 2000), 'The original and suggested text must be nonempty and within their limits.');
  assert(packet.originalText.trim() !== packet.suggestedText.trim(), 'Suggest a change, or swap this activity.');
  assert(packet.testSession === null || (typeof packet.testSession === 'string' && SESSION.test(packet.testSession)), 'Invalid test session.');
  assert(packet.permission === (packet.testSession ? 'test-only' : 'publish-accepted-wording') && packet.license === 'CC-BY-SA-4.0', 'Publication permission is missing.');
  assert(date(packet.preparedAt) && HEX.test(packet.hash), 'Invalid contribution timestamp or fingerprint.');
  return packet;
}

export async function fingerprint(packet) {
  const canonical = JSON.stringify(['id','storyId','baseVersion','field','originalText','suggestedText','testSession','permission','license'].map(key => packet[key]));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function validatePacket(packet) {
  validatePacketShape(packet);
  assert(await fingerprint(packet) === packet.hash, 'This draft has changed since its fingerprint was made. Prepare a new contribution file.');
  return packet;
}

export async function createContribution(ride, instance, { permission = false, testSession = null, now = new Date().toISOString() } = {}) {
  assert(instance.kind === 'give' && instance.status === 'completed', 'Save your suggestion first.');
  assert(instance.storyId && instance.storyVersion && instance.targetField, 'This older draft has no story target. It remains in your ledger for manual review.');
  assert(permission === true, 'Choose whether your accepted wording may be published before preparing it for sharing.');
  const packet = {
    kind: 'safar-seva-contribution', schemaVersion: 1,
    id: `contribution:${instance.id}`, storyId: instance.storyId, baseVersion: instance.storyVersion,
    field: instance.targetField, originalText: instance.originalText, suggestedText: instance.result.text.trim(),
    testSession, permission: testSession ? 'test-only' : 'publish-accepted-wording', license: 'CC-BY-SA-4.0', preparedAt: now,
  };
  packet.hash = await fingerprint(packet);
  return validatePacket(packet);
}

export function validateCatalog(catalog) {
  assert(plain(catalog) && catalog.schemaVersion === 1 && Array.isArray(catalog.stories) && Array.isArray(catalog.receipts), 'Invalid story publication.');
  const ids = new Set();
  for (const story of catalog.stories) {
    assert(plain(story) && text(story.id, 100) && !ids.has(story.id), 'Invalid or duplicate story.'); ids.add(story.id);
    assert(Number.isInteger(story.version) && story.version >= 1 && Array.isArray(story.station_ids), 'Invalid story metadata.');
    for (const field of ['title_mr','title_en','body_mr','body_en']) assert(text(story[field]), 'Invalid story text.');
    assert(Array.isArray(story.sources) && story.sources.length > 0, 'A story needs sources.');
    for (const source of story.sources) assert(plain(source) && text(source.title, 300) && typeof source.url === 'string' && /^https:\/\//.test(source.url), 'Source links must use HTTPS.');
    assert(Array.isArray(story.appliedContributions), 'Missing story publication history.');
    for (const item of story.appliedContributions) assert(plain(item) && text(item.id, 250) && HEX.test(item.hash) && EDIT_FIELDS.includes(item.field) && Number.isInteger(item.version) && item.version > 1 && item.version <= story.version, 'Invalid story publication history.');
  }
  for (const receipt of catalog.receipts) {
    assert(plain(receipt) && text(receipt.id, 250) && HEX.test(receipt.hash) && ids.has(receipt.storyId) && ['published','declined'].includes(receipt.status) && date(receipt.reviewedAt), 'Invalid publication receipt.');
    assert(Number.isInteger(receipt.baseVersion) && receipt.baseVersion > 0 && EDIT_FIELDS.includes(receipt.field) && text(receipt.reviewerName, 100), 'Invalid receipt metadata.');
    assert(receipt.testSession === null || (typeof receipt.testSession === 'string' && SESSION.test(receipt.testSession)), 'Invalid receipt test session.');
    if (receipt.status === 'published') assert(Number.isInteger(receipt.publishedVersion) && receipt.publishedVersion > receipt.baseVersion, 'Invalid published version.');
  }
  return catalog;
}

export async function applyReview(catalog, bundle, now = new Date().toISOString()) {
  validateCatalog(catalog);
  assert(plain(bundle) && bundle.kind === 'safar-seva-reviewed-contribution' && bundle.schemaVersion === 1, 'Invalid review bundle.');
  const packet = await validatePacket(bundle.contribution);
  assert(text(bundle.reviewerName, 100) && ['publish','decline'].includes(bundle.decision), 'A reviewer name and decision are required.');
  assert(bundle.humanReviewed === !Boolean(packet.testSession), packet.testSession ? 'Test reviews must be marked as simulations.' : 'A human must check the sources and meaning before publication.');
  assert(!catalog.receipts.some(item => item.id === packet.id && item.hash === packet.hash), 'This exact draft has already been reviewed.');
  const copy = structuredClone(catalog);
  const story = copy.stories.find(item => item.id === packet.storyId);
  assert(story, 'The story is not in this publication.');
  const receipt = { id: packet.id, hash: packet.hash, storyId: packet.storyId, baseVersion: packet.baseVersion, field: packet.field, status: bundle.decision === 'publish' ? 'published' : 'declined', reviewerName: bundle.reviewerName.trim(), reviewedAt: now, testSession: packet.testSession };
  if (bundle.decision === 'publish') {
    assert(story.version === packet.baseVersion && story[packet.field] === packet.originalText, 'This story has changed. Ask for a fresh draft against the current version.');
    assert(text(bundle.acceptedText, packet.field === 'title_mr' ? 160 : 2000) && bundle.acceptedText.trim() !== story[packet.field].trim(), 'Publication must make an actual wording change.');
    story[packet.field] = bundle.acceptedText.trim();
    assert(text(bundle.acceptedEnglish, packet.field === 'title_mr' ? 160 : 2000), 'Review the matching English wording before publication.');
    story[packet.field === 'title_mr' ? 'title_en' : 'body_en'] = bundle.acceptedEnglish.trim();
    story.version += 1;
    receipt.publishedVersion = story.version;
    story.appliedContributions.push({ id: packet.id, hash: packet.hash, field: packet.field, version: story.version });
  }
  copy.receipts.push(receipt);
  copy.updatedAt = now;
  copy.contentVersion = now;
  return validateCatalog(copy);
}

export function receiptFor(packet, catalog) {
  const receipt = catalog.receipts.find(item => item.id === packet.id && item.hash === packet.hash && item.storyId === packet.storyId && item.baseVersion === packet.baseVersion && item.field === packet.field && item.testSession === packet.testSession);
  if (!receipt) return null;
  if (receipt.status === 'declined') return receipt;
  const story = catalog.stories.find(item => item.id === packet.storyId);
  return story?.version >= receipt.publishedVersion && story.appliedContributions.some(item => item.id === packet.id && item.hash === packet.hash && item.field === packet.field && item.version === receipt.publishedVersion) ? receipt : null;
}
