/**
 * ownShieldLinkScan.ts — which own absorb shields a press put up, for the
 * kill windows' `defenseless` reading (fact6 F20, user ruling 1 2026-10-28:
 * "a press-triggered own shield counts — the Power Word: Shield family incl.
 * Unfolding Vision by DB2 mask, and talent shields that ride a press (Chi
 * Cocoon …), DB2-nominated, corpus ≥ 90 % right after an own press; passive
 * ones (Divine Aegis, Soul Leech, Fel Armor, Angelic Bulwark …) and deferral
 * shields (Stretch Time) do not").
 *
 * Two legs, written to `packages/analysis/src/data/ownShieldLinksGenerated.json`:
 *
 *  1. `rulingFamily` — DB2 only. Ruling (1) of 2026-10-21 names Power Word:
 *     Shield 17 and Void Shield 1253593; their family is every spell in the
 *     same `SpellClassOptions.SpellClassSet` whose class mask shares a bit
 *     with a seed's, that DB2 calls an absorb (`abilityEffectsGenerated`).
 *     Build 12.1.5.70391: {17, 1246768, 1253593, 1300008, 1300009} — Holy's
 *     proc PW:S and Unfolding Vision's two copies (set 6, mask [1,0,0,0]),
 *     the same five every talent row that masks PW:S targets
 *     (`talentEffectInventoryGenerated.json`, 17 of 17 rows).
 *
 *  2. `riders` — DB2 nominates, the corpus chooses (the castEffectAuraScan
 *     split). Nominee: an aura DB2 calls an absorb, of a class — its own
 *     `SpellClassSet`, or with no SpellClassOptions row (a talent's aura:
 *     Purification 196440) the set of the class presses it most often goes
 *     up beside; an item's or a race's proc beside scattered presses
 *     (Worldsoul Cradle 1242003) finds no carrier in that set. DB2 has no
 *     cast → aura chain for these (Chi
 *     Cocoon 406220 rides Invoke Chi-Ji through Celestial Harmony's dummy
 *     aura, 1260681 rides Enveloping Mist through Spiritfont's script), so
 *     the press is read from raw logs, one pass, per round
 *     (`ARENA_MATCH_START` resets): every SPELL_AURA_APPLIED of a nominee a
 *     player put on itself is an application; it is WITH A PRESS when the
 *     same player has a SPELL_CAST_SUCCESS of a spell of the aura's own
 *     class set within ±`LAG_MS` (`AURA_BEFORE_CAST_ROW_MAX_MS`: the aura
 *     can be logged before its cast row). An aura is a rider when it has
 *     ≥ `MIN_APPS` applications, ≥ `MIN_SHARE` of them with a press of
 *     ANOTHER spell — counted over the applications whose holder logged a
 *     cast of one of its carrying presses this round at all (a holder whose
 *     carrier writes no cast row is no evidence either way: the Devourer's
 *     Shift) — (its own id / name is already the E6 press link: Void
 *     Shield is pressed as itself, its 7 % Mind Blast neighbours are no
 *     carrier), or ≥ `MIN_SHARE` with a press of another spell or of
 *     itself and ≥ `MIN_OTHER_SHARE_WITH_OWN` by another spell (Reversion
 *     367364: Merithra's Blessing 1256581 on 86 %, its own Reversion
 *     press on the rest — F20 wide residual, 2026-10-29), its holder took damage of its own under its name in no
 *     more than `MAX_DEFERRAL_SHARE` of them (a deferral — Stretch Time
 *     410355 hands the damage back as 413924 "Stretch Time"), and it
 *     absorbed for its holder on ≥ `MIN_ABSORBED_SHARE` of them (no shield
 *     at all — Glimpse's 20 % damage reduction never absorbs).
 *     Its casts: every other-spell press within the window on ≥
 *     `MIN_CAST_SHARE` of its applications.
 *     Fact6 15 rounds (whole matches): Chi Cocoon 406220 12/12 with Invoke
 *     Chi-Ji, 1260681 24/24 with Enveloping Mist, Glimpse 86/86 Vengeful
 *     Retreat, Matted Fur 24/24 Barkskin; the passive procs sit far below —
 *     Divine Aegis 59 %, First In Last Out 63 %, Soul Leech 16 %.
 *     605 files (fix/residual/absorb, 2026-10-28, 90 %): 14 riders — the 15
 *     rounds' six bar Glimpse, plus Lesser Bulwark, Seraphic Barrier,
 *     Deflecting Dance, Niuzao's Protection, Chi Cocoon 406139 (Invoke
 *     Yu'lon), Purification, First In, Last Out (Fel Rush: 1,332 / 1,332
 *     over the holders who logged one; 204 Devourer applications with no
 *     Shift row are out of the rate) and Ice Barrier (the fire mage's small
 *     one with Blazing Barrier, 99 % over 365; the frost mage presses it
 *     as itself); below: Cloaked in Shadows 78 %, Strength of the Black Ox
 *     75 %, Divine Aegis 71 %.
 *
 * Usage:
 *   npx tsx packages/eval/scripts/ownShieldLinkScan.ts --manifest <file of raw log paths> [--every N] [--build B] [--emit] [--note <text>]
 *   DATAGEN_CACHE (default ~/.cache/gladlog-datagen) is the DB2 table cache.
 * The threshold is meant to be chosen on the 605 + wide captures
 * (`corpusFactScan5` absorb module's `report()` prints the same inventory).
 */
