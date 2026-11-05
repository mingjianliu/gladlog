/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, spellCastEvents) */
/**
 * scan5/listGap.ts — class 3 of the round-7 audit (fact7 F21, D7 D8 D16 D45
 * D51 D55 D69 D75 D78): a real cooldown press with no line in the prompt. The
 * forward half of the Curated-List Completeness Rule for the hand rosters a
 * press has to pass to be printed (`classMetadata`, `OFFENSIVE_CD_SPELL_IDS`,
 * `SPELL_EFFECT_OVERRIDES`): the ids come from the log, not from the audit.
 *
 * Log truth, rows only: every player's SPELL_CAST_SUCCESS inside the round
 * whose official cooldown (DB2, `effectiveCooldownSeconds`, ≥ 30 s) makes it a
 * major button. Rendered truth, the context text only:
 *  - `pressLine`: a timeline line of a press tag within 1 s of the press that
 *    names the spell with this caster behind it (a damage / CC tag naming it —
 *    `[CC BROKEN] … ← Odyn's Fury` — is no press line, and another player's
 *    line of the same spell is no line of this press);
 *  - `kit`: the caster's `<cooldowns>` row names it.
 *
 * Kinds: `<filled|listed|offList|offListUnder45>/<side>/<noLine|kitOnly>`.
 * `offList` is what the class is about: on none of the roster keys, with an
 * official cooldown of `PRESS_LINE_MIN_CD_SECONDS` or more — the `[PRESS]`
 * line's (GH #176, user ruling 2026-11-02), and so is a picked button under
 * it (`PRESS_LINE_WHITELIST_IDS`, GH #183), so it must reach 0;
 * `offListUnder45` is every other button under it, left out by the user's
 * picks. `filled` labels the ids the
 * class fix answers for, which must reach 0. `form/<side>/noLine` is a
 * no-button form's APPLIED row (Void Metamorphosis 1217607, D69) no `[PROC]` /
 * `[ENEMY CD]` line names. `report()` prints the ranked gap list, one row per
 * id. A press some other family carries (a press tag of its own) is no gap:
 * `PRESS_LINE_TAG` lists them; a PvP trinket's line names no spell, its tag
 * does. A press that spent no cooldown (`unreleasedHoldMs`) is no press.
 * The rosters, the tags and the caster reading are the renderer's own
 * (`utils/offListPress.ts`: `isRosterPressId`, `lineStatesPress`).
 */
import { effectiveCooldownSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import {
  MIN_CD_SECONDS,
  unreleasedHoldMs,
} from "@gladlog/analysis/src/utils/cooldowns";
import {
  FILLED_HEAL_IDS,
  isOffListPressId,
  isRosterPressId,
  lineStatesPress,
  pressLineCaster,
  TRINKET_LINE_IDS,
} from "@gladlog/analysis/src/utils/offListPress";
import { OFFENSIVE_PRESS_FACT_IDS } from "@gladlog/analysis/src/utils/spellDanger";

import { ev, type IRoundCtx, nameOf, tsOf } from "./ctx";

export const CHECKS = ["listGapPress"] as const;

const LINE_AT = /^\s*(\d+):(\d\d)\s+(.*)$/;
const TRINKET_TAG = /\[(ENEMY )?TRINKET\]/;
/** a form with no button: nothing presses it (D69) */
const FORM_AURAS = new Set(["1217607"]);

interface IGapRow {
  name: string;
  cd: number;
  casts: number;
  rounds: Set<string>;
  specs: Map<string, number>;
  kinds: Map<string, number>;
}
let gaps = new Map<string, IGapRow>();

/** a unit's kit row: the text of the `<cooldowns>` after its `<unit>` tag */
function kitOf(lines: string[], name: string): string {
  const i = lines.findIndex((l) => l.includes(`name="${name}"`));
  if (i < 0) return "";
  for (let j = i; j < Math.min(i + 6, lines.length); j++)
    if (lines[j]!.includes("<cooldowns>")) return lines[j]!;
  return "";
}

export function run(ctx: IRoundCtx): void {
  const ownerPid = ctx.pidOf(ctx.owner.name);
  const friendly = new Set(
    ctx.players
      .filter((u) => u.info?.teamId === ctx.owner.info?.teamId)
      .map((u) => u.id),
  );
  const timed = ctx.lines
    .map((l) => {
      const m = LINE_AT.exec(l);
      return m ? { t: +m[1]! * 60 + +m[2]!, text: m[3]! } : undefined;
    })
    .filter((x): x is { t: number; text: string } => x !== undefined);
  for (const unit of ctx.players) {
    const kit = kitOf(ctx.lines, unit.name);
    const pid = ctx.pidOf(unit.name);
    const side =
      unit.id === ctx.owner.id
        ? "owner"
        : friendly.has(unit.id)
          ? "ally"
          : "enemy";
    for (const a of (unit.auraEvents ?? []) as any[]) {
      if (ev(a) !== "SPELL_AURA_APPLIED" || !FORM_AURAS.has(a.spellId))
        continue;
      if (a.srcUnitId !== unit.id || a.destUnitId !== unit.id) continue;
      const at = tsOf(a);
      if (at < ctx.start || at > ctx.roundEndAt) continue;
      ctx.bump("listGapPress");
      const name = nameOf(a.spellId, a.spellName ?? "");
      const sec = Math.floor((at - ctx.start) / 1000);
      if (
        timed.some(
          (l) =>
            Math.abs(l.t - sec) <= 1 &&
            l.text.includes(name) &&
            /\[PROC\]|\[ENEMY CD\]/.test(l.text) &&
            pressLineCaster(l.text, name, ownerPid) === pid,
        )
      )
        continue;
      ctx.violate(
        "listGapPress",
        `form/${side}/noLine`,
        at,
        `${unit.name}#${a.spellId}#${at}`,
        `${unit.name} (${unit.spec}) ${name} ${a.spellId} APPLIED at +${at - ctx.start}ms`,
      );
    }
    for (const c of (unit.spellCastEvents ?? []) as any[]) {
      if (ev(c) !== "SPELL_CAST_SUCCESS" || !c.spellId) continue;
      const at = c.logLine?.timestamp ?? tsOf(c);
      if (at < ctx.start || at > ctx.roundEndAt) continue;
      const id = String(c.spellId);
      const cd = effectiveCooldownSeconds(id) ?? 0;
      if (cd < MIN_CD_SECONDS) continue;
      // a press that spent nothing — a hold never released, a release that
      // hit nothing, a cleanse that removed nothing — owns no line (the
      // renderer's own exclusion, `unreleasedHoldMs`; GH #179 batch 3b)
      if (unreleasedHoldMs(unit, id, [at]).length) continue;
      ctx.bump("listGapPress");
      const name = nameOf(id, c.spellName ?? "");
      const sec = Math.floor((at - ctx.start) / 1000);
      const pressLine = timed.some(
        (l) =>
          Math.abs(l.t - sec) <= 1 &&
          (lineStatesPress(l.text, name, pid, ownerPid) ||
            (TRINKET_LINE_IDS.has(id) &&
              TRINKET_TAG.test(l.text) &&
              pressLineCaster(l.text, undefined, ownerPid) === pid)),
      );
      if (pressLine) continue;
      const inKit = kit.includes(name);
      const off =
        OFFENSIVE_PRESS_FACT_IDS.has(id) || FILLED_HEAL_IDS.has(id)
          ? "filled"
          : isRosterPressId(id)
            ? "listed"
            : isOffListPressId(id)
              ? "offList"
              : "offListUnder45";
      const kind = `${off}/${side}/${inKit ? "kitOnly" : "noLine"}`;
      ctx.violate(
        "listGapPress",
        kind,
        at,
        `${unit.name}#${id}#${at}`,
        `${unit.name} (${unit.spec}) ${name} ${id} [${cd}s] at +${at - ctx.start}ms`,
      );
      const row = gaps.get(id) ?? {
        name,
        cd,
        casts: 0,
        rounds: new Set<string>(),
        specs: new Map<string, number>(),
        kinds: new Map<string, number>(),
      };
      row.casts++;
      row.rounds.add(ctx.roundKey);
      row.specs.set(unit.spec, (row.specs.get(unit.spec) ?? 0) + 1);
      row.kinds.set(kind, (row.kinds.get(kind) ?? 0) + 1);
      gaps.set(id, row);
    }
  }
}

export function report(): string[] {
  const rows = [...gaps].sort(
    (a, b) => b[1].rounds.size - a[1].rounds.size || b[1].casts - a[1].casts,
  );
  return [
    `listGapPress ranked ids (${rows.length}): rounds casts id name [cd] specs kinds`,
    ...rows.map(
      ([id, r]) =>
        `  ${r.rounds.size} ${r.casts} ${id} ${r.name} [${r.cd}s] ${[...r.specs].map(([s, n]) => `${s}×${n}`).join(",")} ${[...r.kinds].map(([k, n]) => `${k}×${n}`).join(" ")}`,
    ),
  ];
}

export const state = () => ({ gaps });
export const load = (s: ReturnType<typeof state>): void => {
  ({ gaps } = s);
};
/** one row per id: the numbers that add, and the name and cooldown as read */
export const merge = {
  gaps: (a: Map<string, IGapRow>, b: Map<string, IGapRow>) => {
    for (const [id, r] of b) {
      const x = a.get(id);
      if (!x) {
        a.set(id, r);
        continue;
      }
      x.casts += r.casts;
      for (const k of r.rounds) x.rounds.add(k);
      for (const [k, n] of r.specs) x.specs.set(k, (x.specs.get(k) ?? 0) + n);
      for (const [k, n] of r.kinds) x.kinds.set(k, (x.kinds.get(k) ?? 0) + n);
    }
    return a;
  },
};
