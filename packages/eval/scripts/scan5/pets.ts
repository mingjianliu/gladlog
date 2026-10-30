/* eslint-disable @typescript-eslint/no-explicit-any -- the checks walk the untyped legacy parse objects (units, actionOut, auraEvents, damageIn) */
/**
 * scan5/pets.ts — summons as units of their own (fact6 F20 class "pets":
 * D3, D11, D22, D30). A summon is a kick target, a control source, a kill
 * victim and a command's executor; each check reads every rendered line of
 * that fact and holds it against the log's own rows. Unit ownership is the
 * parse's `ownerId` (the log's SPELL_SUMMON / advanced owner GUID), side is
 * the roster's `reaction`; no analysis predicate is called. Names are
 * English through `nameOf` (a lookup).
 *
 *  - `kickOnSummon` (D3): a non-landed OWN kick — `[KICK] your K[ on N] —
 *    hit nothing…` / `— JUKED …`, and every `Kicks:` ledger entry
 *    `m:ss K → hit nothing | JUKED … | outcome unknown …`. Log truth: a
 *    SPELL_INTERRUPT row whose source is the owner or a unit the owner owns,
 *    logged inside the line's rendered second (+ 500 ms: an interrupt row
 *    follows its press by up to `LANDED_PAIR_MS`). The kick landed, so the
 *    line is false. Kind = the interrupted unit's GUID type (`Pet` /
 *    `Creature` / `Player` — the last one guards the whole interrupt class,
 *    expected 0). One fact per interrupt row: the ledger entry and the
 *    `[KICK]` line of one kick are one fact.
 *  - `petControlTiming` (D11): a `[BURST ANSWERED] enemy opened X (…) (<E>):
 *    <A> answered with C on T … in Ns | Ns before it opened` line (read with
 *    the producer's own `parseBurstAnsweredLine`) whose control C landed on T
 *    from a summon of A (an APPLIED / REFRESH of English name C on T, source
 *    owned by A, in [lead − 3 s, lead + 20 s]). Lead = E's first
 *    SPELL_CAST_SUCCESS of X in the line's second. The control's instant =
 *    A's own press of name C (a command / Intimidation-type press) in the
 *    3 s before the aura, else the summon's own SUCCESS of C in those 3 s,
 *    else the aura's own instant — never another press of A's. Violation:
 *    the rendered latency is more than 0.1 s off every such landing. Kind
 *    `petAura` (a `Pet-` source, counted); `summonAura` (totem / guardian —
 *    the owner's summon press is the documented cause, open ruling Q3)
 *    is measured, not counted. Lines whose control came from a player are
 *    out of class (no bump).
 *  - `petKillCredit` (D22): `[UNIT DESTROYED] … killed by: <credits>` and
 *    `[KILL] … (killing blow: <credit>`. Victim: the player label of a
 *    `[KILL]` line; for `[UNIT DESTROYED]` the non-player unit (of that owner
 *    when the line says `N(X)'s <pet>`) on the line's side whose first
 *    overkill damage row / death record is in the line's second. Log truth,
 *    worst first, one violation per line:
 *      `splitCredited` — a credited unit is the source of a DAMAGE_SPLIT row
 *        on the victim of the credited spell's name (the link holder, not an
 *        attacker: parser collect.ts, teammates 7,354 / opponents 0);
 *      `sameSideCredit` — a credited player is on the victim's own side
 *        (`(own)` self-damage and the victim itself excluded);
 *      `partyKillMismatch` — single-blow form only (no `(Nk` amount): the
 *        log's PARTY_KILL row for the victim GUID (raw lines; the parser
 *        drops the event) names another player (a summon's owner resolved),
 *        not one on the victim's own side (a transfer's holder).
 *  - `commandDouble` (D30; ruling 2026-10-28 default: a pet-command press +
 *    the pet's cast prints once, as the pet's): a command = a player's START /
 *    SUCCESS row and, within 500 ms, a START / SUCCESS of the same English
 *    name by one of its `Pet-` units. One attempt runs from the first press
 *    to the pet's next SUCCESS of that name (≤ 5 s, else press + 1.5 s), + 1 s.
 *    Lines of one tag — `[CC NOT LANDED]`, `[CC AVOIDED?]`, `[KICK] … missed —
 *    IMMUNE`, `[REFLECTED]` — naming that spell, the same target and the
 *    owner or the owner's summon inside the attempt: more than one is a
 *    violation. Kind = the tag.
 */