import {
  fetchTable,
  parseCsv,
} from "@gladlog/analysis/scripts/datagen/lib/wagoCsv";
import abilityEffects from "@gladlog/analysis/src/data/abilityEffectsGenerated.json";
import spellNames from "@gladlog/analysis/src/data/spellNames.json";
import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { gunzipSync } from "zlib";

const LAG_MS = 150;
const MIN_APPS = 10;
const MIN_SHARE = 0.9;
const MIN_CAST_SHARE = 0.05;
const MAX_DEFERRAL_SHARE = 0.5;
/** an aura pressed as itself on some applications and by another spell on
 * the rest is a rider when ≥ `MIN_SHARE` of them had either press and the
 * other spell carried at least this share — mostly carried, not an own
 * shield with a neighbour (Blazing Barrier / Void Shield 6 %, Anti-Magic
 * Shell 14 % on the 605) */
const MIN_OTHER_SHARE_WITH_OWN = 0.5;
/** a shield absorbs: an aura DB2 calls an absorb that never does is a
 * damage reduction or a trigger (Glimpse 354610's 20 %: 0 of 1,172
 * applications absorbed on the 605; Masterwork: Bulwark 0 of 794 — the
 * real riders absorb on ≥ 42 % of theirs) */
const MIN_ABSORBED_SHARE = 0.1;
const RULING_SEEDS = ["17", "1253593"];
const DATA = path.join(import.meta.dirname, "../../analysis/src/data");
const OUT = path.join(DATA, "ownShieldLinksGenerated.json");

const argOf = (f: string): string | undefined => {
  const i = process.argv.indexOf(f);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const manifest = argOf("--manifest");
if (!manifest) {
  console.error(
    "usage: ownShieldLinkScan.ts --manifest <paths> [--every N] [--build B] [--emit]",
  );
  process.exit(2);
}
const every = Number(argOf("--every") ?? 1);
const emit = process.argv.includes("--emit");
const build =
  argOf("--build") ??
  process.env.DATAGEN_BUILD ??
  (
    JSON.parse(
      readFileSync(
        path.join(DATA, "talentEffectInventoryGenerated.json"),
        "utf8",
      ),
    ) as { _meta: { build: string } }
  )._meta.build;
const cacheDir =
  process.env.DATAGEN_CACHE ??
  path.join(homedir(), ".cache", "gladlog-datagen");

const absorbs = (id: string): boolean =>
  !!(abilityEffects as Record<string, { absorbs?: boolean }>)[id]?.absorbs;
const nameOf = (id: string): string =>
  (spellNames as Record<string, string>)[id] ?? "";

// ── DB2: SpellClassOptions ──
const sco = parseCsv(await fetchTable("SpellClassOptions", build, cacheDir));
const classSet = new Map<string, number>();
const classMask = new Map<string, number[]>();
for (const r of sco.rows) {
  classSet.set(r.SpellID!, Number(r.SpellClassSet));
  classMask.set(
    r.SpellID!,
    [0, 1, 2, 3].map((i) => Number(r[`SpellClassMask_${i}`]) >>> 0),
  );
}
const rulingFamily = new Set<string>();
for (const seed of RULING_SEEDS) {
  const set = classSet.get(seed);
  const mask = classMask.get(seed);
  if (set === undefined || !mask)
    throw new Error(`no SpellClassOptions row for ${seed}`);
  rulingFamily.add(seed);
  for (const [id, m] of classMask)
    if (
      classSet.get(id) === set &&
      m.some((v, i) => (v & mask[i]!) !== 0) &&
      absorbs(id)
    )
      rulingFamily.add(id);
}

// ── corpus: applications of class-owned absorbs a player put on itself ──
/** quote-aware split of a combat-log payload, first `n` fields */
function fields(s: string, n: number): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < s.length && out.length < n; i++) {
    const c = s[i]!;
    if (q) {
      if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (out.length < n) out.push(cur);
  return out;
}
const TS = /^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)\.(\d+)/;
const tsMs = (line: string): number | null => {
  const m = TS.exec(line);
  if (!m) return null;
  const ms = Number(m[7]!.padEnd(3, "0").slice(0, 3));
  return Date.UTC(+m[3]!, +m[1]! - 1, +m[2]!, +m[4]!, +m[5]!, +m[6]!, ms);
};

