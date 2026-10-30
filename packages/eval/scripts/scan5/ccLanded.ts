/* eslint-disable @typescript-eslint/no-explicit-any -- the checks walk the untyped legacy parse objects (units, damageIn, missesIn, auraEvents) */
/**
 * scan5/ccLanded.ts — "did a control reach a player" (fact6 F20 class
 * `cclanded`; research `runs/fact6-2026-10-27/fix/research/cclanded.md`).
 * Every fact comes from the log rows of the round (the units' `damageIn` /
 * `missesIn` / `auraEvents` / `spellCastEvents`); tables read here are
 * lookups only: English names, DB2 spell mechanics (`ccMechanicOf`), the DR
 * category map and reset window, the delayed-landing table
 * (`AOE_CC_LANDING_WINDOW_S`, how long after a press its control can land).
 *
 *  - `areaControlTouchedPlayer` (D4 / D5, + the summon-miss siblings): a
 *    `[YOU] [CC]` / `[TEAM] [CC]` cast line carrying `[hit no enemy player]`
 *    or (user ruling 2, 2026-10-28) `[no CC aura logged — hit 5(X)[, …][;
 *    DR: <Cat> Immune]]`. The press = the caster's SPELL_CAST_SUCCESS whose
 *    English name is the line's spell, in the rendered second. Its sources =
 *    the caster and every unit it owns (a Capacitor Totem pulses as the
 *    totem). Its rows = rows from a source whose spell's English name is the
 *    press's (Static Charge 118905 is "Capacitor Totem"; an Earthbind
 *    totem's rows are not) onto an ENEMY player (other teamId), in
 *    [cast − 0.1 s, cast + toS] (toS = the delayed-landing table's, else
 *    2.5 s): SPELL_DAMAGE (`damageIn`), any SPELL_MISSED (`missesIn`), an
 *    aura APPLIED / REFRESH (`auraEvents`).
 *      `[hit no enemy player]` with any row → `hitNoPlayer:<evidence>`,
 *      evidence = aura > casterMiss > summonMiss > damage (the strongest).
 *      The new wording: `hitList:auraLanded` — an own aura that is a control
 *      (DB2 mechanic set and not 11 snare) on an enemy player (then "no CC
 *      aura logged" is false); `hitList:notHit` — a printed unit with no
 *      damage / miss row of the press; `hitList:unlisted` — a damaged /
 *      missed enemy player the line does not name; `hitList:drNotImmune` —
 *      a printed `DR: <Cat> Immune` while that unit's chain of <Cat>
 *      DEBUFF applications (any source; its own only for a control — a
 *      stun Reverse Magic returned to its caster; APPLIED/REFRESH → its
 *      REMOVED, a chain resets at ≥ 20 s after the chain's latest end)
 *      holds fewer than two, or the press came ≥ 20 s after its end.
 *    `castNotFound` (not in the total): no press of that name that second.
 *
 *  - `controlNoPlayerEffect` (D19 / D20): a line that reads a press as a
 *    control that failed on a player — `[CC AVOIDED?] N(Spec): S (by C) …`,
 *    `[CC NOT LANDED] N(Spec) ← S (by C) — logged T`, and `[YOU]/[TEAM]
 *    [CC]` cast lines tagged `[IMMUNE …]`, `[MISSED on …]`, `[REFLECTED
 *    by …]` or `[no CC aura logged…]`. The press instant = the line's own
 *    miss row (from C or its summons onto N, English name S, the printed
 *    type, rendered second −1…+2), else C's cast of S in [−3 s, +1 s]. Truth
 *    per press, from the rows of that press in [instant − 0.2 s, + 1 s] on
 *    the caster's enemy players: `noPlayerControl` when no enemy player got
 *    an own-name aura that is a control (DB2 mechanic, not snare), while at
 *    least one was FREE: it took a damage row (or an ABSORB miss) of a
 *    CONTROL id of the press (the control spell itself reached it — not
 *    the cast's damage id: Maim's 22570 says nothing of 203123, Wake of
 *    Ashes' 255937 nothing of its demons / undead stun 255941), no other
 *    miss row of the press (an IMMUNE row is that player's immunity), and
 *    it was not DR-immune to the press's DR category (the chain above) —
 *    the press reached a free player and controlled nobody — and nowhere
 *    in the round did an aura of
 *    that name with a control mechanic sit on a player from another unit
 *    (round-local
 *    evidence that the spell controls players at all). The Havoc
 *    Metamorphosis landing 200166: damage + the 247121 daze (mechanic 11) on
 *    players, the 200166 stun on NPCs only (DB2 tooltip of 191427).
 *    `noPlayerControl:press` is that per-press truth. `noPlayerControl:db2`:
 *    the press controlled no enemy player and one of the line's ids (its
 *    miss rows, the caster's casts of S around it) is in
 *    `DB2_NO_PLAYER_CONTROL` — a press whose every victim was immune (D19:
 *    both damaged players at stun DR immune) cannot be decided from its own
 *    rows. The table's completeness is the forward inventory in the report:
 *    control-mechanic aura ids applied (by another unit) on non-players
 *    only, whose damage / miss rows reach players — each such id's tooltip
 *    is to be read (Curated-List forward check).
 *    `undetermined` (not in the total): the press damaged no free player,
 *    or the round shows that spell controlling a player; `pressNotFound`
 *    (not in the total): no row and no cast of S for the line.
 *    The report prints, per flagged spell, whether ANY round of the run
 *    showed it as a control aura on a player (run-wide evidence, gathered
 *    as the run goes — a flag contradicted later is listed there).
 */
