#!/usr/bin/env python3
"""Negative control for the mapper: does it recognise events it SHOULD recognise?

The corpus reports "71% of coach verdicts have no gladlog predicate for the same event".
That number is only meaningful if the mapper reliably maps IN-SCOPE events back. Nothing in
the pipeline ever tested that — this does.

  stage 1 (agy/Gemini, a different model family): for each type OBSERVED FIRING in the corpus,
          rewrite its real predicate into N coach-voice phrasings — coach vocabulary, not
          definition vocabulary
  stage 2 (production mapper, same prompt/model as the corpus run): map the shuffled,
          unlabelled mix of those + known out-of-scope real verdicts
  report: recall (in-scope mapped back to source type), false-mapping rate on out-of-scope,
          and the confidence distribution of both

  negative_control.py --universe <candidate_incidence.json> [--per-type 4] [--distractors 30]
                      [--model claude-opus-5 --effort high] [--out negative_control]

The generation universe (GH #74, 2026-09-12): the set of types the mapper can be shown a real
firing of is OBSERVED corpus truth, never a hand roster —
    npx tsx packages/eval/scripts/candidateDiagnostics.ts --n 400 --json > <DATA>/candidate_incidence.json
Until 2026-09-12 the universe was DESKTOP_MISTAKE_TYPES ("does the desktop render a mistake
row"), which spent 6/17 of the budget on types that never fire (cc-held / cd-spent-idle /
unsynced-burst are flag-false; missed-kick / missed-purge-kill-window are desktop-derived rows,
not candidates; burst-into-mitigation is silent on the healer slice) and skipped the 5 that do —
kick-eaten 44 % (the single most-fired type, and where both shipped fixes came from), death 43 %,
death-setup 31 %, missed-cleanse 16 %, md-cyclone-window 2 %. The two desktop rosters stay in the
MAPPING prompt for what they legitimately answer (render / don't render); only the generation
universe changed. `generated.json` is keyed to its universe — a different universe regenerates.
"""
import argparse, collections, json, random, subprocess, time
from pathlib import Path
from common import DATA, DESKTOP_MISTAKE_TYPES, DESKTOP_IGNORED_TYPES, load_type_defs, def_block, claude_call, parse_json_object, read_json, write_json

AGY = Path.home() / ".claude/skills/agy/scripts/agy-run.mjs"

def check_generated(gen, universe, per_type):
    """The generator must cover the requested universe exactly, k nonempty strings per type. A
    generator that drops a hard type would otherwise raise the aggregate score unnoticed."""
    if not isinstance(gen, dict):
        raise SystemExit(f"generator output is not an object: {type(gen).__name__}")
    keys = sorted(gen)
    if keys != universe:
        raise SystemExit(f"generator keys != universe: missing {sorted(set(universe)-set(keys))}, extra {sorted(set(keys)-set(universe))}")
    bad = {t: v for t, v in gen.items()
           if not isinstance(v, list) or len(v) != per_type or not all(isinstance(s, str) and s.strip() for s in v)}
    if bad:
        raise SystemExit(f"generator returned wrong item count/shape (want {per_type} nonempty strings each): "
                         f"{ {t: (len(v) if isinstance(v, list) else type(v).__name__) for t, v in bad.items()} }")

def observed_universe(path, defs):
    """Types observed firing in `candidateDiagnostics.ts --json` output (rows[].type, incidence > 0).

    Sorted for a stable prompt. Every observed type must have a definition — a type that fires but
    has no definition is exactly the hole this control exists to find, so it is an error, not a skip."""
    rows = read_json(path)["rows"]
    types = sorted(r["type"] for r in rows if r.get("incidencePct", 0) > 0)
    if not types:
        raise SystemExit(f"{path}: no observed types — did candidateDiagnostics run on an empty library?")
    missing = [t for t in types if t not in defs]
    if missing:
        raise SystemExit(f"observed types without a definition: {missing}; run gen_type_definitions.py "
                         f"(and add them to a roster in common.py — the desktop rosters, not a 'live' list)")
    return types

