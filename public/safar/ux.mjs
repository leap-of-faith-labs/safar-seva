// Presentation helpers use the bundled network and season, never live travel claims.
export function routeContext(route, lines) {
  let states = [{ segments: [] }];
  for (let index = 1; index < route.length; index++) {
    const choices = lines.filter(line => line.stations.some((id, i, ids) =>
      id === route[index - 1] && (ids[i - 1] === route[index] || ids[i + 1] === route[index])));
    if (!choices.length) return { segments: [], upcoming: false };
    states = choices.map(line => {
      const candidates = states.map(state => {
        const segments = state.segments.at(-1)?.id === line.id ? state.segments : [...state.segments, line];
        return { segments };
      });
      return candidates.sort((a, b) => a.segments.length - b.segments.length)[0];
    });
  }
  const segments = states.sort((a, b) => a.segments.length - b.segments.length)[0].segments;
  return { segments, upcoming: segments.some(line => line.status === 'upcoming') };
}

export function seasonDates(season) {
  const format = date => new Date(date).toLocaleDateString('en-GB', {day:'numeric',month:'short',timeZone:'Asia/Kolkata'});
  return { start:format(season.startAt), end:format(Date.parse(season.endAtExclusive) - 1) };
}

// One action per form at a time. Errors restore all controls for a corrected retry.
export async function runFormAction(button, action, { reducedMotion = false } = {}) {
  const form = button.closest('form');
  if (button.disabled || form?.dataset.busy === 'true') return false;
  const buttons = [...(form?.querySelectorAll('button') || [button])];
  const disabled = buttons.map(control => control.disabled);
  if (form) { form.dataset.busy = 'true'; form.setAttribute('aria-busy', 'true'); }
  buttons.forEach(control => { control.disabled = true; });
  button.classList.add('move-picked');
  try {
    if (!reducedMotion) await new Promise(resolve => setTimeout(resolve, 180));
    await action();
    return true;
  } finally {
    buttons.forEach((control, index) => { control.disabled = disabled[index]; });
    button.classList.remove('move-picked');
    if (form) { delete form.dataset.busy; form.removeAttribute('aria-busy'); }
  }
}
