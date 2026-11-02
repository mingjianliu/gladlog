/**
 * pressTalentCatalog.ts — GH #176 groundwork (user 2026-11-02): before an
 * off-list cooldown press gets a printed line with its cooldown, every talent
 * that changes that cooldown, its charges or its duration has to be known.
 * 「我希望你把所有天赋的时间、持续时间、缩短这些东西先算清楚，把这些都弄明白了，
 * 再去把它打印出来」.
 *
 * For each target spell (the `offList` rows of scan5 `listGapPress`'s ranked
 * report at or above `--min-cd`, or `--ids`), two legs side by side:
 *  - MODELLED: what the cooldown model already applies — `CD_TALENT_MODIFIERS`
 *    (DB2 class mask / label / category rows, spec passives, per-rank and
 *    per-spec points), the scripted tables (`EVENT_COOLDOWN_REDUCTIONS`,
 *    resets included; `ON_INTERRUPT_COOLDOWN_REDUCTIONS`;
 *    `IDLE_COOLDOWN_CREDITS`; `FREE_RECAST_WINDOWS`), the generated
 *    conditional rows, `CORPUS_COOLDOWN_PATCHES`, `DATED_COOLDOWN_VALUES`;
 *    and for the duration `BUFF_DURATION_TALENT_MODIFIERS`,
 *    `TOOLTIP_DURATION_ROWS`, `CORPUS_DURATION_PATCHES`.
 *  - TOOLTIP: every talent (class / spec / hero tree, PvP pool) and every
 *    spec passive (SpecializationSpells of the specs seen casting it) whose
 *    zhCN tooltip names the spell in a sentence about its cooldown, charges,
 *    duration or a reset — placeholders resolved per spec
 *    (`expandForSpec` / `evalAmount`, the duration reader's helpers).
 * A tooltip talent no modelled row names is printed `UNMODELLED`: the work
 * list. The corpus leg is `cooldownRecastScan.ts` (impossible presses = the
 * model too long; the smallest recast ratio = too short) and
 * `talentDurationVerify.ts` / `buffDurationScan.ts` for durations.
 *
 * Usage:
 *   DATAGEN_CACHE=~/.cache/gladlog-datagen npx tsx packages/eval/scripts/pressTalentCatalog.ts \
 *     --report <scan dir>/corpusFactScan5.txt [--min-cd 45] [--ids a,b] --out <file.json> > catalog.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { pvpBasePoints } from "@gladlog/analysis/scripts/datagen/lib/pvpMultiplier";
import {
  evalAmount,
  expandForSpec,
} from "@gladlog/analysis/scripts/datagen/lib/tooltipDurations";
import {
  fetchTable,
  parseCsv,
  resolveBuild,
} from "@gladlog/analysis/scripts/datagen/lib/wagoCsv";
import { effectAurasOfCast } from "@gladlog/analysis/src/data/castEffectAuras";
import conditionalCooldowns from "@gladlog/analysis/src/data/conditionalCooldownsGenerated.json";
import { PVP_TALENT_POOL_GENERATED } from "@gladlog/analysis/src/data/pvpTalentPoolGenerated";
import {
  BUFF_DURATION_TALENT_MODIFIERS,
  effectiveCooldownSeconds,
  spellEffectData,
} from "@gladlog/analysis/src/data/spellEffectData";
import {
  CORPUS_COOLDOWN_PATCHES,
  CORPUS_DURATION_PATCHES,
} from "@gladlog/analysis/src/data/spellEffectOverrides";
import {
  TOOLTIP_DURATION_ROWS,
  TOOLTIP_PER_EVENT_DURATIONS,
} from "@gladlog/analysis/src/data/talentDurationTooltips";
import talentIdMap from "@gladlog/analysis/src/data/talentIdMap.json";
import {
  EVENT_COOLDOWN_REDUCTIONS,
  eventReductionOwner,
  FREE_RECAST_WINDOWS,
  IDLE_COOLDOWN_CREDITS,
  ON_INTERRUPT_COOLDOWN_REDUCTIONS,
} from "@gladlog/analysis/src/data/talentScriptedCooldowns";
import {
  CD_TALENT_MODIFIERS,
  DATED_COOLDOWN_VALUES,
} from "@gladlog/analysis/src/utils/talentModifiers";

const argOf = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const REPORT = argOf("--report");
const MIN_CD = Number(argOf("--min-cd") ?? "45");
const IDS = argOf("--ids");
const OUT = argOf("--out");

/** what a sentence changes about the spell named just before it: up to the
 * first verb 「使」 or clause break, its cooldown, charges or duration */