GEN = """You write like a World of Warcraft arena coach reviewing a student's match.

Below are {n} formal predicate definitions from a combat-log analysis tool. For EACH, write {k}
different one-sentence verdicts a coach would say out loud when that exact event happened in a
match being reviewed.

Hard requirements:
- Use a coach's vocabulary and rhythm. Do NOT reuse the definition's wording, its field names, its
  thresholds, or its jargon. A reader must not be able to tell you were shown a definition.
- Each sentence must describe the SAME event the predicate fires on — not a related topic.
- Vary phrasing across the {k}: blunt, explanatory, second-person, past-tense recap.

DEFINITIONS
{defs}

Output one JSON object, no fence, no commentary:
{{"gen": {{"<type-id>": ["<verdict 1>", "<verdict 2>", ...]}}}}
"""

MAP = """You are mapping coaching verdicts onto an analysis tool's declared candidate types.

Each type below carries its REAL operational definition — the predicate the tool actually fires on.
Map a verdict to a type only when the coach's judgement is the SAME event the predicate describes,
not merely the same topic. "Topic overlap" is not a match.

DECLARED TYPES — the desktop report renders these as a mistake row
{active}

DECLARED TYPES — the desktop report does NOT render these as a mistake row.
Equally valid mapping targets: several of them DO still fire into the coaching prompt
(measured 2026-09-06: kick-eaten 44%, death 43%, death-setup 31%, missed-cleanse 16%).
Whether a type ships is NOT what these two groups distinguish — do not use the grouping
as evidence either way when mapping.
{retired}

If no predicate describes the verdict's event, answer "unmapped". Use it freely and honestly —
unmapped verdicts are the interesting ones. Do not stretch.

map_confidence: "high" = the predicate would fire on exactly this event; "medium" = same event
family, predicate might not catch this instance; "low" = topical resemblance only.

VERDICTS
{items}

Output one JSON object, no fence:
{{"map": {{"<index>": {{"gladlog_type": "<type or unmapped>", "map_confidence": "high"|"medium"|"low"}}, ...}}}}
"""

def agy_call(prompt, model="flash", timeout=420):
    p = subprocess.run(["node", str(AGY), "ask", "--model", model, "--timeout", str(timeout), prompt],
                       capture_output=True, text=True, timeout=timeout + 60)
    body = "\n".join(l for l in p.stdout.splitlines() if not l.startswith("[agy-run]")).strip()
    if p.returncode != 0 or not body:
        raise RuntimeError(f"rc={p.returncode} stdout({len(body)}B)={body[:150]!r} stderr={p.stderr[-200:]!r}")
    return parse_json_object(body)

