import { describe, it, expect } from "vitest";
import data from "../../public/safar/stations.json";
// @ts-expect-error plain JS module
import { linkStations, getRouteStationIds, getStopCount } from "../../public/safar/core.mjs";
const net = linkStations(data.stations, data.lines);
describe("multi-line routes", () => {
  it("Vanaz to Ramwadi stays on Aqua (15 stops)", () => expect(getStopCount(net, "vanaz", "ramwadi")).toBe(15));
  it("PCMC to Swargate on Purple passes Civil Court", () => {
    const r = getRouteStationIds(net, "pcmc", "swargate");
    expect(r).toContain("district-court"); expect(r.at(-1)).toBe("swargate");
  });
  it("Vanaz to Swargate changes at Civil Court", () => {
    const r = getRouteStationIds(net, "vanaz", "swargate");
    expect(r).toContain("district-court"); expect(r).not.toContain("ramwadi");
  });
  it("Hinjewadi line connects via Shivajinagar", () => expect(getRouteStationIds(net, "hinjewadi", "ramwadi")).toContain("shivajinagar"));
});