import { ccSpellIds } from "@gladlog/analysis/src/data/spellTags";
import {
  AOE_CC_LANDING_WINDOW_S,
  DR_CATEGORY_MAP,
  DR_RESET_MS_121,
} from "@gladlog/analysis/src/utils/drAnalysis";
import { ccMechanicOf } from "@gladlog/analysis/src/utils/spellMechanics";

import {
  APPLIED,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  REFRESH,
  REMOVED,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "areaControlTouchedPlayer",
  "controlNoPlayerEffect",
] as const;

export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "areaControlTouchedPlayer|castNotFound",
  "controlNoPlayerEffect|undetermined",
  "controlNoPlayerEffect|pressNotFound",
]);

const SNARE_MECHANIC = 11;
const isControlAura = (id: string): boolean => {
  const m = ccMechanicOf(id);
  return m !== undefined && m !== SNARE_MECHANIC;
};

/**
 * Control ids whose control the game does not put on PLAYERS, by the DB2
 * tooltip (a lookup, the official statement; the per-press log truth above
 * cannot decide a press whose every victim was immune — a400c9d8 2:26: both
 * damaged players were at stun DR immune). Kept current by the forward
 * inventory in `report()`. 200166: Spell 191427 Description_lang (zhCN,
 * 12.1.5.70391) "…并使其昏迷$200166d。如果是玩家则改为眩晕$247121d。" — players
 * are Dazed (247121, mechanic 11) instead; 15-round / 155-file corpus: 0
 * applications on players, 36 on NPCs.
 */
const DB2_NO_PLAYER_CONTROL: Readonly<Record<string, string>> = {
  "200166": "Metamorphosis landing: players are Dazed (247121) instead",
};

/** spell name → was an aura of that name with a control mechanic ever seen
 * on a player in the run (run-wide evidence for the report) */
const runControlOnPlayer = new Map<string, boolean>();
const flaggedSpells = new Map<string, number>();
/** forward inventory, each round once: control-mechanic aura ids applied by
 * another unit on players / on non-players, and their rows reaching players */
const invOnPlayer = new Map<string, number>();
const invOnNpc = new Map<string, number>();
const invReach = new Map<string, number>();
const inc = (m: Map<string, number>, k: string) =>
  m.set(k, (m.get(k) ?? 0) + 1);
