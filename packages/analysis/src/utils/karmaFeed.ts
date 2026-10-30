/**
 * Who fed an enemy Windwalker's Touch of Karma (B-tier B20a, user ruling
 * 2026-10-06/07: a fact on the `[ENEMY DEF]` line, never an accusation —
 * "按按键时间,只算业报生效 1 秒后才按下的技能打进去的伤害,之前挂着的持续伤害
 * 单列;写出转回到谁身上、多少").
 *
 * Touch of Karma absorbs the damage the monk takes and sends damage back onto
 * the unit the monk cast it on. Everything here is read off the log:
 *  - what it absorbed: the monk's `absorbsIn` rows whose shield is the cast
 *    id (b711d4ac: 148 rows, all 122470), by attacker and attacking spell;
 *  - what it sent back: the monk's periodic damage rows of the redirect id.
 * The split by PRESS time is `pressBehindDamage` (utils/damagePress.ts).
 *
 * One limit, by the log: an absorbed row does not say whether it was a tick
 * or a direct hit. A row of a spell that ticks for that player this round
 * and was not pressed after the cut is counted under `DoTs already ticking`
 * — for a spell with both a direct and a periodic part (Moonfire) the direct
 * hit of a press made just before the cut lands there too, not under
 * `pressed before that`. Both are parts no player is named for.
 */
import { type ICombatUnit, LogEvent } from "@gladlog/parser-compat";

import { REACTION_WINDOW_S } from "./cooldowns";
import {
  pressBehindDamage,
  type PressCaster,
  spellTicksFor,
} from "./damagePress";

/** The cast, the monk's 10 s buff, the target's debuff and the shield id on
 * the absorb rows — one id. Registered in curatedIdRegistry. */
export const TOUCH_OF_KARMA_ID = "122470";
/** The damage Touch of Karma sends back (periodic rows from the monk). */
export const TOUCH_OF_KARMA_REDIRECT_ID = "124280";
/**
 * The absorb itself: a second buff the press puts on the monk, in the cast's
 * own ms, that leaves when the shield does — the 10 s buff above stays up
 * its full length whatever happens to the shield. Its lines carry no amount
 * and the absorb rows name the CAST id as the shield, never this one. Six
 * raw logs of the 2026-10-08 re-eval, 9 presses (fix-FT/scripts/
 * n4_karma_end.py): this aura came off 0.8–7.5 s in on six of them — five in
 * the ms of a hit the shield took only part of (2abc9185: REMOVED 3.04 s in
 * with a 76k Death Sweep of which it absorbed 48k), one in the ms the debuff
 * came off the target (b711d4ac: the mage it was cast on pressed Ice Block
 * 0.77 s in) — and with the 10 s buff, to within 11 ms, on the other three.
 */
export const TOUCH_OF_KARMA_ABSORB_ID = "125174";
/** All three, for curatedIdRegistry (a renumbered id would silence the
 * clause, or put the buff's end back on the 10 s marker). */
export const TOUCH_OF_KARMA_FEED_IDS: ReadonlySet<string> = new Set([
  TOUCH_OF_KARMA_ID,
  TOUCH_OF_KARMA_REDIRECT_ID,
  TOUCH_OF_KARMA_ABSORB_ID,
]);
/** The buff's official length (DB2 122470: 10 s): absorb rows of a press end
 * with it. */
const KARMA_ABSORB_WINDOW_S = 10;
/** The redirect keeps ticking after the buff: 6 s after its last refresh
 * (b711d4ac: pressed 55.4, last tick 68.7). */
const KARMA_REDIRECT_TAIL_S = 6;
const SLACK_MS = 50;
/** How long after its press a redirect debuff's REMOVED is still this
 * press's: the 10 s buff plus a DoT refreshed to its end (well inside the
 * 90 s cooldown). */
const KARMA_REDIRECT_MAX_S = 30;

export interface IKarmaFeed {
  /** our players' damage it absorbed from spells pressed REACTION_WINDOW_S or
   * more after it went up, largest first */
  fed: Array<{ playerId: string; playerName: string; amount: number }>;
  /** absorbed ticks of effects whose press came before that (or has none) */
  dotsAlreadyTicking: number;
  /** absorbed hits of spells that WERE pressed, but before that — a cast
   * already under way, a ground effect or a missile already out: nothing the
   * player could still take back (user ruling 2026-10-07, option B: stated
   * apart from the pressless rest) */
  pressedBefore: number;
  /** everything it absorbed from our side in the window — the three above
   * plus what has no press at all (auto-attacks, pets, procs) */
  absorbedTotal: number;
  /** the last absorbed row, seconds from the match start; null when none */
  lastAbsorbS: number | null;
  /** redirect damage that landed, by victim, largest first */
  sentBack: Array<{ unitId: string; unitName: string; amount: number }>;
}