const ABOUT_AFTER_NAME_RE =
  /^[^使，。；]{0,16}?(?:冷却时间|剩余冷却|充能|持续时间(?:延长|增加|提高|缩短|降低|减少)|时间延长|延迟效果)/;

/** Does `sentence` change `name`'s cooldown, charges or duration — the
 * keyword after one of its mentions, or a reset that names it? */
function aboutSpell(sentence: string, name: string): boolean {
  if (sentence.includes("重置") && sentence.includes(name)) return true;
  for (let i = sentence.indexOf(name); i >= 0; i = sentence.indexOf(name, i + 1))
    if (ABOUT_AFTER_NAME_RE.test(sentence.slice(i + name.length))) return true;
  return false;
}

interface ITarget {
  id: string;
  name: string;
  cd: number;
  rounds: number;
  casts: number;
  specs: string[];
}

/** `listGapPress ranked ids` rows: rounds casts id name [cd] specs kinds */
function targetsFromReport(path: string): ITarget[] {
  const text = readFileSync(path, "utf8");
  const at = text.indexOf("listGapPress ranked ids");
  if (at < 0) throw new Error(`${path}: no listGapPress ranked report`);
  const out: ITarget[] = [];
  for (const line of text.slice(at).split("\n").slice(1)) {
    const m = /^\s+(\d+) (\d+) (\d+) (.+?) \[(\d+)s\] (\S+) (.*)$/.exec(line);
    if (!m) break;
    if (!m[7]!.includes("offList")) continue;
    out.push({
      rounds: +m[1]!,
      casts: +m[2]!,
      id: m[3]!,
      name: m[4]!,
      cd: +m[5]!,
      specs: m[6]!.split(",").map((s) => s.split("×")[0]!),
    });
  }
  return out;
}

