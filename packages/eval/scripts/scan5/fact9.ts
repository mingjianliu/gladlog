/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, auraEvents, advancedActions, absorbsIn, missesOut) */
/**
 * scan5/fact9.ts — the round-9 audit's class checks (fact9 F24). Log rows are
 * the truth; DB2 profiles and the roster are lookups.
 *
 *  - `petKickerMissed` (class 1, D30 / D32): a kick-eaten row whose cast
 *    began with an enemy pet's kick in hand — the pet cast that kick this
 *    round, its last cast strictly before the cast start plus the DB2
 *    cooldown is past, no cast-blocking aura from our side on it, alive,
 *    within the kick's 40 yd (Spell Lock's DB2 range) by its own position —
 *    while the row prints a nearest kicker farther than the pet (kind
 *    `nearer`) or none (kind `uncounted`). Margin 1 yd.
 *  - `ledgerDefNoEffect` (class 2, D21): a burst-ledger "Target had a major
 *    defensive up: X" whose X, by its official profile, has no mitigation %,
 *    no school immunity, and is a heal (a self heal with no shield of its
 *    own, or a group heal) or an immunity to charm / fear / sleep / turn
 *    only. Kind = X.
 *  - `wardReturnMisnamed` (class 5, D6): a Nether Ward 212295 damage row
 *    whose own millisecond names a spell Y (the reflector's SPELL_ABSORBED
 *    under Y, or the reflector putting aura Y on the caster) that the
 *    reflector reflected off the caster in the 3 s before, with no
 *    `[REFLECTED]` line of Y while a line stands for another of the caster's
 *    spells that reflector reflected AFTER Y and before the row — the one
 *    case a timing-only pairing hands the row to (kind `misnamed`) — or no
 *    line at all (kind `missing`). Only while Y's reflect chain is over the
 *    5 % floor, read over Y's whole reflect chain at its FIRST reflect (GH
 *    #181: the row alone at the latest reflect missed both ways). The chain
 *    is grouped here from the caster's own REFLECT rows — one spell (id or
 *    English name), one reflector, ≤ `REFLECT_CHAIN_GAP_MS` apart, the
 *    shared constant — never through the analysis's `reflectChains`, which
 *    is what the check audits (codex review: a product chain split would
 *    have hidden the missing line); its return is every Nether Ward row
 *    naming one of its reflects, each absorb row counted once. A Y return under the floor with only
 *    earlier reflects' lines beside it is no violation (cover set: be27ee5f
 *    2:08 Wicked Reaping 27k, reflected in the row's own millisecond).
 */
import {
  maxHpNear,
  REFLECT_CHAIN_GAP_MS,
  REFLECT_MIN_DAMAGE_PCT,
} from "@gladlog/analysis/src/context/spellOutcomeLines";
import { abilityProfile } from "@gladlog/analysis/src/data/abilityProfile";
import {
  isCastBlockingAuraType,
  SPELL_CATEGORIES,
} from "@gladlog/analysis/src/data/spellCategories";
import { spellEffectData } from "@gladlog/analysis/src/data/spellEffectData";
import { INTERRUPT_SPELL_IDS } from "@gladlog/analysis/src/utils/enemyInterrupts";
import { isDeferralAbsorb } from "@gladlog/analysis/src/utils/incomingPressure";

