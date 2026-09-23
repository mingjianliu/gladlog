/**
 * GH #103 A7: a STAYED IN line gives the nearest-enemy distance range over
 * the window when it leaves the endpoint span. The responder read "8→3.3yd"
 * as "stayed within 3.3–8yd throughout 2:38–2:48" while the owner had been
 * at 15yd at 2:46 (match bef98ca1).
 */
import { describe, expect, it } from "vitest";

import {
  formatPositionEventsForContext,
  IPositionEvent,
} from "../src/utils/positionAnalysis";

const stayed = (over: Partial<IPositionEvent>): IPositionEvent => ({
  type: "STAYED_IN",
  atSeconds: 158,
  toSeconds: 168,
  startDistanceYards: 8,
  endDistanceYards: 3.3,
  nearestEnemyName: "Todory-MoonGuard-US",
  dangerLabel: "High",
  burstTargetsOwner: true,
  ...over,
});

const stayedLine = (e: IPositionEvent) =>
  formatPositionEventsForContext([e]).find((l) => l.includes("[High burst]"))!;

describe("STAYED IN distance range (GH #103 A7)", () => {
  it("renders the range when the window went beyond the endpoints", () => {
    const line = stayedLine(
      stayed({ minDistanceYards: 3.3, maxDistanceYards: 15 }),
    );
    expect(line).toContain(
      "8→3.3yd from Todory-MoonGuard-US (nearest enemy 3.3–15yd over the window)",
    );
  });

  it("omits it when the window stayed inside the endpoint span", () => {
    const line = stayedLine(
      stayed({ minDistanceYards: 3.3, maxDistanceYards: 8 }),
    );
    expect(line).not.toContain("nearest enemy");
  });

  it("keeps `yd from <name>` adjacent for the G4 gate pattern", () => {
    const line = stayedLine(
      stayed({ minDistanceYards: 2, maxDistanceYards: 15 }),
    );
    expect(line).toMatch(
      /^ +(\d+:\d{2})(?:–\d+:\d{2})? \[[^\]]+ burst\] (?:opened )?([\d.]+)→([\d.]+)yd from (\S+)/,
    );
  });
});
