import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {routeContext, seasonDates, runFormAction} from '../public/safar/ux.mjs';
import {linkStations, getRouteStationIds, completeTask, getLedgerStats} from '../public/safar/core.mjs';
import {createLightRide} from '../public/safar/lightweight.mjs';
import {hydrateTasks} from '../public/safar/journey.mjs';
import {parseStoredState} from '../public/safar/storage.mjs';
import {addImpression} from '../public/safar/stamps.mjs';
const read = async file => JSON.parse(await readFile(new URL(`../public/safar/${file}`,import.meta.url),'utf8'));
const network = await read('stations.json'), season = await read('season.json');
const stations = linkStations(network.stations,network.lines);

test('route context follows actual network lines in either direction', () => {
  for(const line of network.lines) {
    for(const route of [line.stations,line.stations.toReversed()]) {
      const context = routeContext(route,network.lines);
      assert.deepEqual(context.segments.map(item => item.id),[line.id]);
      assert.equal(context.upcoming,line.status === 'upcoming');
    }
  }
});
test('an interchange route names both lines and only marks upcoming segments', () => {
  const context = routeContext(getRouteStationIds(stations,'vanaz','swargate'),network.lines);
  assert.deepEqual(context.segments.map(line => line.id),['aqua','purple']);
  assert.equal(context.upcoming,false);
  assert.equal(routeContext(getRouteStationIds(stations,'vanaz',network.lines[2].stations[0]),network.lines).upcoming,true);
});
test('season labels use India dates and the inclusive last day', () => {
  assert.deepEqual(seasonDates(season),{start:'24 Oct',end:'28 Nov'});
});
function fakeForm() {
  const form = {dataset:{},setAttribute(){},removeAttribute(){},querySelectorAll(){return buttons;}};
  const buttons = [false,false,true].map(disabled => ({disabled,classList:{add(){},remove(){}},closest(){return form;}}));
  return {form,buttons};
}
test('rapid competing answers run once and restore previous disabled controls', async () => {
  const {form,buttons} = fakeForm();
  let resolve, count = 0;
  const waiting = new Promise(done => {resolve=done;});
  const first = runFormAction(buttons[0],async () => {count++;await waiting;},{reducedMotion:true});
  assert.equal(form.dataset.busy,'true');
  assert.equal(await runFormAction(buttons[1],() => count++,{reducedMotion:true}),false);
  resolve(); await first;
  assert.equal(count,1);
  assert.deepEqual(buttons.map(button => button.disabled),[false,false,true]);
  assert.equal(form.dataset.busy,undefined);
});
test('an invalid answer restores controls and allows a corrected retry', async () => {
  const {form,buttons} = fakeForm();
  await assert.rejects(runFormAction(buttons[0],() => {throw Error('invalid time');},{reducedMotion:true}));
  assert.equal(form.dataset.busy,undefined);
  assert.equal(await runFormAction(buttons[0],() => {},{reducedMotion:true}),true);
});
test('a completed full-line ride and decorative stamps survive ledger roundtrip', async () => {
  const catalog = await read('stories.json'), taskData = await read('tasks.json');
  let ride = createLightRide({stations,tasks:hydrateTasks(taskData.tasks,catalog),catalog,from:'vanaz',to:'ramwadi'});
  ride = completeTask(ride,ride.tasks[0].id,{acknowledged:true});
  ride = completeTask(ride,ride.tasks[1].id,{text:ride.tasks[1].contentSnapshot.choices[0].mr});
  ride = completeTask(ride,ride.tasks[2].id,{stationId:'ramwadi',feature:ride.tasks[2].feature,answer:'not_observed'});
  ride.stamp.impressions=0; ride=addImpression(ride);
  const saved = parseStoredState(JSON.stringify({schemaVersion:1,rides:[ride],currentRideId:ride.id,currentTaskId:ride.tasks[2].id,forms:{}}));
  assert.equal(saved.rides[0].stamp.impressions,1);
  assert.equal(getLedgerStats(saved.rides).completedRides,1);
});
test('every offline asset exists and the release includes UX modules', async () => {
  await import('../public/safar/assets.js');
  assert.ok(globalThis.SAFAR_OFFLINE_ASSETS.includes('./ux.mjs'));
  assert.ok(globalThis.SAFAR_OFFLINE_ASSETS.includes('./ux.css'));
  for(const file of globalThis.SAFAR_OFFLINE_ASSETS.filter(file => file !== './')) await readFile(new URL(`../public/safar/${file}`,import.meta.url));
});
