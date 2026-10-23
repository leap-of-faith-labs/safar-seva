export const $ = selector => document.querySelector(selector);
export const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
export function localTime(iso) {
  if (!Number.isFinite(Date.parse(iso))) return 'Unknown time';
  return new Intl.DateTimeFormat('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit', timeZone:'Asia/Kolkata' }).format(new Date(iso)) + ' IST';
}
export function istInput(iso = new Date().toISOString()) {
  return new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0,16);
}
export function sourceLinks(sources = []) {
  return sources.length ? `<details class="source-links"><summary>स्रोत · Sources (${sources.length})</summary><ul>${sources.map(source => `<li><a href="${escapeHTML(source.url)}" target="_blank" rel="noopener noreferrer" lang="en">${escapeHTML(source.title)} ↗</a></li>`).join('')}</ul><small lang="en">External links need a connection. These describe the story, not live station conditions.</small></details>` : '';
}
export function downloadJSON(data, filename) {
  const json = JSON.stringify(data, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type:'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return json;
}
