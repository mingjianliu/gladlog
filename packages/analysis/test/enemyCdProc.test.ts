/**
 * FT-T06: an activation of another cooldown's effect (no button, no cooldown
 * of its own — Radiant Glory's Avenging Wrath) is a proc on the [ENEMY CD]
 * line, with the cast it came with; a pressed cooldown keeps `(cast k of N)`.
 */
import { LogEvent } from "@gladlog/parser-compat";
import { describe, expect, it } from "vitest";

import {
  emitEnemyCdEntries,
  procOrdinal,
} from "../src/context/timelineSections/enemyCd";

const T0 = 1_000_000;
const cast = (spellId: string, spellName: string, atS: number) =>
  ({
    spellId,
    spellName,
    logLine: { event: LogEvent.SPELL_CAST_SUCCESS, timestamp: T0 + atS * 1000, parameters: [] },
  }) as never;
const cd = (spellId: string, spellName: string, atS: number, activation: boolean) =>
  ({
    spellId,
    spellName,
    castTimeSeconds: atS,
    cooldownSeconds: activation ? 0 : 90,
    availableAgainAtSeconds: activation ? null : atS + 90,
    dangerWeight: 2,
    buffEndSeconds: atS + 8,
  }) as never;

function render() {
  const lines: string[] = [];
  const out = emitEnemyCdEntries({
    enemyCDTimeline: {
      players: [
        {
          playerName: "Ret",
          specName: "Retribution Paladin",
          offensiveCDs: [
            cd("454351", "Avenging Wrath", 6, true),
            cd("454351", "Avenging Wrath", 36, true),
            cd("19574", "Bestial Wrath", 11, false),
            cd("19574", "Bestial Wrath", 48, false),
          ],
        },
      ],
    },
    cdPurgeAnnotations: new Map(),
    addEntry: (_t: number, l: string) => lines.push(l),
    enemyPid: (n: string) => `4(${n})`,
    enemies: [
      {
        name: "Ret",
        spellCastEvents: [
          // a trinket macro'd to the first press shares its ms once: not the trigger
          cast("345228", "Gladiator's Badge", 6),
          cast("255937", "Wake of Ashes", 6),
          cast("454351", "Avenging Wrath", 6),
          cast("255937", "Wake of Ashes", 36),
          cast("454351", "Avenging Wrath", 36),
        ],
      },
    ],
    matchStartMs: T0,
  } as never);
  return { lines, out };
}

describe("FT-T06 — [ENEMY CD] proc", () => {
  it("被带出来的效果印 proc 和带它出来的施放;按出来的仍是 cast k of N", () => {
    const { lines, out } = render();
    expect(lines).toEqual([
      "0:06  [ENEMY CD]   4(Ret) (Retribution Paladin): Avenging Wrath (proc 1 of 2, with Wake of Ashes)",
      "0:11  [ENEMY CD]   4(Ret) (Retribution Paladin): Bestial Wrath (cast 1 of 2)",
      "0:36  [ENEMY CD]   4(Ret) (Retribution Paladin): Avenging Wrath (proc 2 of 2, with Wake of Ashes)",
      "0:48  [ENEMY CD]   4(Ret) (Retribution Paladin): Bestial Wrath (cast 2 of 2)",
    ]);
    expect(out).toMatchObject({ ordinalRendered: true, procRendered: true });
  });

  it("procOrdinal:只有一次时不带序号", () => {
    expect(procOrdinal(1, 1, "Wake of Ashes")).toBe(" (proc, with Wake of Ashes)");
    expect(procOrdinal(1, 1, undefined)).toBe(" (proc)");
  });

  it("只同毫秒出现过一次的施放不被说成触发源", () => {
    const lines: string[] = [];
    emitEnemyCdEntries({
      enemyCDTimeline: {
        players: [
          {
            playerName: "Ret",
            specName: "Retribution Paladin",
            offensiveCDs: [cd("454351", "Avenging Wrath", 6, true)],
          },
        ],
      },
      cdPurgeAnnotations: new Map(),
      addEntry: (_t: number, l: string) => lines.push(l),
      enemyPid: (n: string) => `4(${n})`,
      enemies: [
        {
          name: "Ret",
          spellCastEvents: [cast("255937", "Wake of Ashes", 6), cast("454351", "Avenging Wrath", 6)],
        },
      ],
      matchStartMs: T0,
    } as never);
    expect(lines).toEqual([
      "0:06  [ENEMY CD]   4(Ret) (Retribution Paladin): Avenging Wrath (proc)",
    ]);
  });
});
