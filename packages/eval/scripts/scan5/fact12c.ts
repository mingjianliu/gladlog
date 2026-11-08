/* eslint-disable @typescript-eslint/no-explicit-any -- scan over raw parse output */
/**
 * fact12c class checks (pipeline T14: a summon's own GUID decides whose it
 * is, and its owner's talents decide how long its effect runs).
 *
 *  - rootSummonOwner (fact12 D29): a `[ROOT] <spell> (from N(X)'s
 *    totem|pet|guardian) rooted …  M(Y)` line. Log truth: the APPLIED /
 *    REFRESH rows of a root of that English name on M(Y) logged inside the
 *    line's second, by a source that is no player — the summon's owner is
 *    the parse's `ownerId` of that very GUID (its SPELL_SUMMON / advanced
 *    owner field). A line crediting N when no such row's summon is N's is a
 *    violation, kind `wrongOwner` (two shamans on one team, each with an
 *    "Earthgrab Totem": the name names both). Counted: every such line with
 *    an owned summon row in its second.
 *  - kitLastsUnderAreaAura (GH #123.2): a kit entry `<Name> [… lasts Ns]`
 *    of player P whose aura of the same English name is NOT logged with P
 *    as its source — put on units by a summon P owns, or written with no
 *    source at all (Anti-Magic Zone's 145629 is `0000000000000000,nil` on
 *    every row) right after P's SUCCESS of that name (≤ 1 s, P the only
 *    such presser; a summon's aura counts only after P's own press of that
 *    name, likewise) — and ran its course (APPLIED → REMOVED, no REFRESH in
 *    between, inside the round) N + 1 s or longer (the kit's whole-second
 *    grid). Nothing tied the
 *    zone to its death knight, so P's own Assimilation 374383 +2 s was
 *    never priced. Counted: every kit entry with such a clean lifetime in
 *    the round.
 */
import { fmtS, type IRoundCtx, nameOf, REMOVED, secOf } from "./ctx";

export const CHECKS = [
  "rootSummonOwner",
  "kitLastsUnderAreaAura",
  "areaAuraOpenEnd",
] as const;
/** an inventory, not a wrong line: how many source-less applications the
 * interval layer has to cap without the presser's talents */
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "areaAuraOpenEnd|noRemoved",
]);

const APPLIED = "SPELL_AURA_APPLIED";
const REFRESH = "SPELL_AURA_REFRESH";
const LABEL = String.raw`(\d+)\([A-Za-z]+\)`;
const ROOT_RE = new RegExp(
  String.raw`^\s*(\d+:\d{2})\s+\[ROOT\]\s+(.+?) \(from ${LABEL}'s (totem|pet|guardian)\) rooted (?:enemy|friendly) (?:\[YOU\] )?${LABEL} `,
);
const UNIT_RE = /<unit id="(\d+)" name="([^"]+)"/;
const KIT_ENTRY_RE = /(?:^|, )([^[,]+?) \[([^\]]*)\]/g;
const LASTS_RE = /lasts (\d+(?:\.\d+)?)(?:–(\d+(?:\.\d+)?))?s/;
const NIL_GUID = "0000000000000000";
/** a source-less aura row follows its press by at most this */
const NIL_SOURCE_PRESS_LEAD_MS = 1000;
/** the kit prints whole seconds: a lifetime is past `lasts N s` only once
 * it reaches N + 1 s (a 6.7 s Spirit Link Totem run is "6 s" on the grid) */
const LASTS_GRID_S = 1;

export function run(ctx: IRoundCtx): void {
  rootSummonOwner(ctx);
  kitLastsUnderAreaAura(ctx);
  if (ctx.firstOwnerOfRound) areaAuraOpenEnd(ctx);
}

/**
 * areaAuraOpenEnd (GH #123.2, inventory): a source-less APPLIED (a
 * `0000000000000000` source) right after one player's SUCCESS of its name
 * (`presserOf`) with no REMOVED of it on that unit before the round's end
 * of play — the interval layer caps such a run at the aura's length with
 * no caster, so the presser's duration talent is not in it. Kind
 * `noRemoved`, out of the total. Counted: every such attributed APPLIED.
 */
function areaAuraOpenEnd(ctx: IRoundCtx): void {
  const endAt = Math.min(ctx.end, ctx.roundEndAt);
  for (const u of ctx.units) {
    const rows = ((u.auraEvents ?? []) as any[]).filter(
      (a) =>
        a.destUnitId === u.id &&
        a.spellId &&
        (!a.srcUnitId || a.srcUnitId === NIL_GUID),
    );
    for (const [i, a] of rows.entries()) {
      if (a.logLine?.event !== APPLIED) continue;
      const t = a.logLine.timestamp;
      if (t < ctx.start || t > endAt) continue;
      const name = nameOf(a.spellId, a.spellName);
      const p = presserOf(ctx, name, t);
      if (!p) continue;
      ctx.bump("areaAuraOpenEnd");
      const closed = rows
        .slice(i + 1)
        .some(
          (b) =>
            b.spellId === a.spellId &&
            b.logLine?.event === REMOVED &&
            b.logLine.timestamp <= endAt,
        );
      if (closed) continue;
      ctx.violate(
        "areaAuraOpenEnd",
        "noRemoved",
        t,
        `${u.id}|${a.spellId}@${t}`,
        `${name} on ${u.name.split("-")[0]} from ${fmtS((t - ctx.start) / 1000)} (pressed by ${p.name.split("-")[0]}) has no REMOVED before the round's end`,
      );
    }
  }
}

const unitById = (ctx: IRoundCtx): Map<string, any> =>
  new Map(ctx.units.map((u: any) => [u.id, u]));