def distractors(n, seed=11):
    """Real verdicts from clusters ruled structurally out of the candidate layer (2026-09-05)."""
    tax = read_json(DATA / "taxonomy.json"); asg = tax["assign"]
    pool = []
    for f in sorted((DATA / "verdicts_remap").glob("*.json")):
        for v in read_json(f).get("verdicts", []):
            if asg.get(v.get("semantic")) in ("talent-build", "comp-gameplan") and v.get("paraphrase"):
                pool.append(v["paraphrase"])
    random.Random(seed).shuffle(pool)
    return pool[:n]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--per-type", type=int, default=4)
    ap.add_argument("--distractors", type=int, default=30); ap.add_argument("--model", default="claude-opus-5"); ap.add_argument("--effort", default="high")
    ap.add_argument("--batch", type=int, default=25)
    ap.add_argument("--universe", default=str(DATA / "candidate_incidence.json"),
                    help="candidateDiagnostics.ts --json output; the generation universe is its observed types")
    ap.add_argument("--out", default="negative_control", help="output dir under DATA")
    a = ap.parse_args()
    OUT = DATA / a.out
    OUT.mkdir(parents=True, exist_ok=True)
    defs = load_type_defs()
    universe = observed_universe(a.universe, defs)
    print(f"generation universe = {len(universe)} observed types from {a.universe}: {universe}", flush=True)

    gen_path = OUT / "generated.json"
    gen = None
    if gen_path.exists():
        cached = read_json(gen_path)
        # Cache identity = universe AND per-type count (codex review 2026-09-12: a key-only check
        # silently reused 4 cached items when 40 were requested).
        if sorted(cached["gen"]) == universe and cached.get("per_type") == a.per_type:
            gen = cached["gen"]; print(f"generated cached: {sum(len(v) for v in gen.values())} items", flush=True)
        else:
            print(f"generated.json is for {sorted(cached['gen'])} × {cached.get('per_type')}, not {len(universe)} types × {a.per_type} — regenerating", flush=True)
    if gen is None:
        t0 = time.time()
        gen = agy_call(GEN.format(n=len(universe), k=a.per_type, defs=def_block(defs, universe, "observed-firing")))["gen"]
        check_generated(gen, universe, a.per_type)
        write_json(gen_path, {"gen": gen, "per_type": a.per_type, "generator": "agy/flash", "universe": a.universe})
        print(f"generated {sum(len(v) for v in gen.values())} coach-voice items for {len(gen)} types in {time.time()-t0:.0f}s", flush=True)
    else:
        check_generated(gen, universe, a.per_type)

    items = [{"text": t, "truth": ty} for ty, ts in gen.items() for t in ts]
    items += [{"text": t, "truth": "OUT-OF-SCOPE"} for t in distractors(a.distractors)]
    random.Random(7).shuffle(items)
    print(f"mixed set: {len(items)} ({sum(1 for i in items if i['truth']!='OUT-OF-SCOPE')} in-scope / {a.distractors} out-of-scope)", flush=True)

    for k in range(0, len(items), a.batch):
        chunk = items[k:k+a.batch]
        if all("pred" in c for c in chunk): continue
        body = "\n".join(f"{i}. {c['text']}" for i, c in enumerate(chunk))
        m = claude_call(MAP.format(active=def_block(defs, DESKTOP_MISTAKE_TYPES, "desktop-mistake-row"), retired=def_block(defs, DESKTOP_IGNORED_TYPES, "desktop-ignores"), items=body), a.model, a.effort).get("map", {})
        for i, c in enumerate(chunk):
            e = m.get(str(i)) or {}
            c["pred"] = e.get("gladlog_type", "unmapped"); c["conf"] = e.get("map_confidence", "low")
        print(f"  mapped {min(k+a.batch, len(items))}/{len(items)}", flush=True)
    write_json(OUT / "results.json", {"items": items, "mapper": {"model": a.model, "effort": a.effort}, "universe": {"file": a.universe, "types": universe}})

    ins = [c for c in items if c["truth"] != "OUT-OF-SCOPE"]; outs = [c for c in items if c["truth"] == "OUT-OF-SCOPE"]
    exact = sum(1 for c in ins if c["pred"] == c["truth"]); anymap = sum(1 for c in ins if c["pred"] != "unmapped")
    hi = sum(1 for c in ins if c["pred"] == c["truth"] and c["conf"] == "high")
    fm = sum(1 for c in outs if c["pred"] != "unmapped")
    print(f"\n=== 负对照结果 (mapper: {a.model}/{a.effort}) ===")
    print(f"在产类型的教练口吻改写  n={len(ins)}")
    print(f"  映回源类型(召回)        {exact:>3} = {exact/len(ins)*100:.0f}%")
    print(f"  映到任意类型(非 unmapped){anymap:>3} = {anymap/len(ins)*100:.0f}%   ← 1 减此值 = 映射器把在产事件判成「无对应」的比例")
    print(f"  映回源类型且 high        {hi:>3} = {hi/len(ins)*100:.0f}%")
    print(f"结构外判决(干扰项)      n={len(outs)}")
    print(f"  被硬套到某类型          {fm:>3} = {fm/max(len(outs),1)*100:.0f}%")
    worst = collections.Counter(c["truth"] for c in ins if c["pred"] == "unmapped")
    if worst: print(f"\n最常被判「无对应」的在产类型: {dict(worst.most_common(8))}")

if __name__ == "__main__": main()