function inventory(ctx: IRoundCtx): void {
  if (!ctx.firstOwnerOfRound) return;
  for (const u of ctx.units) {
    const isPlayer = !!u.info;
    for (const r of (u.auraEvents ?? []) as any[]) {
      if (ev(r) !== APPLIED || r.srcUnitId === u.id) continue;
      const id = String(r.spellId);
      if (!isControlAura(id)) continue;
      inc(isPlayer ? invOnPlayer : invOnNpc, id);
    }
    if (isPlayer)
      for (const r of [
        ...((u.damageIn ?? []) as any[]),
        ...((u.missesIn ?? []) as any[]),
      ])
        if (isControlAura(String(r.spellId))) inc(invReach, String(r.spellId));
  }
}

const teamOf = (u: any): string | undefined => u?.info?.teamId;
const rowName = (r: any): string => nameOf(r.spellId, r.spellName ?? "");

/** the caster and every unit it owns */
function sourcesOf(ctx: IRoundCtx, caster: any): Set<string> {
  return new Set<string>([
    caster.id,
    ...ctx.units.filter((u) => u.ownerId === caster.id).map((u) => u.id),
  ]);
}
function enemyPlayersOf(ctx: IRoundCtx, caster: any): any[] {
  const t = teamOf(caster);
  return ctx.players.filter((p) => teamOf(p) !== undefined && teamOf(p) !== t);
}

interface IPressRows {
  damage: any[];
  miss: any[];
  aura: any[];
}
/** a press's rows (own name, from its sources) on one unit inside [a, b] */
function pressRowsOn(
  unit: any,
  sources: Set<string>,
  spell: string,
  a: number,
  b: number,
): IPressRows {
  const keep = (r: any) =>
    sources.has(r.srcUnitId) &&
    tsOf(r) >= a &&
    tsOf(r) <= b &&
    rowName(r) === spell;
  return {
    damage: ((unit.damageIn ?? []) as any[]).filter(keep),
    miss: ((unit.missesIn ?? []) as any[]).filter(keep),
    aura: ((unit.auraEvents ?? []) as any[]).filter(
      (r) => (ev(r) === APPLIED || ev(r) === REFRESH) && keep(r),
    ),
  };
}

/** DR state of `unit` for `category` at `atMs`, from its aura rows: the
 * DEBUFF applications of that category, each to its REMOVED — from every
 * source, the unit's own included when the aura is a control (`ccSpellIds`:
 * a control reflected back onto its caster — Reverse Magic returning a
 * Hammer of Justice logs the caster as its source; the same source rule as
 * scan5/dr.ts, user default 2026-10-28); a chain resets once an application
 * starts ≥ the reset window after the chain's latest end. Immune = two
 * applications in the live chain (the third is the one the game refuses). */
function drImmuneAt(unit: any, category: string, atMs: number): boolean {
  const rows = ((unit.auraEvents ?? []) as any[])
    .filter(
      (r) =>
        r.auraType === "DEBUFF" &&
        (r.srcUnitId !== unit.id || ccSpellIds.has(String(r.spellId))) &&
        DR_CATEGORY_MAP[String(r.spellId)] === category,
    )
    .sort((x, y) => tsOf(x) - tsOf(y));
  const apps: Array<{ start: number; end: number }> = [];
  for (const r of rows) {
    if (ev(r) !== APPLIED && ev(r) !== REFRESH) continue;
    const t = tsOf(r);
    if (t >= atMs) break;
    const rem = rows.find(
      (x) =>
        ev(x) === REMOVED &&
        x.spellId === r.spellId &&
        x.srcUnitId === r.srcUnitId &&
        tsOf(x) >= t,
    );
    apps.push({ start: t, end: rem ? tsOf(rem) : t + 8000 });
  }
  let chainEnd = -Infinity;
  let count = 0;
  for (const x of apps) {
    if (x.start >= chainEnd + DR_RESET_MS_121) count = 0;
    count++;
    chainEnd = Math.max(chainEnd, x.end);
  }
  return count >= 2 && atMs < chainEnd + DR_RESET_MS_121;
}

