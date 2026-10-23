import { addOptionalTask, swapTask } from './core.mjs';
import { receiptFor } from './contributions.mjs';

export function firstSentence(text) {
  return text.match(/^.*?[।.!?](?=\s|$)/su)?.[0] || text;
}

export function addShortTripStory(ride, pool) {
  if (ride.tasks.some(task => task.kind === 'learn')) return ride;
  const story = pool.find(task => task.kind === 'learn' && task.contentSnapshot?.format === 'story');
  return story ? addOptionalTask(ride, story) : ride;
}

export function swapCoherently(ride, id, replacement, pool, forms = {}) {
  let updated = swapTask(ride, id, replacement);
  const changed = [id];
  if (replacement.kind === 'learn' && replacement.storyId) {
    for (const give of updated.tasks.filter(task => task.kind === 'give' && task.status === 'pending')) {
      if (give.storyId === replacement.storyId || forms[give.id]?.text?.trim()) continue;
      const match = pool.find(task => task.kind === 'give' && task.storyId === replacement.storyId && !updated.tasks.some(other => other.id !== give.id && other.taskId === task.id));
      if (match) { updated = swapTask(updated, give.id, match); changed.push(give.id); }
    }
  }
  return { ride: updated, changed };
}

// A sentence edit becomes a complete replacement passage for version checking.
// No text outside the selected sentence is silently removed.
export function assembleSuggestion(instance, text, mode = 'sentence') {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Write a suggestion before saving.');
  const content = instance.contentSnapshot;
  if (mode === 'whole' || !content?.focusText || instance.targetField === 'title_mr') return text.trim();
  if (!instance.originalText.startsWith(content.focusText)) throw new Error('The selected sentence has changed. Open the latest story before editing.');
  return text.trim() + instance.originalText.slice(content.focusText.length);
}

export function suggestionInput(instance) {
  const full = instance.result?.text || '';
  const focus = instance.contentSnapshot?.focusText;
  if (!full) return { text: '', editMode: focus ? 'sentence' : 'whole' };
  if (focus) {
    const suffix = instance.originalText.slice(focus.length);
    if (!suffix || full.endsWith(suffix)) return { text: suffix ? full.slice(0, -suffix.length) : full, editMode: 'sentence' };
  }
  return { text: full, editMode: 'whole' };
}

export function matchingPacket(instance, packets) {
  return [...packets].reverse().find(packet => packet.id === `contribution:${instance.id}` && packet.storyId === instance.storyId && packet.baseVersion === instance.storyVersion && packet.field === instance.targetField && packet.suggestedText === instance.result?.text) || null;
}

export function contributionState(packet, catalog, handoffs = []) {
  if (!packet) return { stage: 'saved', receipt: null, stale: false };
  const receipt = receiptFor(packet, catalog);
  const story = catalog.stories.find(item => item.id === packet.storyId);
  const stale = !story || story.version !== packet.baseVersion || story[packet.field] !== packet.originalText;
  if (receipt) return { stage: receipt.status === 'published' ? 'used' : 'declined', receipt, stale };
  return { stage: handoffs.some(item => item.id === packet.id && item.hash === packet.hash) ? 'handed-over' : 'ready', receipt: null, stale };
}

// A revision is a new optional card. The earlier draft, its receipt, and any
// earned participation stamp remain intact.
export function startRevision(ride, packet, story, template, revisionId = crypto.randomUUID()) {
  if (story.id !== packet.storyId) throw new Error('Choose the same story for this revision.');
  const task = {
    ...template, id: `give-revision-${revisionId}`, kind: 'give', storyId: story.id,
    storyVersion: story.version, targetField: packet.field, originalText: story[packet.field],
    contentSnapshot: {
      ...template.contentSnapshot, id: `give-revision-${revisionId}`, kind: 'give',
      title_mr: 'तुमची सूचना अद्ययावत करा', title_en: 'Update your saved suggestion',
      body_mr: 'नवीन मजकूर आणि तुमची आधीची सूचना पाहून सुधारणा करा. आधीचा मसुदा वहीत जपला आहे.',
      body_en: 'Compare the latest wording with your earlier suggestion. Your earlier draft is kept in your notebook.',
      storyTitle_mr: story.title_mr, storyTitle_en: story.title_en,
      storyBody_mr: story.body_mr, storyBody_en: story.body_en, sources: story.sources,
      focusText: undefined, revisionOf: { id: packet.id, hash: packet.hash },
    },
  };
  return addOptionalTask(ride, task);
}

export function matchGivingPreservingDraft(ride, id, replacement) {
  const previous = ride.tasks.find(task => task.id === id);
  if (!previous || previous.kind !== 'give' || previous.status !== 'pending' || replacement.kind !== 'give') throw new Error('Only an unfinished giving draft can be kept and replaced.');
  const appended = addOptionalTask(ride,replacement), fresh = appended.tasks.at(-1);
  return { ...appended, tasks: [...ride.tasks.map(task => task.id === id ? { ...fresh, optional:previous.optional } : task), { ...previous, optional:true }] };
}
