// @ts-ignore Authored static app modules remain plain JavaScript.
import { impressionCount, addImpression } from '../../public/safar/stamps.mjs';
// @ts-ignore Static ride core.
import { completeTask, getLedgerStats, makeExport } from '../../public/safar/core.mjs';
// @ts-ignore Static app builder.
import { createLightRide } from '../../public/safar/lightweight.mjs';
// @ts-ignore Static app hydration.
import { hydrateTasks } from '../../public/safar/journey.mjs';
// @ts-ignore Static ledger validation.
import { parseStoredState } from '../../public/safar/storage.mjs';
import stationsData from '../../public/safar/stations.json';
import catalog from '../../public/safar/stories.json';
import taskData from '../../public/safar/tasks.json';
import { describe, expect, it } from 'vitest';

function completedRide() {
  let ride = createLightRide({stations:stationsData.stations,tasks:hydrateTasks(taskData.tasks,catalog),catalog,from:'vanaz',to:'ramwadi',id:'stamp-test'});
  ride = completeTask(ride,ride.tasks[0].id,{acknowledged:true});
  ride = completeTask(ride,ride.tasks[1].id,{text:ride.tasks[1].contentSnapshot.choices[0].mr});
  return completeTask(ride,ride.tasks[2].id,{stationId:'ramwadi',feature:ride.tasks[2].feature,answer:'not_observed'});
}
const save = (ride: ReturnType<typeof completedRide>) => JSON.stringify({schemaVersion:1,rides:[ride],currentRideId:ride.id,currentTaskId:null,forms:{}});
describe('Stamp impressions', () => {
  it('increments the impression counter and keeps a single participation award', () => {
    const initial = completedRide(); initial.stamp.impressions = 0;
    const once = addImpression(initial,99), twice = addImpression(once,99);
    expect(impressionCount(initial)).toBe(0);
    expect(impressionCount(once)).toBe(1);
    expect(impressionCount(twice)).toBe(2);
    expect(getLedgerStats([twice]).completedRides).toBe(1);
    expect(makeExport([twice]).stamps).toHaveLength(1);
    expect(parseStoredState(save(twice)).rides[0].stamp.impressions).toBe(2);
  });
  it('preserves older stamps as one impression without rewriting the award', () => {
    const old = completedRide();
    expect(impressionCount(old)).toBe(1);
    expect(addImpression(old,99).stamp.id).toBe(old.stamp.id);
    expect(addImpression(old,99).stamp.awardedAt).toBe(old.stamp.awardedAt);
    expect(impressionCount(addImpression(old,99))).toBe(2);
  });
  it('does not stamp an unfinished ride', () => {
    expect(() => addImpression({stamp:null})).toThrow('Finish your ride');
  });
  it('rejects malformed stored impression counters', () => {
    for (const count of [-1, 1.5, '2']) {
      const ride = completedRide(); ride.stamp.impressions = count;
      expect(() => parseStoredState(save(ride))).toThrow('impressions');
    }
  });
});
// @ts-ignore Static stamp gating.
import { earnedImpressions, canStamp, markInvited, aiSessionUnlocked } from '../../public/safar/stamps.mjs';
describe('Stamp gating', () => {
  it('allows only one impression for a plain finished ride', () => {
    const ride = completedRide(); ride.stamp.impressions = 0;
    const once = addImpression(ride, earnedImpressions(ride));
    expect(canStamp(once, earnedImpressions(once))).toBe(false);
    expect(() => addImpression(once, earnedImpressions(once))).toThrow('Earn another stamp');
  });
  it('earns one more impression for an invitation and each later story read', () => {
    const ride = markInvited(completedRide());
    expect(earnedImpressions(ride)).toBe(2);
    expect(earnedImpressions(markInvited(ride))).toBe(2);
    expect(earnedImpressions(ride, { laterReads: 1 })).toBe(3);
  });
  it('unlocks AI for ALL at three impressions on one ride', () => {
    const ride = completedRide();
    ride.stamp.impressions = 2; expect(aiSessionUnlocked(ride)).toBe(false);
    ride.stamp.impressions = 3; expect(aiSessionUnlocked(ride)).toBe(true);
  });
});

// @ts-ignore Static Yatra badges.
import { yatraBadges } from '../../public/safar/stamps.mjs';
describe('Diwali Yatra badges', () => {
  it('earns badges at 1, 4 and 8 stories', () => {
    const earned = (n: number) => yatraBadges(n).filter((b: {earned: boolean}) => b.earned).length;
    expect(earned(0)).toBe(0); expect(earned(1)).toBe(1); expect(earned(3)).toBe(1);
    expect(earned(4)).toBe(2); expect(earned(8)).toBe(3);
  });
});
