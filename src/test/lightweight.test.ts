// @ts-ignore Authored static-app modules intentionally remain plain JavaScript.
import { createLightRide, choiceTask, invitationURL, readInvitation } from '../../public/safar/lightweight.mjs';
// @ts-ignore Static app core.
import { completeTask } from '../../public/safar/core.mjs';
// @ts-ignore Static app storage.
import { parseStoredState } from '../../public/safar/storage.mjs';
import stationsData from '../../public/safar/stations.json';
import catalog from '../../public/safar/stories.json';
import taskData from '../../public/safar/tasks.json';
// @ts-ignore Static app hydration.
import { hydrateTasks } from '../../public/safar/journey.mjs';
import { describe, expect, it } from 'vitest';

const stations = stationsData.stations;
const tasks = hydrateTasks(taskData.tasks, catalog);
const now = '2026-10-23T21:43:00.000Z';
const makeRide = (to = 'ramwadi') => createLightRide({ stations, tasks, catalog, from:'vanaz', to, now, id:'test-ride' });

describe('Lightweight rides', () => {
  it('offers Learn, a two-option Give, and Notice even on a one-stop ride', () => {
    const ride = makeRide('anand-nagar');
    expect(ride.tasks.map((task: {kind:string}) => task.kind)).toEqual(['learn','give','check']);
    expect(ride.tasks[1].contentSnapshot.choices).toHaveLength(2);
  });
  it('accepts either offered title and rejects an invented choice', () => {
    const ride = makeRide(), give = ride.tasks[1];
    for (const choice of give.contentSnapshot.choices) expect(completeTask(ride,give.id,{text:choice.mr},now).tasks[1].result.text).toBe(choice.mr);
    expect(() => completeTask(ride,give.id,{text:'not an offered title'},now)).toThrow();
  });
  it('keeps a completed ride and stamp readable after saving', () => {
    let ride = makeRide();
    ride = completeTask(ride,ride.tasks[0].id,{acknowledged:true},now);
    ride = completeTask(ride,ride.tasks[1].id,{text:ride.tasks[1].contentSnapshot.choices[0].mr},now);
    ride = completeTask(ride,ride.tasks[2].id,{stationId:'ramwadi',feature:ride.tasks[2].feature,answer:'not_observed'},now);
    expect(ride.stamp.kind).toBe('participation');
    expect(parseStoredState(JSON.stringify({schemaVersion:1,rides:[ride],currentRideId:ride.id,currentTaskId:ride.tasks[2].id,forms:{}})).rides[0].stamp.id).toBe('test-ride:stamp');
  });
  it('shares only station and story identifiers in a fragment, not notebook data', () => {
    const ride = {...makeRide(),secret:'private-note'};
    const url = invitationURL('https://safar.lofl.world/safar/index.html?test=private#ledger',ride);
    expect(new URL(url).search).toBe('');
    expect(url).not.toContain('private');
    expect([...new URLSearchParams(new URL(url).hash.slice(1)).keys()]).toEqual(['together','from','to','story']);
    expect(readInvitation(new URL(url).hash,stations,catalog)).toEqual({from:'vanaz',to:'ramwadi',storyId:'story-vanaz'});
  });
  it('rejects unknown stations and extra invitation data', () => {
    expect(() => readInvitation('#together=1&from=unknown&to=ramwadi',stations,catalog)).toThrow();
    expect(() => readInvitation('#together=1&from=vanaz&to=ramwadi&note=secret',stations,catalog)).toThrow();
  });
  it('provides exactly two different title choices for all eight stories', () => {
    for (const story of catalog.stories) {
      const choices = choiceTask(story).choices;
      expect(choices).toHaveLength(2);
      expect(choices[0].mr).not.toBe(choices[1].mr);
    }
  });
});