/** the caster's press of `spell` in rendered second `sec` */
function pressAt(ctx: IRoundCtx, caster: any, spell: string, sec: number): any {
  return successesOf(caster).find(
    (c) =>
      nameOf(c.spellId, c.spellName ?? "") === spell &&
      Math.floor((tsOf(c) - ctx.start) / 1000) === sec,
  );
}

const CAST_RE =
  /^(\d+):(\d\d)\s+\[(YOU|TEAM)\] \[CC\]\s+(?:(\d+)\([^)]*\) \([^)]*\) cast )?(.+?)(?= →| \[|$)/;

function areaControlTouchedPlayer(ctx: IRoundCtx): void {
  const C = "areaControlTouchedPlayer";
  for (const l of ctx.lines) {
    const noPlayer = l.includes("[hit no enemy player]");
    const hitList = /\[no CC aura logged — hit ([^\]]*)\]/.exec(l);
    if (!noPlayer && !hitList) continue;
    const m = CAST_RE.exec(l);
    if (!m) continue;
    const caster = m[3] === "YOU" ? ctx.owner : ctx.unitOfPid(m[4]);
    if (!caster) continue;
    const sec = secOf(`${m[1]}:${m[2]}`);
    const spell = m[5]!.trim();
    ctx.bump(C);
    const cast = pressAt(ctx, caster, spell, sec);
    const factId = `${caster.id}:${spell}:${sec}`;
    if (!cast) {
      ctx.violate(
        C,
        "castNotFound",
        ctx.start + sec * 1000,
        factId,
        `${caster.name} ${spell} @${fmtS(sec)}: no press that second`,
        l,
      );
      continue;
    }
    const t0 = tsOf(cast);
    const toS = AOE_CC_LANDING_WINDOW_S[String(cast.spellId)]?.toS ?? 2.5;
    const sources = sourcesOf(ctx, caster);
    const per = enemyPlayersOf(ctx, caster).map((p) => ({
      p,
      rows: pressRowsOn(p, sources, spell, t0 - 100, t0 + toS * 1000),
    }));
    const touched = per.filter(
      (x) => x.rows.damage.length + x.rows.miss.length + x.rows.aura.length > 0,
    );
    if (noPlayer) {
      if (touched.length === 0) continue;
      const all = touched.flatMap((x) => [
        ...x.rows.aura.map((r) => ({ r, k: "aura", p: x.p })),
        ...x.rows.miss.map((r) => ({
          r,
          k: r.srcUnitId === caster.id ? "casterMiss" : "summonMiss",
          p: x.p,
        })),
        ...x.rows.damage.map((r) => ({ r, k: "damage", p: x.p })),
      ]);
      const order = ["aura", "casterMiss", "summonMiss", "damage"];
      const best = order.map((k) => all.find((x) => x.k === k)).find(Boolean)!;
      ctx.violate(
        C,
        `hitNoPlayer:${best.k}`,
        tsOf(best.r),
        factId,
        `${spell} by ${caster.name} @${fmtS(sec)}: ${ev(best.r) ?? best.k} ${best.r.spellId}${best.r.missType ? ` ${best.r.missType}` : ""} on ${best.p.name} +${tsOf(best.r) - t0}ms`,
        l,
      );
      continue;
    }
    // the ruling-2 wording: verify each part
    const body = hitList![1]!;
    const [listPart, ...rest] = body.split(";");
    const listed = new Set(
      [...listPart!.matchAll(/(\d+)\(/g)]
        .map((x) => ctx.unitOfPid(x[1]))
        .filter(Boolean)
        .map((u: any) => u.id),
    );
    const controlled = per.filter((x) =>
      x.rows.aura.some((r) => isControlAura(String(r.spellId))),
    );
    for (const x of controlled)
      ctx.violate(
        C,
        "hitList:auraLanded",
        t0,
        `${factId}:${x.p.id}`,
        `${spell} by ${caster.name} @${fmtS(sec)}: control aura ${x.rows.aura[0].spellId} on ${x.p.name}`,
        l,
      );
    const hit = new Set(
      per
        .filter((x) => x.rows.damage.length + x.rows.miss.length > 0)
        .map((x) => x.p.id),
    );
    for (const id of listed)
      if (!hit.has(id))
        ctx.violate(
          C,
          "hitList:notHit",
          t0,
          `${factId}:${id}`,
          `${spell} by ${caster.name} @${fmtS(sec)}: printed ${ctx.units.find((u) => u.id === id)?.name ?? id} has no damage / miss row of it`,
          l,
        );
    for (const id of hit)
      if (!listed.has(id))
        ctx.violate(
          C,
          "hitList:unlisted",
          t0,
          `${factId}:${id}`,
          `${spell} by ${caster.name} @${fmtS(sec)}: ${ctx.units.find((u) => u.id === id)?.name} was hit, not named`,
          l,
        );
    const dr = /DR: (\w+) Immune/.exec(rest.join(";"));
    if (dr)
      for (const id of listed) {
        const u = ctx.units.find((x) => x.id === id);
        // read at the instant the press REACHED that unit (its first damage /
        // miss row), not at the cast: a delayed area control (Capacitor
        // Totem's pulse ~2 s later) meets the DR a stun landed in between
        // put on it — F20 wide residual, 231-1 2:19: Leg Sweep at 2:20, the
        // pulse at 2:21 logged IMMUNE
        const x = per.find((y) => y.p.id === id);
        const firstMs = x
          ? Math.min(...[...x.rows.damage, ...x.rows.miss].map(tsOf))
          : t0;
        const atMs = Number.isFinite(firstMs) ? firstMs : t0;
        if (u && !drImmuneAt(u, dr[1]!, atMs))
          ctx.violate(
            C,
            "hitList:drNotImmune",
            t0,
            `${factId}:${id}`,
            `${spell} by ${caster.name} @${fmtS(sec)}: ${u.name} not at ${dr[1]} DR immune by its aura rows`,
            l,
          );
      }
  }
}

const AVOIDED_RE =
  /^(\d+):(\d\d)\s+\[CC AVOIDED\?\]\s+(\d+)\([^)]*\): (.+?) \(by (\d+)\([^)]*\)[^)]*\) (?:logged (\w+)|did not land)/;
