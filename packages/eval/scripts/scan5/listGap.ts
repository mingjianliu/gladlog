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
 * Kinds: `<filled|listed|offList>/<side>/<noLine|kitOnly>`. `offList` is what
 * the class is about: on none of the roster keys. `filled` labels the ids the
 * class fix answers for, which must reach 0. `form/<side>/noLine` is a
 * no-button form's APPLIED row (Void Metamorphosis 1217607, D69) no `[PROC]` /
 * `[ENEMY CD]` line names. `report()` prints the ranked gap list, one row per
 * id. A press some other family carries (a press tag of its own) is no gap:
 * `PRESS_TAG` lists them; a PvP trinket's line names no spell, its tag does.
 */
import { classMetadata } from "@gladlog/analysis/src/data/classSpells";
import { effectiveCooldownSeconds } from "@gladlog/analysis/src/data/spellEffectData";
import {
  canonicalSpellId,
  MIN_CD_SECONDS,
} from "@gladlog/analysis/src/utils/cooldowns";
import {
  OFFENSIVE_CD_SPELL_IDS,
  OFFENSIVE_PRESS_FACT_IDS,
  SPELL_EFFECT_OVERRIDES,
} from "@gladlog/analysis/src/utils/spellDanger";

import { ev, type IRoundCtx, nameOf, tsOf } from "./ctx";

export const CHECKS = ["listGapPress"] as const;

/** a printed `[tag]` that states a press of the spell it names */
const PRESS_TAG =
  /\[(YOU|TEAM)\] \[(CD|CC|PROC|CAST)\]|\[ENEMY (CD|DEF|UTILITY|HEAL CD|TRINKET|HARD CAST|PURGE|CLEANSE)\]|\[TRINKET\]|\[(CLEANSE|PURGE|GRIP|KICK|DISARM|SILENCE|SHIELD|ROOT|DISPEL|MINOR DISPELS|CC ON ENEMY|CC ON TEAM|CC NOT LANDED|ENEMY SUMMON)\]/;
const LINE_AT = /^\s*(\d+):(\d\d)\s+(.*)$/;
const TRINKET_TAG = /\[(ENEMY )?TRINKET\]/;
const FIRST_UNIT = /(?:^|[\s(])(\d+)\(/;
const BY_UNIT = /^ \((?:by|from) (\d+)\(/;
const OWNED_BY_UNIT = /(\d+)\([^)]*\)'s (?:\w+'s )?$/;
/** Gladiator's Medallion, Adaptation's activation, the two racials that share
 * the PvP trinket's lock: printed by `[TRINKET]` / `[ENEMY TRINKET]` */
const TRINKET_IDS = new Set(["336126", "336135", "59752", "7744"]);
/** a form with no button: nothing presses it (D69) */
const FORM_AURAS = new Set(["1217607"]);
/** the group heal of the class (D51, D55), printed `[ENEMY HEAL CD]` */
const FILLED_HEAL = new Set(["15286"]);

const rosterIds = new Set(
  classMetadata.flatMap((c) => c.abilities.map((a) => a.spellId)),
);
const listed = (id: string): boolean => {
  const canon = canonicalSpellId(id);
  return (
    rosterIds.has(id) ||
    rosterIds.has(canon) ||
    OFFENSIVE_CD_SPELL_IDS.has(id) ||
    OFFENSIVE_CD_SPELL_IDS.has(canon) ||
    id in SPELL_EFFECT_OVERRIDES
  );
};

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

/**
 * Whose press a line's mention of `spell` states: the unit its own `(by N)` /
 * `(from N)` names (`← Dragon's Breath (by 3(FMage))`) or `N's` claims
 * (`interrupted 5(SPriest)'s Void Torrent`), the owner on a `[YOU]` line or a
 * `your X`, else the line's first unit (`[TEAM] [CD] 3(AWarrior) …`, `[PURGE]
 * 1(FMage) purged … (Spellsteal)`). `spell` undefined: the line's own subject,
 * a trinket line naming no spell.
 */
function lineCaster(
  text: string,
  spell: string | undefined,
  ownerPid: string | undefined,
): string | undefined {
  const at = spell === undefined ? -1 : text.indexOf(spell);
  if (at >= 0) {
    const by = BY_UNIT.exec(text.slice(at + spell!.length));
    if (by) return by[1];
    const owns = OWNED_BY_UNIT.exec(text.slice(0, at));
    if (owns) return owns[1];
  }
  if (/\[YOU\]|\byour /.test(at >= 0 ? text.slice(0, at) : text))
    return ownerPid;
  return FIRST_UNIT.exec(text)?.[1];
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
            lineCaster(l.text, name, ownerPid) === pid,
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
      ctx.bump("listGapPress");
      const name = nameOf(id, c.spellName ?? "");
      const sec = Math.floor((at - ctx.start) / 1000);
      const pressLine = timed.some(
        (l) =>
          Math.abs(l.t - sec) <= 1 &&
          ((l.text.includes(name) &&
            PRESS_TAG.test(l.text) &&
            lineCaster(l.text, name, ownerPid) === pid) ||
            (TRINKET_IDS.has(id) &&
              TRINKET_TAG.test(l.text) &&
              lineCaster(l.text, undefined, ownerPid) === pid)),
      );
      if (pressLine) continue;
      const inKit = kit.includes(name);
      const off =
        OFFENSIVE_PRESS_FACT_IDS.has(id) || FILLED_HEAL.has(id)
          ? "filled"
          : listed(id)
            ? "listed"
            : "offList";
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