/**
 * The feed of the Touch of Karma `monk` pressed at `pressSeconds`.
 * `nextPressSeconds` (the monk's next Touch of Karma, if any) closes both
 * windows early. `ourPlayers` are the players of the side opposing the monk;
 * `allUnits` resolves a pet to its owner.
 */
export function karmaFeedOf(
  monk: Pick<ICombatUnit, "id" | "absorbsIn" | "damageOut">,
  pressSeconds: number,
  nextPressSeconds: number | undefined,
  // `PressCaster`: the press rule reads cast starts and empower holds too —
  // a unit trimmed to its cast successes would turn a hard cast begun before
  // the shield into a press after it (review 37-BD-39)
  ourPlayers: ReadonlyArray<
    PressCaster & Pick<ICombatUnit, "id" | "name" | "damageOut">
  >,
  allUnits: ReadonlyArray<Pick<ICombatUnit, "id" | "ownerId">>,
  matchStartMs: number,
): IKarmaFeed {
  const pressMs = matchStartMs + pressSeconds * 1000;
  const nextMs =
    nextPressSeconds !== undefined
      ? matchStartMs + nextPressSeconds * 1000
      : Infinity;
  const absorbEndMs = Math.min(
    pressMs + KARMA_ABSORB_WINDOW_S * 1000 + SLACK_MS,
    nextMs - SLACK_MS,
  );
  const cutMs = pressMs + REACTION_WINDOW_S * 1000;
  const playerById = new Map(ourPlayers.map((p) => [p.id, p]));
  const ownerOf = new Map(
    allUnits
      .filter((u) => u.ownerId && playerById.has(u.ownerId))
      .map((u) => [u.id, u.ownerId as string]),
  );
  const fedBy = new Map<string, number>();
  let dotsAlreadyTicking = 0;
  let pressedBefore = 0;
  let absorbedTotal = 0;
  let lastAbsorbMs: number | null = null;
  for (const a of monk.absorbsIn ?? []) {
    if (a.spellId !== TOUCH_OF_KARMA_ID) continue;
    if (a.timestamp < pressMs - SLACK_MS || a.timestamp > absorbEndMs) continue;
    const attackerId = a.attackerId ?? "";
    const direct = playerById.get(attackerId);
    // a pet's row counts for the total only: the press rule has no press for it
    if (!direct && !ownerOf.has(attackerId)) continue;
    absorbedTotal += a.absorbedAmount;
    if (lastAbsorbMs === null || a.timestamp > lastAbsorbMs)
      lastAbsorbMs = a.timestamp;
    if (!direct) continue;
    const press = pressBehindDamage(
      direct,
      a.attackSpellId,
      a.attackSpellName,
      a.timestamp,
    );
    if (press !== null && press >= cutMs) {
      fedBy.set(direct.id, (fedBy.get(direct.id) ?? 0) + a.absorbedAmount);
    } else if (a.attackSpellId && spellTicksFor(direct, a.attackSpellId)) {
      dotsAlreadyTicking += a.absorbedAmount;
    } else if (press !== null) {
      pressedBefore += a.absorbedAmount;
    }
  }
  // round-1 retest idx 59: the redirect DoT ends where the log says it does
  // — its debuff's REMOVED on the unit carrying it (8cd58545: refreshed to
  // 2:18.8 and ticking to 2:25.05, past the press + 16 s estimate, whose
  // last 32k tick fell outside) — the estimate only when none is logged
  let loggedEndMs: number | undefined;
  for (const p of ourPlayers)
    for (const a of (p as { auraEvents?: ICombatUnit["auraEvents"] })
      .auraEvents ?? []) {
      if (a.spellId !== TOUCH_OF_KARMA_REDIRECT_ID) continue;
      if (a.logLine.event !== LogEvent.SPELL_AURA_REMOVED) continue;
      // this monk's redirect only (codex 20-F16-09 #2: another monk's
      // removal cut this press's window)
      if (a.srcUnitId !== monk.id) continue;
      if (a.timestamp < pressMs || a.timestamp >= nextMs) continue;
      if (a.timestamp > pressMs + KARMA_REDIRECT_MAX_S * 1000) continue;
      if (loggedEndMs === undefined || a.timestamp > loggedEndMs)
        loggedEndMs = a.timestamp;
    }
  const redirectEndMs = Math.min(
    loggedEndMs !== undefined
      ? loggedEndMs + SLACK_MS
      : pressMs +
          (KARMA_ABSORB_WINDOW_S + KARMA_REDIRECT_TAIL_S) * 1000 +
          SLACK_MS,
    nextMs - SLACK_MS,
  );
  const back = new Map<string, { unitName: string; amount: number }>();
  for (const d of monk.damageOut ?? []) {
    if (d.spellId !== TOUCH_OF_KARMA_REDIRECT_ID) continue;
    if (d.timestamp < pressMs - SLACK_MS || d.timestamp > redirectEndMs)
      continue;
    const amount = Math.abs(d.effectiveAmount);
    if (!(amount > 0)) continue;
    const cur = back.get(d.destUnitId) ?? {
      unitName: d.destUnitName,
      amount: 0,
    };
    cur.amount += amount;
    back.set(d.destUnitId, cur);
  }
  const desc = <T extends { amount: number }>(
    rows: T[],
    key: (r: T) => string,
  ): T[] =>
    rows.sort((a, b) => b.amount - a.amount || (key(a) < key(b) ? -1 : 1));
  return {
    fed: desc(
      [...fedBy].map(([playerId, amount]) => ({
        playerId,
        playerName: playerById.get(playerId)!.name,
        amount,
      })),
      (r) => r.playerName,
    ),
    dotsAlreadyTicking,
    pressedBefore,
    absorbedTotal,
    lastAbsorbS:
      lastAbsorbMs === null ? null : (lastAbsorbMs - matchStartMs) / 1000,
    sentBack: desc(
      [...back].map(([unitId, v]) => ({ unitId, ...v })),
      (r) => r.unitName,
    ),
  };
}

