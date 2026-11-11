/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, missesOut, auraEvents, spellCastEvents) */
/**
 * scan5/fact9f.ts — the round-9 audit's class-5 checks (fact9 F24: whose
 * reflect, absorb and immunity a row is). Truth is read off the log rows;
 * lookups (DB2 effects, cast → effect ids, the totem's NPC id, spell names)
 * only name things.
 *
 *  - `immuneHitControl` (D15): an `[ENEMY DEF] … | during it:` segment's
 *    `N hits immune` above the IMMUNE rows of the ally and its summons (the
 *    unit the line counts, T51) on the target, inside the
 *    line's own span (press second … + its printed length + 1 s), whose
 *    spell deals damage (DB2 `dealsDamage`). A control the target refused
 *    (Binding Shot's stun into Icebound Fortitude) is no hit.
 *  - `ccTagPetMiss` (D24): an aimed `[YOU] [CC]` / `[TEAM] [CC]` cast line
 *    tagged `[no CC aura logged` although a summon of the caster (a
 *    Hunter's pet carries Intimidation's stun) logged a miss row of the
 *    press's own ids (cast or effect) on that target, `CAST_MISS_LEAD_MS`
 *    before the cast row to 2.5 s after it.
 *  - `ccTagOtherAuraLanding` (D25): an aimed cast line of a control with no
 *    fail tag at all, on an enemy player that got no aura of the press's own
 *    ids (or of its English name — a skin variant) from the caster or its
 *    summons in that window and no miss row of them: the line reads as
 *    landed. Scatter Shot into Nullifying Shroud, a Freezing Trap 2.4 s
 *    later read as its landing.
 *  - `groundedTwice` (D28): more `[GROUNDED]` lines of one caster's spell
 *    in one second than redirects the log shows there — a cast row into the
 *    totem, plus each IMMUNE row on it no such cast (same English name) is
 *    within `CAST_MISS_LEAD_MS` before … 3 s after.
 *  - `nilAttackerUnknown` (D29 / D31): a `Unknown — <spell>` damage source
 *    in a round whose log has a nil-attacker SPELL_ABSORBED of that spell
 *    the very next damage / ABSORB-miss row of (same victim, same spell,
 *    ≤ 5 ms later) names its source — the game writes a hit's absorb rows
 *    just before the hit's own row. Read from the raw lines: the fix is in
 *    the parser.
 */
import { castAndEffectIds } from "@gladlog/analysis/src/data/castEffectAuras";
import { CAST_MISS_LEAD_MS } from "@gladlog/analysis/src/utils/castMissRows";
import { isImmuneHitRow } from "@gladlog/analysis/src/utils/externalDamage";
import { isGroundingTotemTarget } from "@gladlog/analysis/src/utils/groundingRedirects";
import { foldsIntoOwner } from "@gladlog/parser-compat";

import {
  APPLIED,
  type IRoundCtx,
  nameOf,
  REFRESH,
  secOf,
  successesOf,
  tsOf,
} from "./ctx";
import { wallAuraSpan } from "./t51";

export const CHECKS = [
  "immuneHitControl",
  "immuneSwingDropped",
  "ccTagPetMiss",
  "ccTagOtherAuraLanding",
  "groundedTwice",
  "nilAttackerUnknown",
] as const;

const NIL = "0000000000000000";
const CC_LANDING_WINDOW_MS = 2500;

const summonsOf = (ctx: IRoundCtx, caster: any): any[] =>
  ctx.units.filter((u) => u.ownerId === caster.id);
const sourcesOf = (ctx: IRoundCtx, caster: any): Set<string> =>
  new Set([caster.id, ...summonsOf(ctx, caster).map((u) => u.id)]);
/** `5(PEvoker)` → the context's unit 5 */
const unitOfLabel = (ctx: IRoundCtx, label: string | undefined): any =>
  ctx.unitOfPid(/^(\d+)\(/.exec(label ?? "")?.[1]);

// ---------------------------------------------------------------- D15
const ENEMY_DEF_DURING =
  /^(\d+:\d{2}) {2}\[ENEMY DEF\] {3}\d+\([^)]*\) \([^)]*\): .+? → (\d+\([^)]*\)) \((\d+(?:\.\d+)?)s.*\| during it: (.+)$/;
const SEG_IMMUNE = /^(\d+\([^)]*\)) .* · (\d+) hits? immune · /;

