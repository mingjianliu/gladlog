#!/usr/bin/env python3
"""Paired diff between two extracted directories on the SAME files (same uuid), e.g. a mapping
rerun (v1→v2) or two model arms. Reports type flows, triage flows (courses), unmapped/high deltas.
  compare.py --line vod    --a verdicts        --b verdicts_remap
  compare.py --line course --a rules_opus      --b rules_opus_v2
  compare.py --line course --a rules --b rules_opus   # model arms on the 9-lesson validation set
There is no ground truth; this compares SHAPE (granularity, triage tendency, mapping strictness), not accuracy.
If the two arms used different prompt versions the comparison is confounded — say so in the writeup.
"""
import argparse, collections
from common import DATA, read_json

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--line", choices=["vod","course"], required=True); ap.add_argument("--a", required=True); ap.add_argument("--b", required=True); a = ap.parse_args()
    A, B = DATA / a.a, DATA / a.b; key = "verdicts" if a.line == "vod" else "rules"
    names = sorted(f.name for f in A.glob("*.json") if (B / f.name).exists())
    if not names: raise SystemExit("no paired files")
    pa = []; pb = []
    for n in names:
        ra, rb = read_json(A / n).get(key, []), read_json(B / n).get(key, [])
        if a.line == "course": ra = [r for r in ra if r.get("kind") == "decision"]; rb = [r for r in rb if r.get("kind") == "decision"]
        pa += ra; pb += rb
    print(f"paired files {len(names)} · items A {len(pa)} / B {len(pb)}" + (" (decision only)" if a.line == "course" else ""))
    for label, L in (("A", pa), ("B", pb)):
        un = sum(1 for r in L if r["gladlog_type"] == "unmapped"); hi = sum(1 for r in L if r["gladlog_type"] != "unmapped" and r.get("map_confidence") == "high")
        line = f"  {label}: unmapped {un} ({un/max(len(L),1)*100:.0f}%) · high {hi}"
        if a.line == "course":
            c = collections.Counter(r.get("decidable") for r in L); line += f" · log-decidable {c['log-decidable']} ({c['log-decidable']/max(len(L),1)*100:.0f}%) needs-new-data {c['needs-new-data']} structurally-no {c['structurally-no']}"
        print(line)
    if len(pa) == len(pb):
        same = sum(1 for x, y in zip(pa, pb) if x["gladlog_type"] == y["gladlog_type"]); print(f"  same-index type agreement {same}/{len(pa)} = {same/len(pa)*100:.0f}%")
        flow = collections.Counter((x["gladlog_type"], y["gladlog_type"]) for x, y in zip(pa, pb) if x["gladlog_type"] != y["gladlog_type"])
        print("  type flows A→B:"); [print(f"    {v:>4}  {s} → {t}") for (s, t), v in flow.most_common(10)]
        if a.line == "course":
            tsame = sum(1 for x, y in zip(pa, pb) if x.get("decidable") == y.get("decidable")); print(f"  same-index triage agreement {tsame}/{len(pa)} = {tsame/len(pa)*100:.0f}%")
            tf = collections.Counter((x.get("decidable"), y.get("decidable")) for x, y in zip(pa, pb) if x.get("decidable") != y.get("decidable"))
            print("  triage flows A→B:"); [print(f"    {v:>4}  {s} → {t}") for (s, t), v in tf.most_common(6)]
    else:
        print("  (item counts differ — arms extracted different rule sets; flows not computed)")

if __name__ == "__main__": main()