const NOT_LANDED_RE =
  /^(\d+):(\d\d)\s+\[CC NOT LANDED\]\s+(\d+)\([^)]*\) ← (.+?) \(by (\d+)\([^)]*\)[^)]*\) — logged (\w+)/;
const FAIL_TAG_RE =
  /\[(?:IMMUNE|MISSED on|REFLECTED by|no CC aura logged)[^\]]*\]/;

function controlNoPlayerEffect(ctx: IRoundCtx): void {
  const C = "controlNoPlayerEffect";
  // round-local evidence: names whose control-mechanic aura sat on a player
  const controlsPlayers = new Set<string>();
  for (const p of ctx.players)
    for (const r of (p.auraEvents ?? []) as any[])
      if (
        (ev(r) === APPLIED || ev(r) === REFRESH) &&
        r.srcUnitId !== p.id &&
        isControlAura(String(r.spellId))
      )
        controlsPlayers.add(rowName(r));
  for (const n of controlsPlayers) runControlOnPlayer.set(n, true);

  for (const l of ctx.lines) {
    let sec: number;
    let spell: string;
    let caster: any;
    let target: any;
    let missType: string | undefined;
    const a = AVOIDED_RE.exec(l) ?? NOT_LANDED_RE.exec(l);
    if (a) {
      sec = secOf(`${a[1]}:${a[2]}`);
      target = ctx.unitOfPid(a[3]);
      spell = a[4]!.trim();
      caster = ctx.unitOfPid(a[5]);
      missType = a[6];
    } else {
      if (!FAIL_TAG_RE.test(l) || l.includes("— hit ")) continue;
      const m = CAST_RE.exec(l);
      if (!m) continue;
      sec = secOf(`${m[1]}:${m[2]}`);
      spell = m[5]!.trim();
      caster = m[3] === "YOU" ? ctx.owner : ctx.unitOfPid(m[4]);
      target = undefined;
    }
    if (!caster) continue;
    ctx.bump(C);
    if (!runControlOnPlayer.has(spell)) runControlOnPlayer.set(spell, false);
    const sources = sourcesOf(ctx, caster);
    const base = ctx.start + sec * 1000;
    const factId = `${caster.id}:${spell}:${sec}:${target?.id ?? ""}`;
    // the press instant: the line's own miss row, else the caster's cast
    let at: number | undefined;
    if (target && missType) {
      const row = ((target.missesIn ?? []) as any[]).find(
        (r) =>
          sources.has(r.srcUnitId) &&
          r.missType === missType &&
          rowName(r) === spell &&
          tsOf(r) >= base - 1000 &&
          tsOf(r) < base + 2000,
      );
      if (row) at = tsOf(row);
    }
    const lineIds = new Set<string>();
    if (target)
      for (const r of (target.missesIn ?? []) as any[])
        if (
          sources.has(r.srcUnitId) &&
          rowName(r) === spell &&
          tsOf(r) >= base - 1000 &&
          tsOf(r) < base + 2000
        )
          lineIds.add(String(r.spellId));
    for (const id of sources)
      for (const c of successesOf(ctx.units.find((u) => u.id === id) ?? {}))
        if (
          nameOf(c.spellId, c.spellName ?? "") === spell &&
          tsOf(c) >= base - 3000 &&
          tsOf(c) < base + 1000
        )
          lineIds.add(String(c.spellId));
    if (at === undefined) {
      const cast = [...sources]
        .flatMap((id) => successesOf(ctx.units.find((u) => u.id === id) ?? {}))
        .find(
          (c) =>
            nameOf(c.spellId, c.spellName ?? "") === spell &&
            tsOf(c) >= base - 3000 &&
            tsOf(c) < base + 1000,
        );
      if (cast) at = tsOf(cast);
    }
    if (at === undefined) {
      ctx.violate(
        C,
        "pressNotFound",
        base,
        factId,
        `${spell} by ${caster.name} @${fmtS(sec)}: no row / cast`,
        l,
      );
      continue;
    }
    const per = enemyPlayersOf(ctx, caster).map((p) => ({
      p,
      rows: pressRowsOn(p, sources, spell, at - 200, at + 1000),
    }));
    const controlled = per.some((x) =>
      x.rows.aura.some((r) => isControlAura(String(r.spellId))),
    );
    // the ids the sources PRESS under that name this round (the cast's own
    // damage id: Maim 22570, Shockwave 46968, Wake of Ashes 255937)
    const castIds = new Set(
      [...sources].flatMap((id) =>
        successesOf(ctx.units.find((u) => u.id === id) ?? {})
          .filter((c: any) => nameOf(c.spellId, c.spellName ?? "") === spell)
          .map((c: any) => String(c.spellId)),
      ),
    );
    // the control ids a player REFUSED in this press (a non-ABSORB miss
    // row: 200166 / 132168 / 255941 IMMUNE) — when there is one, only
    // that id hitting another player says the control reached it
    const refused = new Set(
      per.flatMap((x) =>
        x.rows.miss
          .filter((r) => r.missType !== "ABSORB")
          .map((r) => String(r.spellId))
          .filter((id) => isControlAura(id) && !castIds.has(id)),
      ),
    );
    // a FREE player: the control spell itself reached it — a damage row
    // (or a fully absorbed hit) of a control-aura id that is not a pressed
    // id (200166 on a player; DB2 mechanics tag a cast id like 46968 with
    // its trigger's stun too, and Wake of Ashes' Truth's Wake ids 405345 /
    // 405350 carry a stun mechanic as well), of a refused id when the
    // press has one — and it refused nothing (no other miss row of the press:
    // an IMMUNE row under Bladestorm / Nullifying Shroud / Anti-Magic Shell
    // is the immunity, not "no control for players"). A hit by the cast's
    // damage id only (Maim 22570, Shockwave 46968, Wake of Ashes 255937)
    // does not say the control id (203123 / 132168 / 255941) was even
    // tried on that player (Wake's stun is demons / undead only) — it
    // decides nothing.
    const free = per.filter((x) => {
      const controlHit = [
        ...x.rows.damage,
        ...x.rows.miss.filter((r) => r.missType === "ABSORB"),
      ].some(
        (r) =>
          isControlAura(String(r.spellId)) &&
          !castIds.has(String(r.spellId)) &&
          (refused.size === 0 || refused.has(String(r.spellId))),
      );
      if (!controlHit) return false;
      if (x.rows.miss.some((r) => r.missType !== "ABSORB")) return false;
      const cats = new Set(
        [...x.rows.damage, ...x.rows.miss, ...x.rows.aura]
          .map((r) => DR_CATEGORY_MAP[String(r.spellId)])
          .filter(Boolean),
      );
      return ![...cats].some((c) => drImmuneAt(x.p, c!, at));
    });
    const db2 = [...lineIds].find((id) => DB2_NO_PLAYER_CONTROL[id]);
    const pressDecides =
      !controlled && free.length > 0 && !controlsPlayers.has(spell);
    if (!pressDecides && !controlled && db2) {
      flaggedSpells.set(spell, (flaggedSpells.get(spell) ?? 0) + 1);
      ctx.violate(
        C,
        "noPlayerControl:db2",
        at,
        factId,
        `${spell} by ${caster.name} @${fmtS(sec)}: id ${db2} — ${DB2_NO_PLAYER_CONTROL[db2]}`,
        l,
      );
      continue;
    }
    if (controlled || free.length === 0 || controlsPlayers.has(spell)) {
      ctx.violate(
        C,
        "undetermined",
        at,
        factId,
        `${spell} by ${caster.name} @${fmtS(sec)}: controlled=${controlled} freeDamaged=${free.length} roundEvidence=${controlsPlayers.has(spell)}`,
        l,
      );
      continue;
    }
    flaggedSpells.set(spell, (flaggedSpells.get(spell) ?? 0) + 1);
    const ids = [
      ...new Set(
        per.flatMap((x) =>
          [...x.rows.damage, ...x.rows.miss, ...x.rows.aura].map(
            (r) => `${r.spellId}`,
          ),
        ),
      ),
    ];
    ctx.violate(
      C,
      "noPlayerControl:press",
      at,
      factId,
      `${spell} by ${caster.name} @${fmtS(sec)}: damaged ${free.map((x) => x.p.name).join(", ")}, no control aura on any player (row ids ${ids.join("/")})`,
      l,
    );
  }
}