function immuneHits(ctx: IRoundCtx): void {
  for (const line of ctx.lines) {
    const m = ENEMY_DEF_DURING.exec(line);
    if (!m) continue;
    const target = unitOfLabel(ctx, m[2]);
    if (!target) continue;
    const fromMs = ctx.start + secOf(m[1]!) * 1000;
    // the line is stamped at the press; the aura can go on over a second
    // later (T51, 605 file 13 r2 2:07: a Blessing of Protection pressed at
    // 127.9 s, on at 129.2 s, off at 133.6 s — a pet's IMMUNE row at 132.8 s
    // is inside it and past press + length + 1 s). The span is the target's
    // own aura rows of that wall, both ends inclusive, when the log has
    // them; the stamp + printed length + 1 s when it does not.
    const span = wallAuraSpan(ctx, line, target, fromMs);
    const loMs = span ? span.from : fromMs;
    const toMs = span ? span.to : fromMs + (Number(m[3]) + 1) * 1000;
    for (const seg of m[4]!.split("; ")) {
      swingUndercount(ctx, line, m, seg, fromMs);
      const s = SEG_IMMUNE.exec(seg);
      if (!s) continue;
      const ally = unitOfLabel(ctx, s[1]);
      if (!ally) continue;
      ctx.bump("immuneHitControl");
      // the ally and its summons: the unit the line counts (T51)
      const rows = [ally, ...ctx.units.filter((u) => foldsIntoOwner(u, ally))]
        .flatMap((u) => (u.missesOut ?? []) as any[])
        .filter(
          (r) =>
            r.missType === "IMMUNE" &&
            r.destUnitId === target.id &&
            tsOf(r) >= loMs &&
            (span ? tsOf(r) <= toMs : tsOf(r) < toMs),
        );
      const hits = rows.filter((r) => isImmuneHitRow(r));
      const printed = Number(s[2]);
      if (printed <= hits.length) continue;
      const refused = rows
        .filter((r) => !hits.includes(r))
        .map((r) => nameOf(r.spellId, r.spellName));
      ctx.violate(
        "immuneHitControl",
        "enemyDef",
        fromMs,
        `${m[1]}#${s[1]}#${m[2]}`,
        `${printed} hits immune, ${hits.length} damaging IMMUNE rows; non-damage: ${[...new Set(refused)].join(", ")}`,
        line.slice(0, 300),
      );
    }
  }
}

/** codex 20-F24-14: an immune melee swing (SWING_MISSED IMMUNE, spellId
 * "0") is a hit — counted from the raw event, not the shared predicate. The
 * window is the wall's whole seconds after its rendered start (the start is
 * floored), so a swing it counts is inside the analysis window. */
const SEG_ALLY = /^(\d+\([^)]*\)) /;
function swingUndercount(
  ctx: IRoundCtx,
  line: string,
  m: RegExpExecArray,
  seg: string,
  fromMs: number,
): void {
  const a = SEG_ALLY.exec(seg);
  const ally = a && unitOfLabel(ctx, a[1]);
  const target = unitOfLabel(ctx, m[2]);
  if (!ally || !target) return;
  const lo = fromMs + 1000;
  const hi = fromMs + Math.floor(Number(m[3])) * 1000;
  const swings = ((ally.missesOut ?? []) as any[]).filter(
    (r) =>
      r.missType === "IMMUNE" &&
      r.logLine?.event === "SWING_MISSED" &&
      r.destUnitId === target.id &&
      tsOf(r) >= lo &&
      tsOf(r) < hi,
  ).length;
  if (swings === 0) return;
  ctx.bump("immuneSwingDropped");
  const printed = Number(SEG_IMMUNE.exec(seg)?.[2] ?? 0);
  if (printed >= swings) return;
  ctx.violate(
    "immuneSwingDropped",
    "enemyDef",
    fromMs,
    `${m[1]}#${a![1]}#${m[2]}`,
    `${printed} hits immune printed, ${swings} immune swings in the wall`,
    line.slice(0, 300),
  );
}

// ---------------------------------------------------------- D24 / D25
const YOU_CC = /^(\d+:\d{2}) {2}\[YOU\] \[CC\] {3}(.+?) → (\d+\([^)]*\))(.*)$/;
const TEAM_CC =
  /^(\d+:\d{2}) {2}\[TEAM\] \[CC\] {3}(\d+\([^)]*\)) \([^)]*\) cast (.+?) → (\d+\([^)]*\))(.*)$/;