import { parseBurstAnsweredLine } from "@gladlog/analysis/src/context/burstAnswered";

import { fmtS, type IRoundCtx, nameOf, secOf, SUCCESS, tsOf } from "./ctx";

export const CHECKS = [
  "kickOnSummon",
  "petControlTiming",
  "petKillCredit",
  "commandDouble",
] as const;
export const OUT_OF_TOTAL: ReadonlySet<string> = new Set([
  "petControlTiming|summonAura",
]);

const INTERRUPT = "SPELL_INTERRUPT";
const START = "SPELL_CAST_START";
const DAMAGE_SPLIT = "DAMAGE_SPLIT";
/** a landed kick's interrupt row trails its press by at most this */
const INTERRUPT_TRAIL_MS = 500;
/** the fuse / command lead the control-timing truth looks back over */
const CONTROL_LOOKBACK_MS = 3000;
/** an owner press and the pet row that carried it out */
const COMMAND_PAIR_MS = 500;

const LABEL = String.raw`\d+\([A-Za-z]+\)`;
const SUMMON_LABEL = String.raw`${LABEL}(?:'s (?:pet|guardian|totem))?`;
const KICK_OWN_RE =
  /^\s*(\d+:\d{2})\s+\[KICK\]\s+your (.+?) — (hit nothing|JUKED)/;
const KICKS_LEDGER_RE = /^\s*Kicks: (.*)$/;
const LEDGER_ENTRY_RE = /^(\d+:\d{2}) (.+?) → (.*)$/;
const OPENER_RE = new RegExp(
  String.raw`\[BURST ANSWERED\]\s+enemy opened (.+?)(?: \(\+.*?\))? \((${LABEL})\): `,
);
const UNIT_DESTROYED_RE =
  /^\s*(\d+:\d{2})\s+\[UNIT DESTROYED\]\s+(.+?) \((Enemy|Friendly|Unknown)\) killed by: (.*)$/;
const KILL_RE = new RegExp(
  String.raw`^\s*(\d+:\d{2})\s+\[KILL\]\s+(${LABEL}) .*?\(killing blow: (.*?)(?:; most damage|\)$)`,
);
const CREDIT_RE = new RegExp(
  String.raw`(?:^|, )(${SUMMON_LABEL}|\[pet\]|[^,—]+?) — ([^\[,(]+?)(?: \[[^\]]*\])?(?: \((\d[^)]*)\))?(?=, |$)`,
  "g",
);
const CC_NOT_LANDED_RE =
  /^\s*(\d+:\d{2})\s+\[CC NOT LANDED\]\s+(\S+) ← (.+?) \(by (.+?)\) — logged [A-Z]+/;
const CC_AVOIDED_RE =
  /^\s*(\d+:\d{2})\s+\[CC AVOIDED\?\]\s+(\S+): (.+?) \(by (.+?)\) (?:logged|did not land)/;
const KICK_IMMUNE_RE = new RegExp(
  String.raw`^\s*(\d+:\d{2})\s+\[KICK\]\s+(${SUMMON_LABEL})'s (.+?) on (\S+) missed — IMMUNE`,
);
const REFLECTED_RE = new RegExp(
  String.raw`^\s*(\d+:\d{2})\s+\[REFLECTED\]\s+(${SUMMON_LABEL})'s (.+?) reflected by (\S+)`,
);

const guidType = (id: string): string =>
  id.startsWith("Player-")
    ? "Player"
    : id.startsWith("Pet-")
      ? "Pet"
      : id.startsWith("Creature-") || id.startsWith("Vehicle-")
        ? "Creature"
        : "other";