export function run(ctx: IRoundCtx): void {
  inventory(ctx);
  areaControlTouchedPlayer(ctx);
  controlNoPlayerEffect(ctx);
}

export function report(): string[] {
  const fwd = [...invOnNpc]
    .filter(([id]) => !invOnPlayer.has(id) && (invReach.get(id) ?? 0) > 0)
    .sort((a, b) => (invReach.get(b[0]) ?? 0) - (invReach.get(a[0]) ?? 0))
    .slice(0, 20)
    .map(
      ([id, n]) =>
        `  ${nameOf(id, id)} ${id}: on NPCs ${n}, on players 0, damage/miss rows on players ${invReach.get(id)}${DB2_NO_PLAYER_CONTROL[id] ? " [in the DB2 table]" : " — NOT in the DB2 table: read its tooltip"}`,
    );
  return [
    "controlNoPlayerEffect forward inventory — control-mechanic auras seen on non-players only, whose rows reach players:",
    ...fwd,
    "controlNoPlayerEffect — flagged spells vs run-wide evidence (a control aura of that name on a player in any round):",
    ...[...flaggedSpells].map(
      ([s, n]) =>
        `  ${s}: ${n} line(s); seen controlling a player in the run: ${runControlOnPlayer.get(s) ? "YES — flags suspect" : "no"}`,
    ),
  ];
}