async function main(): Promise<void> {
  let targets = REPORT ? targetsFromReport(REPORT) : [];
  if (IDS) {
    const want = new Set(IDS.split(","));
    targets = targets.length
      ? targets.filter((t) => want.has(t.id))
      : [...want].map((id) => ({
          id,
          name: spellEffectData[id]?.name ?? id,
          cd: effectiveCooldownSeconds(id) ?? 0,
          rounds: 0,
          casts: 0,
          specs: [],
        }));
  } else targets = targets.filter((t) => t.cd >= MIN_CD);

  const build = await resolveBuild();
  const cache =
    process.env.DATAGEN_CACHE ?? join(homedir(), ".cache/gladlog-datagen");
  const [spellZh, nameZh, nameEn, effectRaw, miscRaw, durRaw, specSpellsRaw] =
    await Promise.all([
      fetchTable("Spell", build, cache, "zhCN"),
      fetchTable("SpellName", build, cache, "zhCN"),
      fetchTable("SpellName", build, cache),
      fetchTable("SpellEffect", build, cache),
      fetchTable("SpellMisc", build, cache),
      fetchTable("SpellDuration", build, cache),
      fetchTable("SpecializationSpells", build, cache),
    ]);
  const descriptionOf = new Map(
    parseCsv(spellZh).rows.map((r) => [r.ID ?? "", r.Description_lang ?? ""]),
  );
  const zhName = new Map(
    parseCsv(nameZh).rows.map((r) => [r.ID ?? "", (r.Name_lang ?? "").trim()]),
  );
  const enName = new Map(
    parseCsv(nameEn).rows.map((r) => [r.ID ?? "", (r.Name_lang ?? "").trim()]),
  );
  const pointsOf = new Map<string, number>();
  for (const r of parseCsv(effectRaw).rows) {
    if (r.DifficultyID !== "0") continue;
    pointsOf.set(`${r.SpellID}:${r.EffectIndex}`, pvpBasePoints(r));
  }
  const durationMsOfIndex = new Map<string, number>();
  for (const r of parseCsv(durRaw).rows)
    durationMsOfIndex.set(r.ID!, Number(r.Duration));
  const durationS = new Map<string, number>();
  for (const r of parseCsv(miscRaw).rows) {
    if (r.DifficultyID !== "0") continue;
    const ms = durationMsOfIndex.get(r.DurationIndex ?? "") ?? 0;
    if (ms > 0) durationS.set(r.SpellID!, ms / 1000);
  }
  const specSpells = new Map<string, string[]>();
  const passivesOfSpec = new Map<string, string[]>();
  for (const r of parseCsv(specSpellsRaw).rows) {
    const l = specSpells.get(r.SpellID!) ?? [];
    l.push(r.SpecID!);
    specSpells.set(r.SpellID!, l);
    const p = passivesOfSpec.get(r.SpecID!) ?? [];
    p.push(r.SpellID!);
    passivesOfSpec.set(r.SpecID!, p);
  }

  // the talent universe: tree entries with the specs that can take them, the
  // PvP pool; the index of a spec in its class (the tooltips' `$?cN`)
  const specsOfTalent = new Map<string, Set<string>>();
  const specIndexOf = new Map<string, number>();
  const classSpecs = new Map<number, string[]>();
  for (const tree of talentIdMap as Array<Record<string, unknown>>) {
    const specId = String(tree.specId);
    const classId = Number(tree.classId);
    const l = classSpecs.get(classId) ?? [];
    if (!l.includes(specId)) l.push(specId);
    classSpecs.set(classId, l);
    for (const g of ["classNodes", "specNodes", "heroNodes"])
      for (const node of (tree[g] as Array<{
        entries?: Array<{ spellId?: number }>;
      }>) ?? [])
        for (const e of node.entries ?? []) {
          if (!e.spellId) continue;
          const s = specsOfTalent.get(String(e.spellId)) ?? new Set<string>();
          s.add(specId);
          specsOfTalent.set(String(e.spellId), s);
        }
  }
  for (const l of classSpecs.values())
    l.sort((a, b) => +a - +b).forEach((s, i) => specIndexOf.set(s, i));
  for (const [specId, granted] of Object.entries(PVP_TALENT_POOL_GENERATED))
    for (const id of Object.keys(granted)) {
      const s = specsOfTalent.get(id) ?? new Set<string>();
      s.add(specId);
      specsOfTalent.set(id, s);
    }

  const ctxOf = (spellId: string) => ({
    spellId,
    points: (id: string, n: number) => pointsOf.get(`${id}:${n}`),
    durationS: (id: string) => durationS.get(id),
  });
  /** a tooltip as one spec reads it, spell names in, numbers resolved */
  const render = (talentId: string, specId: string): string => {
    let text = descriptionOf.get(talentId) ?? "";
    text = text.replace(
      /\$@spelldesc(\d+)/g,
      (_m, id: string) => descriptionOf.get(id) ?? "",
    );
    text = text.replace(
      /\$@spellname(\d+)/g,
      (_m, id: string) => zhName.get(id) ?? `#${id}`,
    );
    const idx = specIndexOf.get(specId) ?? -1;
    text = expandForSpec(text, idx, specId, (id) => specSpells.get(id)).text;
    const ctx = ctxOf(talentId);
    text = text.replace(
      /\$\{[^}]*\}(?:\.\d)?|\$(\d+)?[sSmM]\d+|\$(\d+)?d\b/g,
      (tok) => {
        const v = evalAmount(tok, ctx);
        if (v === undefined) return tok;
        const ms = /^\$(\d+)?[sSmM]\d+$/.test(tok) && Math.abs(v) >= 1000;
        const n = ms ? v / 1000 : v;
        return String(Math.round(Math.abs(n) * 100) / 100);
      },
    );
    return text.replace(/\|c[0-9a-fA-F]{8}|\|r|\r/g, "");
  };

  const lines: string[] = [];
  const records: unknown[] = [];
  for (const t of targets) {
    const zh = zhName.get(t.id) ?? "";
    const en = enName.get(t.id) ?? t.name;
    const fx = spellEffectData[t.id];
    const modelled = new Map<string, string>();
    for (const m of CD_TALENT_MODIFIERS[t.id] ?? [])
      modelled.set(
        m.talentSpellId,
        `${m.effect} ${m.value}${m.valueByRank ? ` byRank ${m.valueByRank.join("/")}` : ""}${m.valueBySpec ? ` bySpec ${JSON.stringify(m.valueBySpec)}` : ""}${m.specIds ? ` spec passive ${m.specIds.join("/")}` : ""}${m.onlySpecIds ? ` only ${m.onlySpecIds.join("/")}` : ""}${m.isConditional ? " conditional" : ""}`,
      );
    for (const [key, r] of Object.entries(EVENT_COOLDOWN_REDUCTIONS))
      if (r.targets.includes(t.id))
        modelled.set(eventReductionOwner(key, r), `event: ${r.note}`);
    for (const [talent, r] of Object.entries(ON_INTERRUPT_COOLDOWN_REDUCTIONS))
      if (r.spellId === t.id) modelled.set(talent, `on interrupt: ${r.note}`);
    for (const [talent, r] of Object.entries(IDLE_COOLDOWN_CREDITS))
      if (r.targets.includes(t.id)) modelled.set(talent, `idle: ${r.note}`);
    for (const [talent, r] of Object.entries(FREE_RECAST_WINDOWS))
      if (r.spellId === t.id) modelled.set(talent, `free recast: ${r.note}`);
    for (const c of (
      conditionalCooldowns as {
        byTarget: Record<string, Array<{ carrier: string }>>;
      }
    ).byTarget[t.id] ?? [])
      modelled.set(c.carrier, `conditional: ${JSON.stringify(c)}`);
    // the duration lives on the cast's own aura when its id differs (Divine
    // Steed 190784 runs as 221883 and seven mount-model variants)
    const durIds = [t.id, ...effectAurasOfCast(t.id).filter((a) => a !== t.id)];
    const durationRows: string[] = [];
    for (const id of durIds) {
      const at = id === t.id ? "" : ` on ${id}`;
      for (const r of BUFF_DURATION_TALENT_MODIFIERS[id] ?? []) {
        durationRows.push(`hand${at} ${JSON.stringify(r)}`);
        const owner = (r as { talentSpellId?: string }).talentSpellId;
        if (owner) modelled.set(owner, `duration hand row${at}`);
      }
      for (const r of TOOLTIP_DURATION_ROWS[id] ?? []) {
        durationRows.push(`tooltip${at} ${JSON.stringify(r)}`);
        modelled.set(r.talentSpellId, `duration tooltip row${at}`);
      }
      const perEvent = TOOLTIP_PER_EVENT_DURATIONS[id];
      if (perEvent) {
        modelled.set(perEvent.talentSpellId, `duration per-event row${at}`);
        durationRows.push(`per-event${at} ${JSON.stringify(perEvent)}`);
      }
    }

    // tooltip leg: talents of the specs that cast it, and those specs' passives
    const specs = new Set(t.specs);
    const sources: Array<{ id: string; specs: string[]; passive: boolean }> =
      [];
    for (const [id, s] of specsOfTalent) {
      const mine = [...s].filter((x) => specs.size === 0 || specs.has(x));
      if (mine.length) sources.push({ id, specs: mine, passive: false });
    }
    for (const spec of specs)
      for (const id of passivesOfSpec.get(spec) ?? [])
        if (id !== t.id) {
          const prev = sources.find((x) => x.id === id && x.passive);
          if (prev) prev.specs.push(spec);
          else sources.push({ id, specs: [spec], passive: true });
        }
    const mentions: Array<{
      talentId: string;
      talent: string;
      specs: string[];
      passive: boolean;
      sentence: string;
      modelled?: string;
    }> = [];
    if (zh)
      for (const src of sources) {
        const raw = descriptionOf.get(src.id) ?? "";
        if (!raw.includes(zh) && !raw.includes(t.id)) continue;
        const seen = new Map<string, string[]>();
        for (const spec of src.specs) {
          for (const s of render(src.id, spec).split(/(?<=[。！])/)) {
            if (!aboutSpell(s, zh)) continue;
            const k = s.trim();
            seen.set(k, [...(seen.get(k) ?? []), spec]);
          }
        }
        for (const [sentence, sp] of seen)
          mentions.push({
            talentId: src.id,
            talent: enName.get(src.id) ?? src.id,
            specs: sp,
            passive: src.passive,
            sentence,
            modelled: modelled.get(src.id),
          });
      }
    const unmodelled = mentions.filter((m) => !m.modelled);
    records.push({
      ...t,
      en,
      zh,
      db2: {
        cooldownSeconds: fx?.cooldownSeconds,
        charges: fx?.charges,
        effective: effectiveCooldownSeconds(t.id),
        durationSeconds: fx?.durationSeconds,
      },
      corpusCooldownPatch: CORPUS_COOLDOWN_PATCHES[t.id],
      datedCooldown: DATED_COOLDOWN_VALUES[t.id],
      corpusDurationPatch: CORPUS_DURATION_PATCHES[t.id],
      modelled: Object.fromEntries(modelled),
      durationRows,
      mentions,
    });
    lines.push(
      `${t.id} ${en} / ${zh} — base cd ${effectiveCooldownSeconds(t.id) ?? "?"}s${fx?.charges?.charges && fx.charges.charges > 1 ? ` ×${fx.charges.charges}` : ""}, duration ${fx?.durationSeconds ?? "-"}s; ${t.rounds} rounds ${t.casts} casts; specs ${t.specs.join(",")}`,
    );
    if (CORPUS_COOLDOWN_PATCHES[t.id])
      lines.push(
        `    corpus cd patch ${JSON.stringify(CORPUS_COOLDOWN_PATCHES[t.id])}`,
      );
    if (DATED_COOLDOWN_VALUES[t.id])
      lines.push(`    dated ${JSON.stringify(DATED_COOLDOWN_VALUES[t.id])}`);
    if (CORPUS_DURATION_PATCHES[t.id] !== undefined)
      lines.push(`    corpus duration patch ${CORPUS_DURATION_PATCHES[t.id]}s`);
    for (const [talent, what] of modelled)
      lines.push(`    modelled ${talent} ${enName.get(talent) ?? ""}: ${what}`);
    for (const r of durationRows) lines.push(`    duration ${r}`);
    for (const m of mentions)
      lines.push(
        `    ${m.modelled ? "tooltip " : "UNMODELLED"} ${m.talentId} ${m.talent}${m.passive ? " (spec passive)" : ""} [${m.specs.join(",")}]: ${m.sentence}`,
      );
    if (!mentions.length && !modelled.size)
      lines.push("    (no talent names it)");
    else if (unmodelled.length === 0)
      lines.push("    all tooltip talents modelled");
  }
  if (OUT) writeFileSync(OUT, JSON.stringify(records, null, 1));
  console.log(lines.join("\n"));
}

void main();