const pidOfLabel = (label: string): string | undefined =>
  /^(\d+)\(/.exec(label)?.[1];

let commandPairs = 0;
let partyKillRows = 0;
let splitOverkillRows = 0;

export function run(ctx: IRoundCtx): void {
  const { units, start, owner } = ctx;
  const unitById = new Map<string, any>(units.map((u) => [u.id, u]));
  const ownedBy = (u: any): any[] =>
    units.filter((x) => x.ownerId && x.ownerId === u.id);
  /** the player behind a unit: itself, or its owner */
  const playerOf = (id: string | undefined): any => {
    const u = id ? unitById.get(id) : undefined;
    if (!u) return undefined;
    if (u.info) return u;
    const o = u.ownerId ? unitById.get(u.ownerId) : undefined;
    return o?.info ? o : undefined;
  };
  const labelUnit = (label: string): any => ctx.unitOfPid(pidOfLabel(label));
  const secMs = (sec: number) => start + sec * 1000;
  const renderSec = (ms: number) => Math.floor((ms - start) / 1000);
  const castRows = (u: any): any[] =>
    [...(u.castStartEvents ?? []), ...(u.spellCastEvents ?? [])].filter(
      (e) => e.logLine?.event === START || e.logLine?.event === SUCCESS,
    );

  // ── kickOnSummon ──────────────────────────────────────────────────────
  {
    const kickers = [owner, ...ownedBy(owner)];
    const interrupts = kickers.flatMap((u) =>
      ((u.actionOut ?? []) as any[]).filter(
        (a) => a.logLine?.event === INTERRUPT,
      ),
    );
    const test = (sec: number, kick: string, outcome: string, line: string) => {
      ctx.bump("kickOnSummon");
      const from = secMs(sec);
      const to = secMs(sec + 1) + INTERRUPT_TRAIL_MS;
      const hit = interrupts.find((a) => tsOf(a) >= from && tsOf(a) < to);
      if (!hit) return;
      ctx.violate(
        "kickOnSummon",
        guidType(String(hit.destUnitId ?? "")),
        tsOf(hit),
        `${hit.srcUnitId}|${tsOf(hit)}`,
        `${fmtS(sec)} ${kick} → "${outcome}", but ${hit.srcUnitName}'s ${nameOf(hit.spellId, hit.spellName)} interrupted ${hit.destUnitName}'s ${nameOf(hit.extraSpellId, hit.extraSpellName)} (+${tsOf(hit) - start}ms)`,
        line,
      );
    };
    for (const l of ctx.lines) {
      const k = KICK_OWN_RE.exec(l);
      if (k) {
        test(secOf(k[1]!), k[2]!.split(" on ")[0]!, k[3]!, l);
        continue;
      }
      const led = KICKS_LEDGER_RE.exec(l);
      if (!led) continue;
      for (const part of led[1]!.split(" | ")) {
        const e = LEDGER_ENTRY_RE.exec(part.trim());
        if (!e) continue;
        if (/^(interrupted|silenced)\b/.test(e[3]!)) continue;
        test(secOf(e[1]!), e[2]!, e[3]!.slice(0, 40), l);
      }
    }
  }

  // ── petControlTiming ──────────────────────────────────────────────────
  for (const l of ctx.lines) {
    const a = parseBurstAnsweredLine(l);
    if (!a || a.controlOn.length === 0) continue;
    const op = OPENER_RE.exec(l);
    const opener = op ? labelUnit(op[2]!) : undefined;
    const answerer = labelUnit(a.answerer);
    if (!op || !opener || !answerer) continue;
    const lead = ((opener.spellCastEvents ?? []) as any[])
      .filter(
        (c) =>
          c.logLine?.event === SUCCESS &&
          renderSec(tsOf(c)) === a.atSec &&
          nameOf(c.spellId, c.spellName) === op[1],
      )
      .map(tsOf)
      .sort((x, y) => x - y)[0];
    if (lead === undefined) continue;
    const summons = new Set(ownedBy(answerer).map((u) => u.id));
    const landings: Array<{ src: any; ms: number }> = [];
    for (const on of a.controlOn) {
      const t = labelUnit(on.target);
      for (const e of (t?.auraEvents ?? []) as any[]) {
        const evn = e.logLine?.event;
        if (evn !== "SPELL_AURA_APPLIED" && evn !== "SPELL_AURA_REFRESH")
          continue;
        if (!summons.has(e.srcUnitId)) continue;
        if (nameOf(e.spellId, e.spellName) !== a.spellName) continue;
        const ms = tsOf(e);
        if (ms < lead - CONTROL_LOOKBACK_MS || ms > lead + 20_000) continue;
        landings.push({ src: unitById.get(e.srcUnitId), ms });
      }
    }
    if (landings.length === 0) continue; // a player's own control: out of class
    ctx.bump("petControlTiming");
    const named = (c: any) => nameOf(c.spellId, c.spellName) === a.spellName;
    const truths = landings.map((g) => {
      const inFuse = (c: any) =>
        tsOf(c) <= g.ms && tsOf(c) >= g.ms - CONTROL_LOOKBACK_MS;
      const press = ((answerer.spellCastEvents ?? []) as any[])
        .filter((c) => c.logLine?.event === SUCCESS && named(c) && inFuse(c))
        .map(tsOf)
        .sort((x, y) => y - x)[0];
      const own = ((g.src?.spellCastEvents ?? []) as any[])
        .filter((c) => c.logLine?.event === SUCCESS && named(c) && inFuse(c))
        .map(tsOf)
        .sort((x, y) => y - x)[0];
      const at = press ?? own ?? g.ms;
      return {
        g,
        at,
        lat: Math.round(((at - lead) / 1000 + Number.EPSILON) * 10) / 10,
      };
    });
    if (truths.some((x) => Math.abs(x.lat - a.latencySec) <= 0.1 + 1e-9))
      continue;
    const best = truths[0]!;
    ctx.violate(
      "petControlTiming",
      String(best.g.src?.id ?? "").startsWith("Pet-")
        ? "petAura"
        : "summonAura",
      best.g.ms,
      `${best.g.src?.id}|${best.g.ms}|${lead}`,
      `${a.answerer} ${a.spellName}: rendered ${a.latencySec}s, log ${best.lat}s (lead ${op[1]} +${lead - start}ms, ${best.g.src?.name} aura +${best.g.ms - start}ms, timed at +${best.at - start}ms)`,
      l,
    );
  }

  // ── petKillCredit ─────────────────────────────────────────────────────
  {
    const partyKill = new Map<string, string>();
    for (const r of ctx.rawLines) {
      const i = r.indexOf("  PARTY_KILL,");
      if (i < 0) continue;
      const f = r.slice(i + 2).split(",");
      if (f[1] && f[5]) partyKill.set(f[5], f[1]);
    }
    if (ctx.firstOwnerOfRound) partyKillRows += partyKill.size;
    const killMs = (u: any): number => {
      const ok = ((u.damageIn ?? []) as any[])
        .filter((d) => (d.overkill ?? 0) > 0)
        .map(tsOf);
      const died = ((u.deathRecords ?? []) as any[]).map((d) => d.timestamp);
      return Math.min(Infinity, ...ok, ...died);
    };
    if (ctx.firstOwnerOfRound)
      for (const u of units)
        splitOverkillRows += ((u.damageIn ?? []) as any[]).filter(
          (d) => d.logLine?.event === DAMAGE_SPLIT && (d.overkill ?? 0) > 0,
        ).length;
    const sideOf = (u: any): number | undefined =>
      u?.info ? u.reaction : playerOf(u?.id)?.reaction;
    const judge = (sec: number, victim: any, credits: string, line: string) => {
      ctx.bump("petKillCredit");
      const parsed = [...credits.matchAll(CREDIT_RE)].map((m) => ({
        label: m[1]!.trim(),
        spell: m[2]!.trim(),
        amount: m[3],
      }));
      if (parsed.length === 0) return;
      const vSide = sideOf(victim);
      const why: string[] = [];
      let kind = "";
      for (const c of parsed) {
        if (/\(own\)/.test(c.spell) || c.label.includes("(own)")) continue;
        const cu = labelUnit(c.label);
        if (!cu) continue;
        const split = ((victim.damageIn ?? []) as any[]).some(
          (d) =>
            d.logLine?.event === DAMAGE_SPLIT &&
            playerOf(d.srcUnitId)?.id === cu.id &&
            nameOf(d.spellId, d.spellName) === c.spell,
        );
        if (split) {
          kind ||= "splitCredited";
          why.push(
            `${c.label} — ${c.spell} is a DAMAGE_SPLIT row (link holder)`,
          );
        }
        // F20 wide residual: a player's own self-damage tick is a real
        // blow (a Fire Mage's Cauterize burn, UNIT_DIED +0 / +28 ms after it,
        // 7344daaf / 6f35784a) — the gate's exemption, `checkKillCreditNotOwnSide`
        if (cu.id === victim.id) continue;
        if (vSide !== undefined && cu.reaction === vSide) {
          kind ||= "sameSideCredit";
          why.push(`${c.label} is on ${victim.name}'s own side`);
        }
      }
      const first = parsed[0]!;
      const pk = partyKill.get(victim.id);
      const credited = labelUnit(first.label);
      if (pk && parsed.length === 1 && !first.amount && credited) {
        const truth = playerOf(pk);
        // F20 wide residual: PARTY_KILL itself credits the source of a
        // transfer row — a pet's Roar of Sacrifice holder, the victim's own
        // side (343888ac r3 2:18, 1ec8070b r3 1:46, ef085806 r5 2:14); it is
        // no truth about the attacker then
        const pkSameSide =
          truth !== undefined &&
          vSide !== undefined &&
          truth.reaction === vSide &&
          truth.id !== victim.id;
        if (truth && truth.id !== credited.id && !pkSameSide) {
          kind ||= "partyKillMismatch";
          why.push(`PARTY_KILL credits ${truth.name}`);
        }
      }
      if (!kind) return;
      ctx.violate(
        "petKillCredit",
        kind,
        secMs(sec),
        `${victim.id}`,
        `${fmtS(sec)} ${victim.name}: ${why.join("; ")}`,
        line,
      );
    };
    for (const l of ctx.lines) {
      const k = KILL_RE.exec(l);
      if (k) {
        const v = labelUnit(k[2]!);
        if (v) judge(secOf(k[1]!), v, k[3]!, l);
        continue;
      }
      const d = UNIT_DESTROYED_RE.exec(l);
      if (!d) continue;
      const sec = secOf(d[1]!);
      const ownerLabel = new RegExp(String.raw`^(${LABEL})'s `).exec(
        d[2]!,
      )?.[1];
      const ownerU = ownerLabel ? labelUnit(ownerLabel) : undefined;
      const want =
        d[3] === "Unknown"
          ? undefined
          : d[3] === "Friendly"
            ? owner.reaction
            : -1;
      const cands = units.filter((u) => {
        if (u.info) return false;
        if (ownerU && u.ownerId !== ownerU.id) return false;
        const k2 = killMs(u);
        if (!Number.isFinite(k2) || renderSec(k2) !== sec) return false;
        const s = sideOf(u) ?? u.reaction;
        if (want === undefined) return true;
        return want === -1 ? s !== owner.reaction : s === want;
      });
      if (cands.length !== 1) continue;
      judge(sec, cands[0], d[4]!, l);
    }
  }

  // ── commandDouble ─────────────────────────────────────────────────────
  {
    type Seen = {
      tag: string;
      sec: number;
      target: string;
      spell: string;
      by: string;
      line: string;
    };
    const seen: Seen[] = [];
    for (const l of ctx.lines) {
      let m: RegExpExecArray | null;
      if ((m = CC_NOT_LANDED_RE.exec(l)))
        seen.push({
          tag: "[CC NOT LANDED]",
          sec: secOf(m[1]!),
          target: m[2]!,
          spell: m[3]!,
          by: m[4]!,
          line: l,
        });
      else if ((m = CC_AVOIDED_RE.exec(l)))
        seen.push({
          tag: "[CC AVOIDED?]",
          sec: secOf(m[1]!),
          target: m[2]!,
          spell: m[3]!,
          by: m[4]!,
          line: l,
        });
      else if ((m = KICK_IMMUNE_RE.exec(l)))
        seen.push({
          tag: "[KICK] IMMUNE",
          sec: secOf(m[1]!),
          target: m[4]!,
          spell: m[3]!,
          by: m[2]!,
          line: l,
        });
      else if ((m = REFLECTED_RE.exec(l)))
        seen.push({
          tag: "[REFLECTED]",
          sec: secOf(m[1]!),
          target: m[4]!,
          spell: m[3]!,
          by: m[2]!,
          line: l,
        });
    }
    for (const p of ctx.players) {
      const pets = ownedBy(p).filter((u) => String(u.id).startsWith("Pet-"));
      if (pets.length === 0) continue;
      const petRows = pets.flatMap((u) =>
        castRows(u).map((e) => ({
          u,
          e,
          name: nameOf(e.spellId, e.spellName),
        })),
      );
      const attempts = new Map<
        string,
        { name: string; from: number; to: number }
      >();
      for (const e of castRows(p)) {
        const name = nameOf(e.spellId, e.spellName);
        const ms = tsOf(e);
        if (
          !petRows.some(
            (r) =>
              r.name === name && Math.abs(tsOf(r.e) - ms) <= COMMAND_PAIR_MS,
          )
        )
          continue;
        const done = petRows
          .filter(
            (r) =>
              r.name === name &&
              r.e.logLine?.event === SUCCESS &&
              tsOf(r.e) >= ms - COMMAND_PAIR_MS &&
              tsOf(r.e) <= ms + 5000,
          )
          .map((r) => tsOf(r.e))
          .sort((x, y) => x - y)[0];
        const end = done ?? ms + 1500;
        const key = `${name}|${end}`;
        const a = attempts.get(key);
        if (a) a.from = Math.min(a.from, ms);
        else attempts.set(key, { name, from: ms, to: end + 1000 });
      }
      if (ctx.firstOwnerOfRound) commandPairs += attempts.size;
      const pid = ctx.pidOf(p.name);
      if (!pid) continue;
      for (const at of attempts.values()) {
        const lo = renderSec(at.from);
        const hi = renderSec(at.to);
        const mine = seen.filter(
          (s) =>
            s.spell === at.name &&
            pidOfLabel(s.by) === pid &&
            s.sec >= lo &&
            s.sec <= hi,
        );
        if (mine.length === 0) continue;
        ctx.bump("commandDouble");
        const groups = new Map<string, Seen[]>();
        for (const s of mine) {
          const k = `${s.tag}|${s.target}`;
          groups.set(k, [...(groups.get(k) ?? []), s]);
        }
        for (const [k, g] of groups) {
          if (g.length < 2) continue;
          ctx.violate(
            "commandDouble",
            g[0]!.tag,
            at.from,
            `${p.id}|${at.name}|${at.from}|${k}`,
            `${p.name}'s ${at.name} command (+${at.from - start}ms) printed ${g.length}×: ${g.map((s) => `${fmtS(s.sec)} by ${s.by}`).join(" / ")}`,
            g.map((s) => s.line.trim()).join(" ‖ "),
          );
        }
      }
    }
  }
}

export function report(): string[] {
  return [
    `pets inventory: command attempts (player press + its pet's same-named row ≤ ${COMMAND_PAIR_MS} ms) ${commandPairs}; PARTY_KILL rows ${partyKillRows}; DAMAGE_SPLIT rows with overkill ${splitOverkillRows}`,
  ];
}