import {
  APPLIED,
  deathMs,
  ev,
  fmtS,
  type IRoundCtx,
  nameOf,
  parseReflectedLine,
  REFRESH,
  REMOVED,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = [
  "petKickerMissed",
  "ledgerDefNoEffect",
  "wardReturnMisnamed",
] as const;

const NETHER_WARD = "212295";
const PET_KICK_RANGE_YD = 40;
const POS_GAP_MS = 2_500;

/** a unit's position at `ms` between two samples no more than POS_GAP_MS
 * from it (the nearer one), linear */
function posAt(u: any, ms: number): { x: number; y: number } | undefined {
  const rows = ((u.advancedActions ?? []) as any[]).filter(
    (a) => a.advancedActorId === undefined || a.advancedActorId === u.id,
  );
  let before: any;
  let after: any;
  for (const a of rows) {
    const t = tsOf(a);
    if (t <= ms && (!before || t >= tsOf(before))) before = a;
    if (t >= ms && (!after || t < tsOf(after))) after = a;
  }
  if (!before && !after) return undefined;
  if (!before || !after) {
    const one = before ?? after;
    return Math.abs(tsOf(one) - ms) <= POS_GAP_MS
      ? { x: one.advancedActorPositionX, y: one.advancedActorPositionY }
      : undefined;
  }
  if (Math.min(ms - tsOf(before), tsOf(after) - ms) > POS_GAP_MS)
    return undefined;
  const span = tsOf(after) - tsOf(before);
  const f = span > 0 ? (ms - tsOf(before)) / span : 0;
  return {
    x:
      before.advancedActorPositionX +
      (after.advancedActorPositionX - before.advancedActorPositionX) * f,
    y:
      before.advancedActorPositionY +
      (after.advancedActorPositionY - before.advancedActorPositionY) * f,
  };
}

/** a cast-blocking aura from outside `side` open on `u` at `ms` */
function blockedAt(u: any, side: Set<string>, ms: number): boolean {
  const open = new Map<string, number>();
  for (const a of (u.auraEvents ?? []) as any[]) {
    const t = tsOf(a);
    if (t > ms) break;
    const id = String(a.spellId ?? "");
    const type = SPELL_CATEGORIES[id]?.type;
    if (!type || !isCastBlockingAuraType(type)) continue;
    if (ev(a) === APPLIED && !side.has(a.srcUnitId)) open.set(id, t);
    else if (ev(a) === REMOVED || ev(a)?.startsWith("SPELL_AURA_BROKEN"))
      open.delete(id);
  }
  return open.size > 0;
}

const KICK_ROW = /type=kick-eaten t=([\d.]+)s .*?facts=\{(.*)\}\s*$/;

function petKickers(ctx: IRoundCtx): void {
  const owner = ctx.owner;
  if (!owner) return;
  const enemyIds = new Set(
    ctx.players
      .filter((p) => p.reaction !== owner.reaction)
      .map((p) => p.id as string),
  );
  const enemySide = new Set<string>([...enemyIds]);
  const pets = ctx.units.filter(
    (u) => enemyIds.has(u.ownerId) && String(u.id).startsWith("Pet-"),
  );
  for (const p of pets) enemySide.add(p.id);
  const kickPets = pets
    .map((p) => {
      const casts = successesOf(p).filter((c) =>
        INTERRUPT_SPELL_IDS.includes(String(c.spellId)),
      );
      return casts.length ? { p, kickId: String(casts[0].spellId) } : null;
    })
    .filter((x): x is { p: any; kickId: string } => x !== null);
  if (kickPets.length === 0) return;
  for (const line of ctx.menu.split("\n")) {
    const m = KICK_ROW.exec(line);
    if (!m) continue;
    const kickMs = ctx.start + Number(m[1]) * 1000;
    const kick = ((owner.actionIn ?? []) as any[]).find(
      (k) =>
        ev(k) === "SPELL_INTERRUPT" &&
        enemySide.has(k.srcUnitId) &&
        Math.abs(tsOf(k) - kickMs) <= 100,
    );
    if (!kick) continue;
    const castStart = ((owner.castStartEvents ?? []) as any[])
      .filter(
        (c) =>
          c.spellId === kick.extraSpellId &&
          tsOf(c) <= tsOf(kick) &&
          tsOf(c) >= tsOf(kick) - 10_000,
      )
      .sort((a, b) => tsOf(b) - tsOf(a))[0];
    if (!castStart) continue;
    const cs = tsOf(castStart);
    const ownerPos = posAt(owner, cs);
    if (!ownerPos) continue;
    const facts = m[2]!;
    const printedYd = /nearestKickerDistYd=~?([\d.]+)/.exec(facts);
    ctx.bump("petKickerMissed");
    for (const { p, kickId } of kickPets) {
      if (deathMs(p) <= cs) continue;
      if (!((p.advancedActions ?? []) as any[]).some((a) => tsOf(a) <= cs))
        continue;
      // the owner's pets share the owner's history of this kick
      const cd = spellEffectData[kickId]?.cooldownSeconds ?? 24;
      const last = pets
        .filter((q) => q.ownerId === p.ownerId)
        .flatMap((q) => successesOf(q))
        .filter((c) => String(c.spellId) === kickId && tsOf(c) < cs)
        .map(tsOf)
        .sort((a, b) => b - a)[0];
      if (last !== undefined && last + cd * 1000 > cs) continue;
      if (blockedAt(p, enemySide, cs)) continue;
      const pos = posAt(p, cs);
      if (!pos) continue;
      const d = Math.hypot(pos.x - ownerPos.x, pos.y - ownerPos.y);
      if (d > PET_KICK_RANGE_YD) continue;
      const kind = !printedYd
        ? "uncounted"
        : d + 1 < Number(printedYd[1])
          ? "nearer"
          : undefined;
      if (!kind) continue;
      ctx.violate(
        "petKickerMissed",
        kind,
        cs,
        `${owner.name}#${m[1]}#${p.id}`,
        `kick-eaten t=${m[1]}: ${nameOf(kickId)} pet of ${p.ownerId} ${d.toFixed(1)} yd at cast start ${fmtS((cs - ctx.start) / 1000)}, row nearest ${printedYd?.[1] ?? "none"}`,
        line.slice(0, 300),
      );
    }
  }
}

const CONTROL_ONLY_MECHANICS = new Set([1, 5, 10, 23]); // charm fear sleep turn
let notDefenseByName: Map<string, boolean> | undefined;
/** by English name: is the spell, by its official profile, no damage
 * defense (a heal, or a charm / fear / sleep / turn immunity only)? */
function noDamageDefense(name: string): boolean {
  if (!notDefenseByName) {
    notDefenseByName = new Map();
    for (const id of Object.keys(spellEffectData)) {
      const n = nameOf(id);
      if (!n) continue;
      const p = abilityProfile(id);
      // a self heal with no shield of its own (Dark Pact is both), or a
      // heal of others (Tranquility's channel carries an absorb row)
      const heal =
        (p.healsSelf && !p.absorbs) || (p.healsOthers && !p.healsSelf);
      const controlOnly =
        !p.absorbs &&
        (p.immuneMechanics ?? []).length > 0 &&
        (p.immuneMechanics ?? []).every((x) => CONTROL_ONLY_MECHANICS.has(x));
      const no =
        p.mitigationPct === undefined &&
        p.immuneSchools === undefined &&
        (heal || controlOnly);
      // one id of the name that IS a defense keeps the name
      notDefenseByName.set(n, (notDefenseByName.get(n) ?? true) && no);
    }
  }
  return notDefenseByName.get(name) ?? false;
}

const LEDGER_DEF =
  /^\s*Target had a major defensive up: (.+?) active ON THE TARGET/;

function ledgerDefs(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = LEDGER_DEF.exec(line);
    if (!m) continue;
    ctx.bump("ledgerDefNoEffect");
    if (noDamageDefense(m[1]!))
      ctx.violate(
        "ledgerDefNoEffect",
        m[1]!,
        ctx.start,
        `${ctx.ownerName}#${m[1]}#${ctx.lines.indexOf(line)}`,
        `${m[1]} is a heal or a control-only immunity`,
        line,
      );
  }
}

