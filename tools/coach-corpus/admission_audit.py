#!/usr/bin/env python3
"""GH #71 — admission audit of the Value-Gate target-sentence pool.

Why this exists (codex debate 2026-09-12, both rounds PARTIAL): reading coach sentences next to a
predicate's legend is a DISCOVERY instrument, not a pass/fail gate. "medium" mappings are defined
as "same event family, predicate might not catch this instance" (extract_verdicts.py), so a
sentence is only usable as a target for a legend after an ADMISSION decision against the
predicate's real eligibility conditions. This script freezes the pool and the rubric, merges the
hand decisions, validates completeness, writes the private ledger and prints the tables the audit
doc cites. Zero model calls.

Pool (frozen): polarity == mistake ∩ gladlog_type observed firing (logger ∪ dps scans,
candidateDiagnostics.ts --json) ∩ map_confidence ∈ {high, medium}. First pass = the subset codex
ruled on (R1): cc-avoidable + burst-into-mitigation + the five predicates with zero high-confidence
examples in the healer-only pool (position-mistake, slow-defensive-response, cd-hoarded,
death-setup, crisis-no-response).

Usage:
  python3 tools/coach-corpus/admission_audit.py --decisions <decisions.json> [--out <ledger.json>]
                                                  [--pool-only]   # print the pool, no decisions needed
Decisions file: {"<video>/<index>": {"decision": EXCLUDED|UNKNOWN|NON-TARGET|ADMITTED,
                 "premises": [..unresolved..], "axes": [..], "note": ""}, "_rubric": [...], "_frozen": "..."}
"""
import argparse, collections, json, sys
from pathlib import Path
from common import DATA, read_json, write_json

FIRST_PASS = ["cc-avoidable", "burst-into-mitigation", "position-mistake", "slow-defensive-response",
              "cd-hoarded", "death-setup", "crisis-no-response"]
DECISIONS = ["EXCLUDED", "UNKNOWN", "NON-TARGET", "ADMITTED"]

def observed_types():
    out = set()
    for name in ("candidate_incidence.json", "candidate_incidence_dps.json"):
        p = DATA / name
        if p.exists():
            out |= {r["type"] for r in read_json(p)["rows"] if r.get("incidencePct", 0) > 0}
    if not out:
        raise SystemExit("no candidate_incidence*.json under DATA — run candidateDiagnostics.ts --json first")
    return out

def build_pool():
    obs = observed_types()
    pool = []
    for f in sorted((DATA / "verdicts_remap").glob("*.json")):
        vid = f.stem
        for i, v in enumerate(read_json(f).get("verdicts", [])):
            if v.get("polarity") != "mistake": continue
            t, c = v.get("gladlog_type"), v.get("map_confidence")
            if t in obs and c in ("high", "medium"):
                pool.append({"id": f"{vid}/{i}", "type": t, "confidence": c, "t_start": v.get("t_start"),
                             "needs_frame": str(v.get("needs_frame")) == "True", "semantic": v.get("semantic"),
                             "paraphrase": v["paraphrase"], "first_pass": t in FIRST_PASS})
    return pool

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--decisions"); ap.add_argument("--out", default=str(DATA / "admission-audit-2026-09-12.json"))
    ap.add_argument("--pool-only", action="store_true")
    a = ap.parse_args()
    pool = build_pool()
    by_type = collections.Counter(r["type"] for r in pool)
    print(f"pool: {len(pool)} sentences / {len(by_type)} predicates; first pass = {sum(r['first_pass'] for r in pool)}")
    for t, n in by_type.most_common(): print(f"  {t:26s} {n:3d} {'*' if t in FIRST_PASS else ''}")
    if a.pool_only: return
    dec = read_json(a.decisions)
    rubric, frozen = dec.pop("_rubric", None), dec.pop("_frozen", None)
    ids = {r["id"] for r in pool if r["first_pass"]}
    missing = sorted(ids - set(dec)); extra = sorted(set(dec) - ids)
    bad = {k: v.get("decision") for k, v in dec.items() if v.get("decision") not in DECISIONS}
    if missing or extra or bad:
        raise SystemExit(f"decisions incomplete: missing {missing}, extra {extra}, bad {bad}")
    for r in pool:
        if r["first_pass"]:
            d = dec[r["id"]]; r.update(decision=d["decision"], premises=d.get("premises", []), axes=d.get("axes", []), note=d.get("note", ""))
    ledger = {"frozen": frozen, "rubric": rubric, "first_pass_types": FIRST_PASS, "pool_size": len(pool),
              "first_pass_size": len(ids), "sentences": pool}
    write_json(a.out, ledger)
    print(f"\nledger → {a.out}")
    # tables
    print("\n## decisions per predicate (first pass)\n")
    print("| predicate | n | ADMITTED | UNKNOWN | NON-TARGET | EXCLUDED |")
    print("|---|---:|---:|---:|---:|---:|")
    tot = collections.Counter()
    for t in FIRST_PASS:
        rows = [r for r in pool if r["type"] == t]
        c = collections.Counter(r["decision"] for r in rows); tot.update(c)
        print(f"| {t} | {len(rows)} | {c['ADMITTED']} | {c['UNKNOWN']} | {c['NON-TARGET']} | {c['EXCLUDED']} |")
    print(f"| **total** | {len(ids)} | {tot['ADMITTED']} | {tot['UNKNOWN']} | {tot['NON-TARGET']} | {tot['EXCLUDED']} |")
    print("\n## advice axes per predicate (multi-label)\n")
    for t in FIRST_PASS:
        ax = collections.Counter(a_ for r in pool if r["type"] == t for a_ in r["axes"])
        print(f"- **{t}**: " + ", ".join(f"{k} {v}" for k, v in ax.most_common()))
    print("\n## ADMITTED sentences\n")
    for r in pool:
        if r.get("decision") == "ADMITTED":
            print(f"- `{r['type']}` [{r['confidence']}] {r['id']} — {r['paraphrase'][:160]}")
    print("\n## EXCLUDED reasons\n")
    for r in pool:
        if r.get("decision") == "EXCLUDED":
            print(f"- `{r['type']}` {r['id']} — {r['premises'][0] if r['premises'] else ''}")
    print("\n## most common unresolved premises (UNKNOWN)\n")
    prem = collections.Counter()
    for r in pool:
        if r.get("decision") == "UNKNOWN":
            for p in r["premises"]: prem[(r["type"], p.split(" — ")[0][:70])] += 1
    for (t, p), n in prem.most_common(25): print(f"- {n} × `{t}`: {p}")

if __name__ == "__main__":
    main()