const FAIL_TAG =
  /\[(?:no CC aura logged|IMMUNE|MISS|MISSED|REFLECT|REFLECTED|PARRY|PARRIED|DODGE|DODGED|EVADE|EVADED|DEFLECT|DEFLECTED|RESIST|GROUNDED|absorbed: Grounding)/i;

function ccCastLines(ctx: IRoundCtx): void {
  const enemyIds = new Set(
    ctx.players
      .filter((p) => ctx.owner && p.reaction !== ctx.owner.reaction)
      .map((p) => p.id),
  );
  for (const line of ctx.lines) {
    let mss: string, caster: any, spell: string, tgtPid: string, rest: string;
    const y = YOU_CC.exec(line);
    const t = y ? undefined : TEAM_CC.exec(line);
    if (y) {
      [mss, spell, tgtPid, rest] = [y[1]!, y[2]!, y[3]!, y[4]!];
      caster = ctx.owner;
    } else if (t) {
      [mss, spell, tgtPid, rest] = [t[1]!, t[3]!, t[4]!, t[5]!];
      caster = unitOfLabel(ctx, t[2]);
    } else continue;
    const target = unitOfLabel(ctx, tgtPid);
    if (!caster || !target || !enemyIds.has(target.id)) continue;
    const sec = secOf(mss);
    const cast = successesOf(caster).find(
      (c) =>
        c.destUnitId === target.id &&
        Math.floor((tsOf(c) - ctx.start) / 1000) === sec &&
        nameOf(c.spellId, c.spellName) === spell,
    );
    if (!cast) continue;
    const t0 = tsOf(cast);
    const inWindow = (ms: number) =>
      ms >= t0 - CAST_MISS_LEAD_MS && ms <= t0 + CC_LANDING_WINDOW_MS;
    const own = castAndEffectIds(String(cast.spellId));
    const ownSpell = (id: any, name: any) =>
      own.has(String(id)) || nameOf(id, name) === spell;
    const sources = sourcesOf(ctx, caster);
    const summonMiss = summonsOf(ctx, caster).some((s) =>
      ((s.missesOut ?? []) as any[]).some(
        (m) =>
          m.destUnitId === target.id &&
          m.missType !== "ABSORB" &&
          own.has(String(m.spellId)) &&
          inWindow(tsOf(m)),
      ),
    );
    if (rest.includes("[no CC aura logged")) {
      ctx.bump("ccTagPetMiss");
      if (summonMiss)
        ctx.violate(
          "ccTagPetMiss",
          "noAuraTag",
          t0,
          `${mss}#${spell}#${tgtPid}`,
          `a summon of the caster logged a miss row of ${spell} on the target`,
          line.slice(0, 300),
        );
      continue;
    }
    if (FAIL_TAG.test(rest)) continue;
    // a bare aimed line of a control press: it reads as landed
    ctx.bump("ccTagOtherAuraLanding");
    const auraRows = ((target.auraEvents ?? []) as any[]).filter(
      (a) =>
        sources.has(a.srcUnitId) &&
        (a.logLine?.event === APPLIED || a.logLine?.event === REFRESH) &&
        inWindow(tsOf(a)),
    );
    if (auraRows.some((a) => ownSpell(a.spellId, a.spellName))) continue;
    const missRows = ctx.units
      .filter((u) => sources.has(u.id))
      .flatMap((u) => (u.missesOut ?? []) as any[])
      .filter(
        (m) =>
          m.destUnitId === target.id &&
          m.missType !== "ABSORB" &&
          own.has(String(m.spellId)) &&
          inWindow(tsOf(m)),
      );
    if (missRows.length > 0) continue;
    if (summonMiss) continue;
    ctx.violate(
      "ccTagOtherAuraLanding",
      auraRows.length > 0 ? "otherAura" : "nothing",
      t0,
      `${mss}#${spell}#${tgtPid}`,
      auraRows.length > 0
        ? `bare; only other auras: ${[...new Set(auraRows.map((a) => nameOf(a.spellId, a.spellName)))].join(", ")}`
        : "bare; no aura and no miss row of the press",
      line.slice(0, 300),
    );
  }
}

// ---------------------------------------------------------------- D28
const GROUNDED =
  /^(\d+:\d{2}) {2}\[GROUNDED\] {3}(\d+\([^)]*\))'s (.+?) was redirected into /;

