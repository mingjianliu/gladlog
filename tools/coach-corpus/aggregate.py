#!/usr/bin/env python3
"""Report over an extracted directory.
  aggregate.py --line vod    [--in verdicts_remap] [--patch 12.0]   # cluster coverage, mapping, needs_frame
  aggregate.py --line course [--in rules_opus_v2]                   # 三分 (decision only), new candidates, 4-type hits
Cluster-level percentages carry ±10pp run-to-run noise (n≈25 → binomial SD ≈10pp); only corpus-level
totals are load-bearing. Small samples get a banner.
"""
import argparse, collections, math
from common import DATA, read_json

def vod(src, patch):
    recs = [read_json(f) for f in sorted(src.glob("*.json"))]
    if patch: recs = [r for r in recs if str(r.get("patch")) == patch]
    tax = read_json(DATA / "taxonomy.json"); asg = tax["assign"]; zh = {c["id"]: c["name_zh"] for c in tax["clusters"]}
    vs = [(r, v) for r in recs for v in r.get("verdicts", [])]; n = len(vs)
    if not vs: print(f"(no verdicts for patch={patch})"); return
    print(f"# VoD 判决 · {len(recs)} 视频 · {n} 判决" + (f" · patch {patch}" if patch else ""))
    if patch and len(recs) < 15: print(f"> 样本警告: n={len(recs)} 视频，只能当轶事读。")
    un = sum(1 for _, v in vs if v["gladlog_type"] == "unmapped"); hi = sum(1 for _, v in vs if v["gladlog_type"] != "unmapped" and v.get("map_confidence") == "high")   # strict match = mapped AND high
    print(f"unmapped {un} ({un/n*100:.0f}%) · high {hi} ({hi/n*100:.1f}%) · outcome_claim {sum(1 for _,v in vs if v.get('outcome_claim'))/n*100:.0f}% · needs_frame {sum(1 for _,v in vs if v.get('needs_frame'))/n*100:.0f}%\n")
    rows = collections.defaultdict(lambda: {"n":0,"un":0,"hi":0,"types":collections.Counter()})
    for r, v in vs:
        d = rows[asg.get(v["semantic"], "other")]; d["n"] += 1
        if v["gladlog_type"] == "unmapped": d["un"] += 1
        else: d["types"][v["gladlog_type"]] += 1; d["hi"] += v.get("map_confidence") == "high"   # only counted when mapped
    print(f"{'簇':<30}{'n':>5}{'unmap':>8}{'±sd':>5}{'high':>6}  主映射")
    for cid, d in sorted(rows.items(), key=lambda kv: -kv[1]["n"]):
        p = d["un"]/d["n"]; sd = math.sqrt(p*(1-p)/d["n"])*100
        print(f"{cid[:28]:<30}{d['n']:>5}{p*100:>7.0f}%{sd:>5.0f}{d['hi']:>6}  {', '.join(f'{k}({v})' for k,v in d['types'].most_common(2)) or '—'}   {zh.get(cid,'')}")

def course(src):
    rs = []
    for f in sorted(src.glob("*.json")):
        d = read_json(f); rs += [dict(r, lesson=d["title"], course=d["course"]) for r in d.get("rules", [])]
    dec = [r for r in rs if r.get("kind") == "decision"]; k = collections.Counter(r.get("kind") for r in rs)
    print(f"# 教程规则 · {len({r['course'] for r in rs})} 门课 · {len(rs)} 规则 · decision {k['decision']} / mechanic-fact {k['mechanic-fact']} / mindset {k['mindset']}")
    c = collections.Counter(r["decidable"] for r in dec)
    print("\n## 三分（仅 decision）")
    for key in ("log-decidable","needs-new-data","structurally-no"): print(f"- {key:<18} {c[key]:>4} ({c[key]/max(len(dec),1)*100:.0f}%)")
    un = sum(1 for r in dec if r["gladlog_type"] == "unmapped"); hi = sum(1 for r in dec if r["gladlog_type"] != "unmapped" and r["map_confidence"] == "high")
    print(f"\n映射（仅 decision）: unmapped {un}/{len(dec)} ({un/max(len(dec),1)*100:.0f}%) · high {hi}")
    cand = [r for r in dec if r["decidable"] == "log-decidable" and r["gladlog_type"] == "unmapped"]
    print(f"\n## 日志能判 且 无类型 = {len(cand)}（按课）")
    for k_, v in collections.Counter(r["course"] for r in cand).most_common(): print(f"- {v:>3}  {k_}")
    mp = collections.Counter(r["gladlog_type"] for r in rs)
    print("\n## 手写定义类型命中"); [print(f"- {t:<26} {mp[t]}") for t in ("cd-waste","missed-kick","missed-purge-kill-window","questionable-external")]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--line", choices=["vod","course"], required=True); ap.add_argument("--in", dest="src"); ap.add_argument("--patch"); a = ap.parse_args()
    src = DATA / (a.src or ("verdicts_remap" if a.line == "vod" else "rules_opus_v2"))
    vod(src, a.patch) if a.line == "vod" else course(src)

if __name__ == "__main__": main()