function wardReturns(ctx: IRoundCtx): void {
  // the shared reading of the line (`reflected ×N by` too — GH #203)
  const lines = ctx.lines
    .map(parseReflectedLine)
    .filter((m) => m !== null)
    .map((m) => ({
      sec: m.sec,
      caster: m.casterPid,
      spell: m.spell,
      reflector: m.reflectorPid,
    }));
  for (const c of ctx.players) {
    const pidC = ctx.pidOf(c.name);
    if (!pidC) continue;
    // the caster's reflect chains, from its own REFLECT rows: one spell (id
    // or English name), one reflector, consecutive rows ≤
    // `REFLECT_CHAIN_GAP_MS` apart; each REFLECT row → its chain
    const sameSpell = (a: any, b: any) =>
      String(a.spellId) === String(b.spellId) ||
      (nameOf(a.spellId) !== "" && nameOf(a.spellId) === nameOf(b.spellId));
    const chainOf = new Map<any, { first: any; members: any[] }>();
    {
      const open: Array<{ first: any; last: any; members: any[] }> = [];
      const reflects = ((c.missesOut ?? []) as any[])
        .filter((x) => x.missType === "REFLECT")
        .sort((a, b) => tsOf(a) - tsOf(b));
      for (const x of reflects) {
        const k = [...open]
          .reverse()
          .find(
            (o) => o.first.destUnitId === x.destUnitId && sameSpell(o.first, x),
          );
        if (k && tsOf(x) - tsOf(k.last) <= REFLECT_CHAIN_GAP_MS) {
          k.last = x;
          k.members.push(x);
          chainOf.set(x, k);
        } else {
          const n = { first: x, last: x, members: [x] };
          open.push(n);
          chainOf.set(x, n);
        }
      }
    }
    // every Nether Ward row on the caster that names a spell it reflected,
    // with the reflect it names and what it returned
    const rows: Array<{
      d: any;
      ts: number;
      hit: any;
      amount: number;
      /** the absorb rows `amount` counted */
      absorbs: any[];
    }> = [];
    for (const d of (c.damageIn ?? []) as any[]) {
      if (String(d.spellId) !== NETHER_WARD) continue;
      const ts = tsOf(d);
      if (ts > ctx.roundEndAt) continue;
      const r = d.srcUnitId;
      const named = new Set<string>();
      const rowAbsorbs = ((c.absorbsIn ?? []) as any[]).filter(
        (a) => tsOf(a) === ts && a.attackerId === r && a.attackSpellId,
      );
      for (const a of rowAbsorbs)
        if (String(a.attackSpellId) !== NETHER_WARD)
          named.add(String(a.attackSpellId));
      for (const e of (c.auraEvents ?? []) as any[])
        if (
          tsOf(e) === ts &&
          e.srcUnitId === r &&
          (ev(e) === APPLIED || ev(e) === REFRESH) &&
          String(e.spellId) !== NETHER_WARD
        )
          named.add(String(e.spellId));
      if (named.size === 0) continue;
      const hit = ((c.missesOut ?? []) as any[])
        .filter(
          (x) =>
            x.missType === "REFLECT" &&
            x.destUnitId === r &&
            tsOf(x) <= ts &&
            tsOf(x) >= ts - 3_000 &&
            [...named].some(
              (n) =>
                n === String(x.spellId) ||
                (nameOf(n) !== "" && nameOf(n) === nameOf(x.spellId)),
            ),
        )
        .sort((a, b) => tsOf(b) - tsOf(a))[0];
      if (!hit) continue;
      // what the analysis side credits to Y's chain: the row, the own id's
      // absorbs (`creditOwnId`) and Y's own absorbs (`credit`), a deferral's
      // never (review 20-F24-02 #2)
      const absorbs = rowAbsorbs.filter(
        (a) =>
          !isDeferralAbsorb(a) &&
          (String(a.attackSpellId) === NETHER_WARD ||
            String(a.attackSpellId) === String(hit.spellId)),
      );
      const amount =
        Math.abs(d.effectiveAmount ?? 0) +
        absorbs.reduce((t, a) => t + Math.abs(a.absorbedAmount ?? 0), 0);
      rows.push({ d, ts, hit, amount, absorbs });
    }
    for (const { d, ts, hit, amount } of rows) {
      const r = d.srcUnitId;
      ctx.bump("wardReturnMisnamed");
      const y = nameOf(hit.spellId, hit.spellName);
      const pidR = ctx.pidOf(ctx.units.find((u) => u.id === r)?.name ?? "");
      // Y's reflect chain (grouped above from the rows): its line stands at
      // the chain's first reflect, and the 5 % floor reads the chain's whole
      // return at that first reflect (GH #181) — every Nether Ward row
      // naming one of the chain's reflects, an absorb row two damage rows of
      // one millisecond both named counted once (codex review). A Nether
      // Ward row naming no spell is left out (as it always was): pairing it
      // to a reflect is the analysis's timing rule, not a row's statement,
      // so the total can only read low — a missed line, never a false one
      // (codex review, second round; recorded on GH #181)
      const chain = chainOf.get(hit);
      const firstMs = chain ? tsOf(chain.first) : tsOf(hit);
      let total = amount;
      if (chain) {
        const mine = rows.filter(
          (o) => o.d.srcUnitId === r && chainOf.get(o.hit) === chain,
        );
        const seenAbsorbs = new Set<any>();
        total = 0;
        for (const o of mine) {
          total += Math.abs(o.d.effectiveAmount ?? 0);
          for (const a of o.absorbs)
            if (!seenAbsorbs.has(a)) {
              seenAbsorbs.add(a);
              total += Math.abs(a.absorbedAmount ?? 0);
            }
        }
      }
      const fromSec = Math.floor((firstMs - ctx.start) / 1000) - 3;
      const toSec = Math.floor((ts - ctx.start) / 1000);
      const span = lines.filter(
        (l) =>
          l.caster === pidC &&
          (!pidR || l.reflector === pidR) &&
          l.sec >= fromSec &&
          l.sec <= toSec,
      );
      if (span.some((l) => l.spell === y)) continue;
      // the analysis side's floor reading: max HP near the chain's first
      // reflect
      const maxHp = maxHpNear(c, firstMs);
      // the timing rule goes wrong only when another of the caster's spells
      // was reflected by the same reflector after Y and before the row
      const stolenBy = new Set(
        ((c.missesOut ?? []) as any[])
          .filter(
            (x) =>
              x.missType === "REFLECT" &&
              x.destUnitId === r &&
              tsOf(x) <= ts &&
              tsOf(x) > tsOf(hit) &&
              nameOf(x.spellId, x.spellName) !== y,
          )
          .map((x) => nameOf(x.spellId, x.spellName)),
      );
      // a return under the 5 % floor prints no line of its own, so neither
      // kind can be read off it (review 20-F24-01: 14bb43b3 2:39 Twin Flame
      // 17k = 1.3 % beside a Living Flame line of its own)
      if (!maxHp || (total / maxHp) * 100 < REFLECT_MIN_DAMAGE_PCT) continue;
      const kind = span.some((l) => stolenBy.has(l.spell))
        ? "misnamed"
        : span.length === 0
          ? "missing"
          : undefined;
      if (!kind) continue;
      ctx.violate(
        "wardReturnMisnamed",
        kind,
        ts,
        `${c.name}#${Math.floor((ts - ctx.start) / 1000)}#${y}`,
        `${y} came back ${Math.round(total / 1000)}k under Nether Ward at ${fmtS((ts - ctx.start) / 1000)}; lines: ${span.map((l) => l.spell).join(", ") || "none"}`,
      );
    }
  }
}

export function run(ctx: IRoundCtx): void {
  petKickers(ctx);
  ledgerDefs(ctx);
  if (ctx.firstOwnerOfRound) wardReturns(ctx);
}
