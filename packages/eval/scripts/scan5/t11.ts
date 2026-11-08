/* eslint-disable @typescript-eslint/no-explicit-any -- legacy parse objects (units, missesIn, auraEvents) */
/**
 * scan5/t11.ts — pipeline T11 (fact12 D3 / D7): a control or kick
 * the log shows refused, printed as if nothing refused it. Truth = the log's
 * own rows of the press (SUCCESS, SPELL_MISSED, aura APPLIED / REFRESH);
 * `castAndEffectIds` and English names are lookups.
 *
 * Check `refusedControlRead`, kinds:
 *  - `kickMissDropped` (D3, 1d26a991 1:40): `[KICK] your X on N — hit
 *    nothing` (or `JUKED …`, `hit nothing — …`) with no miss tag, while a non-ABSORB SPELL_MISSED of X by the kicker (or its
 *    summon) follows the press within 2.5 s with no other press of X in
 *    between — Rebuke refused IMMUNE by Eye Beam 178 ms after the cast.
 *  - `bareNoLanding:you` / `bareNoLanding:team` (D7, 3c8b52e7 r0 1:52): a
 *    `[YOU] [CC] S → N` / `[TEAM] [CC] C … cast S → N` line aimed at one
 *    enemy player with no fail tag (`[IMMUNE`, `[MISSED on`, `[REFLECTED`,
 *    `[no CC aura logged`, …), while the caster's press of S at N put no
 *    aura of S (its ids or its English name) on N in [−0.1 s, +2.5 s] and
 *    logged no non-ABSORB miss of it there — Imprison into Nullifying
 *    Shroud, logged 221527 while the ledger keys 217832.
 */
import { castAndEffectIds } from "@gladlog/analysis/src/data/castEffectAuras";

import {
  APPLIED,
  ev,
  type IRoundCtx,
  nameOf,
  REFRESH,
  successesOf,
  tsOf,
} from "./ctx";

export const CHECKS = ["refusedControlRead"] as const;

/** the owner's kick that stopped nothing: `hit nothing[ — X had interrupted
 * …]` or `JUKED …` (`context/timelineSections/kick.ts`) */
const KICK_NOTHING =
  /^(\d+):(\d\d)\s+\[KICK\]\s+your (.+?)(?: on .+?)? — (.*)$/;
const YOU_CC = /^(\d+):(\d\d)\s+\[YOU\] \[CC\]\s+(.+?) → (\d+)\([^)]*\)(.*)$/;
const TEAM_CC =
  /^(\d+):(\d\d)\s+\[TEAM\] \[CC\]\s+(\d+)\([^)]*\) \([^)]*\) cast (.+?) → (\d+)\([^)]*\)(.*)$/;
const FAIL_TAG =
  /\[(?:IMMUNE|MISSED on|REFLECTED|PARRIED|DODGED|EVADED|DEFLECTED|RESISTED|no CC aura logged|hit no enemy player)/;
const AFTER_MS = 2500;
const LEAD_MS = 100;

export function run(ctx: IRoundCtx): void {
  const sourcesOf = (u: any) =>
    new Set<string>([
      u.id,
      ...ctx.units.filter((x: any) => x.ownerId === u.id).map((x) => x.id),
    ]);
  const secOfTs = (ms: number) => Math.floor((ms - ctx.start) / 1000);
  for (const line of ctx.lines) {
    const k = KICK_NOTHING.exec(line);
    if (k && ctx.owner) {
      ctx.bump("refusedControlRead");
      if (FAIL_TAG.test(k[4]!)) continue;
      const sec = Number(k[1]) * 60 + Number(k[2]);
      const name = k[3]!;
      const src = sourcesOf(ctx.owner);
      const pressesOfName = ctx.units
        .filter((u: any) => src.has(u.id))
        .flatMap((u: any) => successesOf(u))
        .filter((c: any) => nameOf(c.spellId, c.spellName ?? "") === name)
        .map((c: any) => tsOf(c) as number)
        .sort((a: number, b: number) => a - b);
      const press = pressesOfName.find((t) => secOfTs(t) === sec);
      if (press === undefined) continue;
      const miss = ctx.units
        .flatMap((u: any) => (u.missesIn ?? []) as any[])
        .find(
          (m) =>
            src.has(m.srcUnitId) &&
            m.missType !== "ABSORB" &&
            nameOf(m.spellId, m.spellName ?? "") === name &&
            m.timestamp >= press - LEAD_MS &&
            m.timestamp <= press + AFTER_MS &&
            !pressesOfName.some(
              (t) => t > press + 5 && t <= m.timestamp + LEAD_MS,
            ),
        );
      if (miss)
        ctx.violate(
          "refusedControlRead",
          "kickMissDropped",
          miss.timestamp,
          `${name}@${press}`,
          `${miss.missType} on ${miss.destUnitName} ${miss.timestamp - press} ms after the press`,
          line,
        );
      continue;
    }
    const y = YOU_CC.exec(line);
    const t = y ? undefined : TEAM_CC.exec(line);
    const parts = y
      ? {
          sec: [y[1]!, y[2]!],
          caster: ctx.owner,
          spell: y[3]!,
          to: y[4]!,
          rest: y[5]!,
          kind: "you",
        }
      : t
        ? {
            sec: [t[1]!, t[2]!],
            caster: ctx.unitOfPid(t[3]),
            spell: t[4]!,
            to: t[5]!,
            rest: t[6]!,
            kind: "team",
          }
        : undefined;
    if (!parts || !parts.caster) continue;
    // one aimed target: no further targets, no fail tag
    if (/^, \d+\(|\[\d+ enem/.test(parts.rest) || FAIL_TAG.test(parts.rest))
      continue;
    const dest = ctx.unitOfPid(parts.to);
    if (!dest?.info) continue;
    const sec = Number(parts.sec[0]) * 60 + Number(parts.sec[1]);
    const press = successesOf(parts.caster).find(
      (c: any) =>
        secOfTs(tsOf(c)) === sec &&
        c.destUnitId === dest.id &&
        nameOf(c.spellId, c.spellName ?? "") === parts.spell,
    );
    if (!press) continue;
    ctx.bump("refusedControlRead");
    const t0 = tsOf(press) as number;
    const src = sourcesOf(parts.caster);
    const fam = castAndEffectIds(String(press.spellId));
    const ofPress = (id: any, name: string | undefined) =>
      id !== undefined &&
      (fam.has(String(id)) || nameOf(id, name ?? "") === parts.spell);
    const inWin = (ms: number) => ms >= t0 - LEAD_MS && ms <= t0 + AFTER_MS;
    const landed = ((dest.auraEvents ?? []) as any[]).some(
      (a) =>
        src.has(a.srcUnitId) &&
        (ev(a) === APPLIED || ev(a) === REFRESH) &&
        ofPress(a.spellId, a.spellName) &&
        inWin(tsOf(a)),
    );
    const missed = ((dest.missesIn ?? []) as any[]).some(
      (m) =>
        src.has(m.srcUnitId) &&
        m.missType !== "ABSORB" &&
        ofPress(m.spellId, m.spellName) &&
        inWin(m.timestamp),
    );
    if (!landed && !missed)
      ctx.violate(
        "refusedControlRead",
        `bareNoLanding:${parts.kind}`,
        t0,
        `${parts.spell}@${t0}`,
        `press ${press.spellId} on ${dest.name}: no aura, no miss of it in [-0.1 s, +2.5 s]`,
        line,
      );
  }
}