function grounded(ctx: IRoundCtx): void {
  const groups = new Map<string, { n: number; line: string }>();
  for (const line of ctx.lines) {
    const m = GROUNDED.exec(line);
    if (!m) continue;
    const k = `${m[1]}#${m[2]}#${m[3]}`;
    const g = groups.get(k);
    if (g) g.n++;
    else groups.set(k, { n: 1, line });
  }
  for (const [k, g] of groups) {
    const [mss, pid, spell] = k.split("#") as [string, string, string];
    const caster = unitOfLabel(ctx, pid);
    if (!caster) continue;
    ctx.bump("groundedTwice");
    if (g.n < 2) continue;
    const sec = secOf(mss);
    const inSec = (ms: number) => Math.floor((ms - ctx.start) / 1000) === sec;
    const casts = successesOf(caster).filter(
      (c) =>
        isGroundingTotemTarget(c.destUnitId, c.destUnitName) &&
        nameOf(c.spellId, c.spellName) === spell,
    );
    const ms = new Set<number>();
    for (const r of (caster.missesOut ?? []) as any[]) {
      if (
        r.missType !== "IMMUNE" ||
        !isGroundingTotemTarget(r.destUnitId, r.destUnitName) ||
        nameOf(r.spellId, r.spellName) !== spell ||
        !inSec(tsOf(r))
      )
        continue;
      const folded = casts.some(
        (c) =>
          tsOf(r) >= tsOf(c) - CAST_MISS_LEAD_MS && tsOf(r) - tsOf(c) <= 3000,
      );
      if (!folded) ms.add(tsOf(r));
    }
    const presses = casts.filter((c) => inSec(tsOf(c))).length + ms.size;
    if (g.n <= presses) continue;
    ctx.violate(
      "groundedTwice",
      "grounded",
      ctx.start + sec * 1000,
      k,
      `${g.n} [GROUNDED] lines, ${presses} redirect(s) in the log`,
      g.line.slice(0, 300),
    );
  }
}

// ---------------------------------------------------------- D29 / D31
/** split one raw row's CSV body (quoted names may hold commas) */
function splitRow(body: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of body) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
const msOfHead = (head: string): number => {
  const t = head.split(" ")[1]!.split(/[-+]/)[0]!;
  const [h, mi, s] = t.split(":");
  return (Number(h) * 3600 + Number(mi) * 60 + Number(s)) * 1000;
};
const DAMAGE_ROWS = new Set([
  "SPELL_DAMAGE",
  "SPELL_PERIODIC_DAMAGE",
  "RANGE_DAMAGE",
  "SPELL_BUILDING_DAMAGE",
  "DAMAGE_SPLIT",
]);
const MISS_ROWS = new Set([
  "SPELL_MISSED",
  "SPELL_PERIODIC_MISSED",
  "RANGE_MISSED",
]);
const UNKNOWN_SRC = /Unknown — (.+?) \[/g;

function nilAttacker(ctx: IRoundCtx): void {
  const unknown = new Map<string, string>();
  for (const line of ctx.lines)
    for (const m of line.matchAll(UNKNOWN_SRC))
      if (!unknown.has(m[1]!)) unknown.set(m[1]!, line);
  if (unknown.size === 0) return;
  // spell (English) → a nil-attacker absorb of it whose twin row names a source
  const named = new Map<string, string>();
  const rows = ctx.rawLines;
  for (let i = 0; i < rows.length; i++) {
    const line = rows[i]!;
    if (!line.includes("SPELL_ABSORBED," + NIL)) continue;
    const sep = line.indexOf("  ");
    if (sep < 0) continue;
    const p = splitRow(line.slice(sep + 2));
    if (p[0] !== "SPELL_ABSORBED" || p[1] !== NIL || p.length < 20) continue;
    const victim = p[5]!;
    const spellId = p[9]!;
    const english = nameOf(spellId, p[10]!);
    if (!unknown.has(english) || named.has(english)) continue;
    const t0 = msOfHead(line.slice(0, sep));
    for (let j = i + 1; j < Math.min(rows.length, i + 40); j++) {
      const r = rows[j]!;
      const s2 = r.indexOf("  ");
      if (s2 < 0) continue;
      if (msOfHead(r.slice(0, s2)) - t0 > 5) break;
      const q = splitRow(r.slice(s2 + 2));
      if (q.length < 12 || q[5] !== victim || q[9] !== spellId) continue;
      if (
        !DAMAGE_ROWS.has(q[0]!) &&
        !(MISS_ROWS.has(q[0]!) && q.includes("ABSORB"))
      )
        continue;
      if (q[1] && q[1] !== NIL) named.set(english, `${q[2]} (${q[1]})`);
      break;
    }
  }
  for (const [spell, line] of unknown) {
    ctx.bump("nilAttackerUnknown");
    const src = named.get(spell);
    if (!src) continue;
    ctx.violate(
      "nilAttackerUnknown",
      "topSources",
      ctx.start,
      spell,
      `Unknown — ${spell}: the log's nil-attacker absorb of it pairs with ${src}`,
      line.slice(0, 300),
    );
  }
}

export function run(ctx: IRoundCtx): void {
  immuneHits(ctx);
  ccCastLines(ctx);
  grounded(ctx);
  nilAttacker(ctx);
}