/** one self-application of a nominee */
interface IApp {
  /** the holder's presses of class-owned spells within ±`LAG_MS` */
  near: string[];
  /** the holder took damage of its own under the aura's name this round */
  deferral: boolean;
  /** it absorbed for its holder (an own SPELL_ABSORBED row of the aura,
   * amount > 0, before its next application) */
  ate: boolean;
  /** every spell its holder logged a SUCCESS of this round (shared) */
  roundCasts: ReadonlySet<string>;
}
const appsByAura = new Map<string, IApp[]>();
const files = readFileSync(manifest, "utf8")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((_, i) => i % every === 0);
let read = 0;
/** every spell a player logged a SUCCESS of, anywhere in the files read */
const castIdsSeen = new Set<string>();
for (const f of files) {
  let text: string;
  try {
    const raw = readFileSync(f);
    text = (f.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8");
  } catch {
    continue;
  }
  read++;
  let presses = new Map<string, Array<{ t: number; id: string }>>();
  let apps: Array<{ who: string; aura: string; t: number; ate: boolean }> = [];
  /** the latest application of each (holder, aura), by index into `apps` */
  let lastApp = new Map<string, number>();
  let selfDamage = new Map<string, Set<string>>();
  const flush = () => {
    const castsOf = new Map<string, Set<string>>();
    for (const [who, list] of presses)
      castsOf.set(who, new Set(list.map((p) => p.id)));
    for (const { who, aura, t, ate } of apps) {
      const list = appsByAura.get(aura) ?? [];
      list.push({
        near: [
          ...new Set(
            (presses.get(who) ?? [])
              .filter(
                (p) =>
                  Math.abs(p.t - t) <= LAG_MS &&
                  (classSet.get(p.id) ?? 0) !== 0,
              )
              .map((p) => p.id),
          ),
        ],
        deferral: !!selfDamage.get(who)?.has(nameOf(aura)),
        ate,
        roundCasts: castsOf.get(who) ?? new Set(),
      });
      appsByAura.set(aura, list);
    }
    presses = new Map();
    apps = [];
    lastApp = new Map();
    selfDamage = new Map();
  };
  for (const line of text.split("\n")) {
    const sep = line.indexOf("  ");
    if (sep < 0) continue;
    const body = line.slice(sep + 2);
    if (body.startsWith("ARENA_MATCH_START")) {
      flush();
      continue;
    }
    const isCast = body.startsWith("SPELL_CAST_SUCCESS,");
    const isApp = body.startsWith("SPELL_AURA_APPLIED,");
    const isDmg =
      body.startsWith("SPELL_PERIODIC_DAMAGE,") ||
      body.startsWith("SPELL_DAMAGE,");
    if (body.startsWith("SPELL_ABSORBED,")) {
      // the attacker can be anything; the shield's caster sits after the
      // victim, behind the attack's spell triple unless it was a swing
      const fa = fields(body, 21);
      const k = /^(Player|Creature|Pet|Vehicle)-/.test(fa[9] ?? "") ? 9 : 12;
      const caster = fa[k] ?? "";
      if (caster.startsWith("Player-") && caster === fa[5]) {
        const i = lastApp.get(`${caster}|${fa[k + 4] ?? ""}`);
        if (i !== undefined && Number(fa[k + 7]) > 0) apps[i]!.ate = true;
      }
      continue;
    }
    if (!isCast && !isApp && !isDmg) continue;
    const fs = fields(body, 11);
    const src = fs[1] ?? "";
    if (!src.startsWith("Player-")) continue;
    const t = tsMs(line);
    if (t === null) continue;
    const id = fs[9] ?? "";
    if (isCast) {
      castIdsSeen.add(id);
      const list = presses.get(src) ?? [];
      list.push({ t, id });
      presses.set(src, list);
    } else if (src === fs[5]) {
      if (isDmg) {
        const s = selfDamage.get(src) ?? new Set<string>();
        s.add(fs[10] ?? "");
        selfDamage.set(src, s);
      } else if (absorbs(id)) {
        lastApp.set(`${src}|${id}`, apps.length);
        apps.push({ who: src, aura: id, t, ate: false });
      }
    }
  }
  flush();
}

const riders: Record<
  string,
  {
    name: string;
    casts: string[];
    apps: number;
    withPress: number;
    noCarrierLogged?: number;
    withPressOrItself?: number;
    castAsItself?: true;
  }
> = {};
/** the aura's class set — DB2's, or (no SpellClassOptions row: Purification
 * 196440, a talent's aura) the set of the class presses it most often goes
 * up beside; 0 (none) for an item's or a race's proc beside no class press */
const setOf = (aura: string, list: IApp[]): number => {
  const own = classSet.get(aura) ?? 0;
  if (own !== 0) return own;
  const n = new Map<number, number>();
  for (const a of list)
    for (const s of new Set(a.near.map((id) => classSet.get(id)!)))
      n.set(s, (n.get(s) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
};
const rows = [...appsByAura]
  .map(([aura, list]) => {
    const set = setOf(aura, list);
    const st = {
      apps: list.length,
      withPress: 0,
      withOther: 0,
      deferral: 0,
      absorbed: 0,
      casts: new Map<string, number>(),
    };
    for (const a of list) {
      const near = a.near.filter((id) => classSet.get(id) === set);
      if (near.length > 0) st.withPress++;
      if (near.some((id) => id !== aura && nameOf(id) !== nameOf(aura)))
        st.withOther++;
      for (const id of near) st.casts.set(id, (st.casts.get(id) ?? 0) + 1);
      if (a.deferral) st.deferral++;
      if (a.ate) st.absorbed++;
    }
    // the carrying presses, and the rate over the holders whose carrying
    // press the log shows at all this round: a holder with no logged cast
    // of any of them is no evidence either way (the Devourer's Shift, which
    // puts First In, Last Out up, writes no cast row — 32 / 204 beside a
    // press, against Havoc's 1,331 / 1,332 with Fel Rush)
    const carriers = new Set(
      [...st.casts]
        .filter(([c]) => c !== aura && nameOf(c) !== nameOf(aura))
        .filter(([, n]) => n / st.apps >= MIN_CAST_SHARE)
        .map(([c]) => c),
    );
    let eligible = 0;
    let eligibleOther = 0;
    /** with a press of another spell OR of its own id / name — the latter
     * is already the E6 link, so it is no evidence against a carrier
     * (F20 wide residual: Reversion 367364 rides Merithra's Blessing
     * 1256581 85 % and its own Reversion press 15 % on the 605 — 100 %
     * pressed, 86 % by another spell) */
    let eligiblePressed = 0;
    for (const a of list) {
      if (carriers.size > 0 && ![...carriers].some((c) => a.roundCasts.has(c)))
        continue;
      eligible++;
      const near = a.near.filter((id) => classSet.get(id) === set);
      if (near.length > 0) eligiblePressed++;
      if (near.some((id) => id !== aura && nameOf(id) !== nameOf(aura)))
        eligibleOther++;
    }
    return [aura, { ...st, eligible, eligibleOther, eligiblePressed }] as const;
  })
  .sort((a, b) => b[1].apps - a[1].apps);
for (const [aura, st] of rows) {
  const share = st.withPress / st.apps;
  const otherShare = st.eligible > 0 ? st.eligibleOther / st.eligible : 0;
  const pressedShare = st.eligible > 0 ? st.eligiblePressed / st.eligible : 0;
  const other = [...st.casts]
    .filter(([c]) => c !== aura && nameOf(c) !== nameOf(aura))
    .filter(([, n]) => n / st.apps >= MIN_CAST_SHARE)
    .sort((a, b) => b[1] - a[1]);
  const ownNamed = [...st.casts].filter(
    ([c, n]) =>
      c !== aura && nameOf(c) === nameOf(aura) && n / st.apps >= MIN_CAST_SHARE,
  );
  const isRider =
    st.eligible >= MIN_APPS &&
    other.length > 0 &&
    (otherShare >= MIN_SHARE ||
      (pressedShare >= MIN_SHARE && otherShare >= MIN_OTHER_SHARE_WITH_OWN)) &&
    st.deferral / st.apps <= MAX_DEFERRAL_SHARE &&
    st.absorbed / st.apps >= MIN_ABSORBED_SHARE;
  console.log(
    `${isRider ? "RIDER " : "      "}${nameOf(aura)} ${aura}: ${st.apps} apps, ${(share * 100).toFixed(0)}% with a press (${(otherShare * 100).toFixed(0)}% another spell's, ${(pressedShare * 100).toFixed(0)}% another's or its own, over ${st.eligible} with a carrier logged), deferral ${st.deferral}, absorbed ${((st.absorbed / st.apps) * 100).toFixed(0)}%${other.length ? ` — ${other.map(([c, n]) => `${nameOf(c)} ${c} ${((n / st.apps) * 100).toFixed(0)}%`).join(", ")}` : ""}`,
  );
  if (isRider)
    riders[aura] = {
      name: nameOf(aura),
      casts: other.map(([c]) => c),
      apps: st.eligible,
      withPress: st.eligibleOther,
      // a rider only with its own presses counted (Reversion 367364)
      ...(otherShare < MIN_SHARE
        ? { withPressOrItself: st.eligiblePressed }
        : {}),
      ...(st.eligible < st.apps
        ? { noCarrierLogged: st.apps - st.eligible }
        : {}),
      // the aura's own id is a press players log (Ice Barrier 11426), or a
      // cast of its name put it up beside ≥ MIN_CAST_SHARE of its
      // applications (Reversion's press 366155 for its shield 367364, codex
      // F20-25 — not Power Word: Shield 17 beside Prayer of Mending's
      // 1246768): a holder without a carrier cast pressed it as itself, or
      // got it some other way — its application cannot stand for an
      // unlogged carrier
      ...(castIdsSeen.has(aura) || ownNamed.length > 0
        ? { castAsItself: true as const }
        : {}),
    };
}
console.log(
  `files read ${read}; ruling family ${[...rulingFamily].join(", ")}; riders ${Object.keys(riders).length}`,
);
if (emit) {
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        meta: {
          producer: "packages/eval/scripts/ownShieldLinkScan.ts",
          build,
          manifest: path.basename(manifest),
          filesRead: read,
          ...(argOf("--note") ? { note: argOf("--note") } : {}),
          rule: `rulingFamily = SpellClassOptions set + mask bit shared with ${RULING_SEEDS.join("/")}, DB2 absorbs; riders = DB2 absorbs with a class set, ≥ ${MIN_APPS} self-applications, ≥ ${MIN_SHARE} of them (over the holders that logged a carrying cast that round) within ±${LAG_MS} ms of an own SUCCESS of another spell of the same class set (or of it or itself, another spell's on ≥ ${MIN_OTHER_SHARE_WITH_OWN}), deferral share ≤ ${MAX_DEFERRAL_SHARE}, absorbing on ≥ ${MIN_ABSORBED_SHARE} of them, carried by another spell's press (casts ≥ ${MIN_CAST_SHARE} of applications)`,
          generatedAt: new Date().toISOString(),
        },
        rulingFamily: [...rulingFamily].sort((a, b) => Number(a) - Number(b)),
        riders,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote ${OUT}`);
}
