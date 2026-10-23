import { validatePacket, validateCatalog, applyReview } from './contributions.mjs';
import { $, escapeHTML as e, sourceLinks, downloadJSON, localTime } from './ui.mjs';
const session = new URLSearchParams(location.search).get('test') || null;
let packet, catalog, token;
async function json(url, options = {}) { const response = await fetch(url,{cache:'no-store',...options}); const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Could not load the publication.'); return body; }
async function publication() { const base=validateCatalog(await json('./stories.json'));if(!session)return base;const test=await json('./test-publication.json');return validateCatalog(test.sessions?.[session]||base); }
function error(message){$('#review-error').textContent=message;}
async function load(raw) {
  error('');if(raw.length>65536)throw new Error('Contribution file exceeds 64 KB.');
  const candidate=await validatePacket(JSON.parse(raw));
  if(candidate.testSession!==session)throw new Error(`This file belongs to ${candidate.testSession?'test session '+candidate.testSession:'the real publication'}. Open the matching review desk; test files cannot publish to the real app.`);
  catalog=await publication();packet=candidate;
  const story=catalog.stories.find(story=>story.id===packet.storyId);if(!story)throw new Error('Unknown story.');
  const stale=story.version!==packet.baseVersion||story[packet.field]!==packet.originalText;
  const already=catalog.receipts.some(receipt=>receipt.id===packet.id&&receipt.hash===packet.hash);
  $('#review-detail').hidden=false;$('#review-result').hidden=true;
  $('#review-detail').innerHTML=`<div class="section-header"><div><p class="eyebrow" lang="en">${e(story.id)} · DRAFT AGAINST VERSION ${packet.baseVersion}</p><h2>${e(story.title_mr)}</h2></div><span class="badge">${session?'TEST ONLY':'Contribution for human review'}</span></div>${sourceLinks(story.sources)}${stale?'<p class="warning">This story has changed. A fresh draft is required before publishing.</p>':''}${already?'<p class="warning">This exact draft has already been reviewed.</p>':''}<div class="review-comparison"><div><h3>मूळ मजकूर <small lang="en">Original</small></h3><p>${e(packet.originalText)}</p></div><div><h3>सुचवलेला बदल <small lang="en">Suggestion</small></h3><p>${e(packet.suggestedText)}</p></div></div><form id="review-form"><label for="reviewer-name">पुनरावलोकन करणाऱ्याचं नाव <small lang="en">Public reviewer name</small></label><input id="reviewer-name" name="reviewerName" maxlength="100" required placeholder="${session?'Test reviewer (simulation)':'Your name or editorial role'}"><label for="accepted-text">प्रकाशित करायचा मराठी मजकूर <small lang="en">Final Marathi wording</small></label><textarea id="accepted-text" name="acceptedText" maxlength="${packet.field==='title_mr'?160:2000}" required>${e(packet.suggestedText)}</textarea><label for="accepted-english">जुळणारा इंग्रजी मजकूर <small lang="en">Matching English wording</small></label><textarea id="accepted-english" name="acceptedEnglish" maxlength="2000" required>${e(story[packet.field==='title_mr'?'title_en':'body_en'])}</textarea><p class="task-hint" lang="en">Keep the facts and meaning aligned in both languages. Your public reviewer name and the accepted wording appear in the publication; declined draft text and journey history do not.</p><label class="permission-label"><input id="review-confirm" type="checkbox" required><span>${session?'Test: simulate the review step. This creates no real human-review claim.':'मी स्रोत, अर्थ आणि दोन्ही भाषांतील मजकूर तपासला आहे. I have checked the sources, meaning, and wording in both languages. I am reviewing another contributor’s work.'}</span></label><div class="review-buttons"><button id="publish-review" class="primary-button" type="submit" ${!token||stale||already?'disabled':''}>${session?'Publish to this test session':'प्रकाशित करा · Publish locally'}</button><button id="export-review" class="secondary-button" type="button" ${stale||already?'disabled':''}>Reviewed bundle डाउनलोड करा</button><button id="decline-review" class="text-button" type="button" ${!token||already?'disabled':''}>स्वीकारू नका · Do not adopt</button></div><p class="field-error" role="alert"></p></form>`;
  $('#review-form').addEventListener('submit',async event=>{event.preventDefault();await publish('publish');});
  $('#export-review').addEventListener('click',async()=>{try{const bundle=await makeBundle('publish');$('#reviewed-json').value=downloadJSON(bundle,`safar-seva-${session?'TEST-':''}reviewed-${packet.hash.slice(0,10)}.json`);$('#reviewed-preview').hidden=false;$('#reviewed-preview').open=true;}catch(err){$('#review-form .field-error').textContent=err.message;}});
  $('#decline-review').addEventListener('click',()=>publish('decline'));
}
async function makeBundle(decision){
  if(!$('#review-form').reportValidity())throw new Error('Complete the reviewer name and review confirmation.');
  const values=Object.fromEntries(new FormData($('#review-form')));
  const bundle={kind:'safar-seva-reviewed-contribution',schemaVersion:1,contribution:packet,decision,reviewerName:values.reviewerName.trim(),humanReviewed:!Boolean(session),acceptedText:values.acceptedText,acceptedEnglish:values.acceptedEnglish};
  await applyReview(catalog,bundle);return bundle;
}
async function publish(decision){
  const button=$('#publish-review');button.disabled=true;
  try{
    if(!token)throw new Error('Use npm run dev for local publishing, or export a reviewed bundle.');
    const bundle=await makeBundle(decision);
    const result=await json('/__editor/publish',{method:'POST',headers:{'Content-Type':'application/json','X-Safar-Editor':'1','X-Safar-Token':token},body:JSON.stringify(bundle)});
    catalog=await publication();
    $('#review-result').hidden=false;
    $('#review-result').innerHTML=`<div class="publication-success"><h2>${decision==='publish'?'बदल आवृत्तीत वापरला!':'निर्णय नोंदवला.'}</h2><p lang="en">${session?'TEST ONLY · ':''}${result.receipt.status==='published'?`Accepted wording is now in story version ${result.receipt.publishedVersion}.`:'The suggestion was not adopted.'} Receipt recorded ${e(localTime(result.receipt.reviewedAt))}.</p><a class="secondary-button" href="./${session?'?test='+encodeURIComponent(session):''}#${e(packet.storyId)}">प्रवासी अॅपमध्ये कथा पाहा · Read the story →</a><p class="task-hint" lang="en">On the originating device, use “Check publication” to match the receipt to the exact shared draft. A local publication still needs deployment before remote riders can see it.</p></div>`;
    $('#export-review').disabled=true;$('#decline-review').disabled=true;$('#review-result').scrollIntoView({behavior:'smooth'});
  }catch(err){$('#review-form .field-error').textContent=err.message;button.disabled=!token;}
}
$('#contribution-file').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>65536)throw new Error('Contribution file exceeds 64 KB.');await load(await file.text());}catch(err){error(err.message);}});
$('#load-contribution').addEventListener('click',async()=>{try{await load($('#paste-contribution').value);}catch(err){error(err.message);}});
if(session){$('#review-mode').hidden=false;$('#review-mode').textContent=`TEST REVIEW (${session}) · Only this test session’s story publication can change. No real review receipt is created.`;$('#back-to-rider').href='./?test='+encodeURIComponent(session);}
try{const config=await json('/__editor/config',{headers:{'X-Safar-Editor':'1'}});token=config.token;$('#editor-status').textContent='Local publication is available. Changes stay in this checkout until deployed.';}catch{$('#editor-status').textContent='Local publishing is unavailable here. Import and review a contribution, then export a reviewed bundle for your trusted local checkout.';}