const k = (n: number): string => `${Math.round(n / 1000)}k`;

/**
 * The clause a `[ENEMY DEF] … Touch of Karma (absorb)` line gains, or ""
 * when Touch of Karma absorbed nothing from our side and sent nothing back.
 * `label` renders a player (the line's own pid form), `fmt` a second as m:ss.
 */
export function karmaFeedClause(
  feed: IKarmaFeed,
  label: (unitName: string) => string,
  fmt: (seconds: number) => string,
): string {
  // every amount is printed in whole k: what rounds to 0k is not printed,
  // and a shield that absorbed under 0.5k and sent nothing back has no clause
  const totalK = Math.round(feed.absorbedTotal / 1000);
  const back = feed.sentBack.filter((b) => Math.round(b.amount / 1000) > 0);
  if (totalK <= 0 && back.length === 0) return "";
  const fed = feed.fed.filter((f) => Math.round(f.amount / 1000) > 0);
  const who = fed.length
    ? `fed by (pressed ${REACTION_WINDOW_S} s or more after it went up): ${fed.map((f) => `${label(f.playerName)} ${k(f.amount)}`).join(" · ")}`
    : `fed by: nobody pressed into it ${REACTION_WINDOW_S} s or more after it went up`;
  const dots =
    Math.round(feed.dotsAlreadyTicking / 1000) > 0
      ? ` · DoTs already ticking: ${k(feed.dotsAlreadyTicking)}`
      : "";
  // what the per-player figures leave out, stated so they are not read as
  // everything that went in — in two parts (user ruling 2026-10-07, option
  // B): hits of spells pressed BEFORE the cut (too late to take back), and
  // what has no press at all
  const before =
    Math.round(feed.pressedBefore / 1000) > 0
      ? ` · pressed before that: ${k(feed.pressedBefore)}`
      : "";
  const fedSum = feed.fed.reduce((n, f) => n + f.amount, 0);
  const restK = Math.round(
    (feed.absorbedTotal -
      fedSum -
      feed.dotsAlreadyTicking -
      feed.pressedBefore) /
      1000,
  );
  const rest = restK > 0 ? ` · procs / auto-attacks / pets: ${restK}k` : "";
  const total =
    feed.lastAbsorbS !== null && totalK > 0
      ? ` · absorbed ${totalK}k in all by ${fmt(feed.lastAbsorbS)}`
      : "";
  const sent = back.length
    ? ` · sent back: ${back.map((b) => `${k(b.amount)} onto ${label(b.unitName)}`).join(", ")}`
    : " · sent back: 0";
  return ` | ${who}${dots}${before}${rest}${total}${sent}`;
}