function rootSummonOwner(ctx: IRoundCtx): void {
  const byId = unitById(ctx);
  for (const line of ctx.lines) {
    const m = ROOT_RE.exec(line);
    if (!m) continue;
    const sec = secOf(m[1]!);
    const spell = m[2]!;
    const credited = ctx.unitOfPid(m[3]!);
    const rooted = ctx.unitOfPid(m[5]!);
    if (!credited || !rooted) continue;
    const lo = ctx.start + sec * 1000;
    const rows = ((rooted.auraEvents ?? []) as any[]).filter((a) => {
      const ev = a.logLine?.event;
      const t = a.logLine?.timestamp ?? a.timestamp;
      if (ev !== APPLIED && ev !== REFRESH) return false;
      if (a.destUnitId !== rooted.id) return false;
      if (t < lo || t >= lo + 1000) return false;
      if (nameOf(a.spellId, a.spellName) !== spell) return false;
      const src = byId.get(a.srcUnitId);
      return src !== undefined && !src.info && Boolean(src.ownerId);
    });
    if (rows.length === 0) continue;
    ctx.bump("rootSummonOwner");
    const owners = new Set(
      rows.map((a) => byId.get(a.srcUnitId)!.ownerId as string),
    );
    if (owners.has(credited.id)) continue;
    const first = rows[0];
    const t = first.logLine?.timestamp ?? first.timestamp;
    const real = [...owners]
      .map((o) => byId.get(o)?.name ?? o)
      .map((n) => (ctx.pidOf(n) ? `${ctx.pidOf(n)}` : n))
      .join(", ");
    ctx.violate(
      "rootSummonOwner",
      "wrongOwner",
      t,
      `${first.srcUnitId}@${t}`,
      `${m[1]} ${spell} credited to ${m[3]}'s ${m[4]}; the summon ${first.srcUnitId} is owned by unit ${real}`,
      line,
    );
  }
}

function kitLastsUnderAreaAura(ctx: IRoundCtx): void {
  const byId = unitById(ctx);
  // the clean lifetimes of every summon-sourced aura in the round, per
  // (summon owner, English name)
  const longest = new Map<string, { s: number; at: number; src: string }>();
  const endAt = Math.min(ctx.end, ctx.roundEndAt);
  for (const u of ctx.units) {
    const open = new Map<string, { t: number; clean: boolean }>();
    for (const a of (u.auraEvents ?? []) as any[]) {
      if (a.destUnitId !== u.id || !a.spellId) continue;
      const ev = a.logLine?.event;
      const t = a.logLine?.timestamp ?? a.timestamp;
      const src = byId.get(a.srcUnitId);
      if (src?.info) continue;
      if (!src?.ownerId && a.srcUnitId && a.srcUnitId !== NIL_GUID) continue;
      const k = `${a.srcUnitId}|${a.spellId}`;
      if (ev === APPLIED) open.set(k, { t, clean: true });
      else if (ev === REFRESH) {
        const o = open.get(k);
        if (o) o.clean = false;
      } else if (ev === REMOVED) {
        const o = open.get(k);
        open.delete(k);
        if (!o?.clean || o.t < ctx.start || t > endAt) continue;
        const s = (t - o.t) / 1000;
        const name = nameOf(a.spellId, a.spellName);
        // the owner's own press of that name puts it there — a summon's
        // own same-named spell (the Forgotten Queen's guardian's Divine
        // Shield, a ghoul's Anti-Magic Shell) is not the kit entry's aura
        const presser = presserOf(ctx, name, o.t);
        const ownerId: string | undefined = src?.ownerId
          ? presser?.id === src.ownerId
            ? src.ownerId
            : undefined
          : presser?.id;
        if (!ownerId) continue;
        const key = `${ownerId}|${name}`;
        const prev = longest.get(key);
        if (!prev || s > prev.s)
          longest.set(key, { s, at: o.t, src: a.srcUnitId });
      }
    }
  }
  if (longest.size === 0) return;
  let unit: any;
  for (const line of ctx.lines) {
    const um = UNIT_RE.exec(line);
    if (um) {
      unit = ctx.byName.get(um[2]!);
      continue;
    }
    const ci = line.indexOf("<cooldowns>");
    if (ci < 0 || !unit) continue;
    const body = line.slice(ci + 11).replace(/<\/cooldowns>.*$/, "");
    for (const e of body.matchAll(KIT_ENTRY_RE)) {
      const name = e[1]!.trim();
      const lm = LASTS_RE.exec(e[2]!);
      if (!lm) continue;
      const hit = longest.get(`${unit.id}|${name}`);
      if (!hit) continue;
      ctx.bump("kitLastsUnderAreaAura");
      const printed = Number(lm[2] ?? lm[1]);
      if (hit.s < printed + LASTS_GRID_S) continue;
      ctx.violate(
        "kitLastsUnderAreaAura",
        "outlived",
        hit.at,
        `${unit.id}|${name}`,
        `${unit.name.split("-")[0]} ${name} printed lasts ${printed}s; its summon ${hit.src} kept it ${hit.s.toFixed(1)}s from ${fmtS((hit.at - ctx.start) / 1000)}`,
        `${name} [${e[2]}]`,
      );
    }
  }
}

/** the one player whose SUCCESS of `name` came ≤ 1 s before `at` */
function presserOf(ctx: IRoundCtx, name: string, at: number): any {
  const ps = ctx.players.filter((p: any) =>
    ((p.spellCastEvents ?? []) as any[]).some(
      (c) =>
        c.logLine?.event === "SPELL_CAST_SUCCESS" &&
        at - c.logLine.timestamp >= 0 &&
        at - c.logLine.timestamp <= NIL_SOURCE_PRESS_LEAD_MS &&
        nameOf(c.spellId, c.spellName) === name,
    ),
  );
  return ps.length === 1 ? ps[0] : undefined;
}
