#!/usr/bin/env python3
"""Build the 教练规则全录 page: every rule and verdict, filterable, zh by default (en toggle).
Reads rules_opus_v2/, verdicts_remap/, taxonomy.json and the translations_zh/ sidecars.
  build_listing.py [--out PATH]   (default: <data>/evidence/coach-rules-full.html)
Content is paraphrase only; transcripts are never read here.
"""
import argparse, json, collections, html
from common import DATA, read_json

CSS = r'''
:root{--ground:#F4F6F8;--surface:#FFFFFF;--sunk:#EDF0F4;--ink:#151B24;--ink2:#3A4552;--muted:#5F6A79;--rule:#DCE1E8;--rule2:#C3CBD6;--accent:#8A5A11;--mapped:#2B6CB0;--unmapped:#B7791F;--flag:#9C3B2A;--pillbg:#E9EDF2;--shadow:0 1px 2px rgba(20,28,40,.06),0 8px 24px -12px rgba(20,28,40,.18)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ground:#10151C;--surface:#161C25;--sunk:#1C242F;--ink:#E5EAF1;--ink2:#BDC7D4;--muted:#8B97A7;--rule:#252E3A;--rule2:#36414F;--accent:#D3A244;--mapped:#3F7FBD;--unmapped:#BE8A2A;--flag:#DD8570;--pillbg:#222B37;--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px -14px rgba(0,0,0,.7)}}
:root[data-theme="dark"]{--ground:#10151C;--surface:#161C25;--sunk:#1C242F;--ink:#E5EAF1;--ink2:#BDC7D4;--muted:#8B97A7;--rule:#252E3A;--rule2:#36414F;--accent:#D3A244;--mapped:#3F7FBD;--unmapped:#BE8A2A;--flag:#DD8570;--pillbg:#222B37;--shadow:0 1px 2px rgba(0,0,0,.4),0 10px 30px -14px rgba(0,0,0,.7)}
*{box-sizing:border-box}body{background:var(--ground);color:var(--ink);font-family:"Source Serif 4",Georgia,"Songti SC",serif;font-size:15.5px;line-height:1.55;margin:0;padding:0 0 80px}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}h1,h2,.eyebrow,.tab,.chip,.pill,.cnt,.mono,code{font-family:Chivo,"Helvetica Neue",Arial,sans-serif}.mono,code{font-family:"JetBrains Mono",ui-monospace,Menlo,monospace}
header{padding:44px 0 18px}.eyebrow{font-size:11px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--accent);margin:0 0 8px}
h1{font-size:clamp(30px,4.6vw,44px);line-height:1.05;font-weight:900;letter-spacing:-.02em;margin:0 0 10px;text-wrap:balance}.lede{color:var(--ink2);max-width:720px;margin:0;font-size:16.5px}
.bar{position:sticky;top:0;z-index:5;background:var(--ground);border-bottom:1px solid var(--rule);padding:12px 0 10px}.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.tabs{display:inline-flex;border:1px solid var(--rule2);border-radius:4px;overflow:hidden}.tab{background:var(--surface);color:var(--muted);border:0;padding:7px 14px;font-size:13px;font-weight:700;cursor:pointer}.tab[aria-selected="true"]{background:var(--ink);color:var(--ground)}
input[type=search]{flex:1 1 220px;min-width:180px;padding:7px 10px;border:1px solid var(--rule2);border-radius:4px;background:var(--surface);color:var(--ink);font:inherit;font-size:14px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{background:var(--surface);border:1px solid var(--rule2);border-radius:999px;padding:3px 10px;font-size:12px;color:var(--muted);cursor:pointer;user-select:none}.chip[aria-pressed="true"]{background:var(--ink);color:var(--ground);border-color:var(--ink)}
.cnt{font-size:12.5px;color:var(--muted);margin-left:auto;font-variant-numeric:tabular-nums}.cnt b{color:var(--ink)}
details{background:var(--surface);border:1px solid var(--rule);box-shadow:var(--shadow);margin:14px 0}summary{cursor:pointer;padding:12px 16px;display:flex;gap:12px;align-items:baseline;list-style:none}summary::-webkit-details-marker{display:none}summary::before{content:"▸";color:var(--muted);font-size:12px;flex:none}details[open] summary::before{content:"▾"}
summary h2{font-size:16px;font-weight:900;margin:0}summary .zh{font-family:"Source Serif 4",serif;color:var(--muted);font-size:13px;font-weight:400}summary .n{margin-left:auto;font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--muted)}
.lesson{border-top:1px solid var(--rule);padding:10px 16px 4px}.lesson h3{font-family:Chivo,sans-serif;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin:4px 0 8px}
.item{padding:9px 0 9px 14px;border-left:3px solid var(--rule2);margin:0 16px 10px}.item.ld{border-left-color:var(--mapped)}.item.nd{border-left-color:var(--unmapped)}.item.sn{border-left-color:var(--rule2)}.item.mistake{border-left-color:var(--flag)}.item.correct{border-left-color:var(--mapped)}.item.alternative{border-left-color:var(--rule2)}
.txt{margin:0 0 4px}.en{color:var(--muted);font-size:13.5px;margin:0 0 4px}.meta{font-size:12px;color:var(--muted);line-height:1.7}.meta b{color:var(--ink2);font-weight:600}
.pill{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.06em;padding:1px 7px;border-radius:3px;background:var(--pillbg);color:var(--ink2);margin-right:6px;vertical-align:1px}.pill.ld{color:var(--mapped)}.pill.nd{color:var(--unmapped)}.pill.mistake{color:var(--flag)}.pill.correct{color:var(--mapped)}
.gt{font-family:"JetBrains Mono",monospace;font-size:11.5px;color:var(--ink2);background:var(--sunk);padding:1px 5px}.gt.un{color:var(--muted);background:transparent;border:1px dashed var(--rule2)}
.note{font-size:13.5px;color:var(--muted);border-left:2px solid var(--rule2);padding-left:12px;margin:14px 0 0}:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
'''

JS = r'''
const D=JSON.parse(document.getElementById('data').textContent);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const CHIPS={rules:[['kind','decision','决策'],['kind','mechanic-fact','机制事实'],['kind','mindset','心态'],['decidable','log-decidable','日志能判'],['decidable','needs-new-data','需新数据'],['decidable','structurally-no','结构不可判'],['role_scope','melee','近战'],['role_scope','ranged','远程'],['role_scope','healer','治疗'],['role_scope','all','通用'],['mapped','yes','有 gladlog 类型'],['mapped','no','无对应']],
 verdicts:[['pol','mistake','失误'],['pol','correct','做对了'],['pol','alternative','更优解'],['mapped','yes','有 gladlog 类型'],['mapped','no','无对应'],['mc','high','高置信映射'],['oc','yes','带后果归因']]};
let tab='rules', on={}, lang='zh';
const chipsEl=document.getElementById('chips'), out=document.getElementById('out'), q=document.getElementById('q'), cnt=document.getElementById('cnt');
const T=(o,k)=>lang==='zh'&&o[k+'_zh']?o[k+'_zh']:o[k];           // zh with English fallback
const EN=(o,k)=>lang==='zh'&&o[k+'_zh']&&o[k]?`<p class="en">${esc(o[k])}</p>`:'';
function drawChips(){chipsEl.innerHTML='';on={};for(const [k,v,l] of CHIPS[tab]){const b=document.createElement('button');b.className='chip';b.textContent=l;b.setAttribute('aria-pressed','false');b.dataset.kv=k+'|'+v;b.onclick=()=>{on[k]=on[k]===v?null:v;[...chipsEl.children].forEach(c=>{const [ck,cv]=c.dataset.kv.split('|');c.setAttribute('aria-pressed',String(on[ck]===cv));});render();};chipsEl.appendChild(b);}}
function passR(r,s){if(on.kind&&r.kind!==on.kind)return false;if(on.decidable&&r.decidable!==on.decidable)return false;if(on.role_scope&&r.role_scope!==on.role_scope)return false;if(on.mapped==='yes'&&r.gladlog_type==='unmapped')return false;if(on.mapped==='no'&&r.gladlog_type!=='unmapped')return false;
 if(s){const t=[r.rule,r.rule_zh,r.trigger,r.trigger_zh,r.consequence,r.consequence_zh,r.comp_scope,r.gladlog_type].join(' ').toLowerCase();if(!t.includes(s))return false;}return true;}
function passV(v,s){if(on.pol&&v.pol!==on.pol)return false;if(on.mapped==='yes'&&v.gt==='unmapped')return false;if(on.mapped==='no'&&v.gt!=='unmapped')return false;if(on.mc&&v.mc!==on.mc)return false;if(on.oc==='yes'&&!v.oc)return false;
 if(s){const t=[v.p,v.p_zh,v.sem,v.oc,v.oc_zh,v.src,v.gt].join(' ').toLowerCase();if(!t.includes(s))return false;}return true;}
const DEC={'log-decidable':['ld','日志能判'],'needs-new-data':['nd','需新数据'],'structurally-no':['sn','结构不可判']};const POL={mistake:'失误',correct:'做对了',alternative:'更优解'};
const gt=(t,mc)=>t==='unmapped'?'<span class="gt un">无对应</span>':`<span class="gt">${esc(t)}</span> <span class="mono" style="font-size:11px;color:var(--muted)">${esc(mc)}</span>`;
function render(){const s=q.value.trim().toLowerCase();let shown=0,total=0;const parts=[];
 if(tab==='rules'){for(const c of D.courses){let cs=0;const L=[];for(const l of c.lessons){const keep=l.rules.filter(r=>passR(r,s));total+=l.rules.length;if(!keep.length)continue;cs+=keep.length;
   L.push(`<div class="lesson"><h3>${esc(l.lesson)} <span class="mono" style="color:var(--muted);font-weight:400;letter-spacing:0">· ${keep.length}</span></h3>${keep.map(r=>{const [cls,lab]=DEC[r.decidable]||['sn',r.decidable];
   return `<div class="item ${cls}"><p class="txt">${esc(T(r,'rule'))}</p>${EN(r,'rule')}<div class="meta"><span class="pill ${cls}">${lab}</span><span class="pill">${esc(r.kind)}</span><span class="pill">${esc(r.role_scope)}</span>${r.comp_scope&&r.comp_scope!=='any'?`<b>对位</b> ${esc(r.comp_scope)} · `:''}${r.trigger?`<b>触发</b> ${esc(T(r,'trigger'))}<br>`:''}${r.consequence?`<b>后果</b> ${esc(T(r,'consequence'))}<br>`:''}<b>gladlog</b> ${gt(r.gladlog_type,r.map_confidence)}${r.decidable!=='log-decidable'&&r.why?`<br><b>缺什么</b> ${esc(T(r,'why'))}`:''}</div></div>`;}).join('')}</div>`);}
   if(!L.length)continue;shown+=cs;parts.push(`<details${parts.length===0?' open':''}><summary><h2>${esc(c.course)}</h2><span class="n">${cs}</span></summary>${L.join('')}</details>`);}}
 else{for(const c of D.clusters){const keep=c.items.filter(v=>passV(v,s));total+=c.items.length;if(!keep.length)continue;shown+=keep.length;
   parts.push(`<details${parts.length===0?' open':''}><summary><h2>${esc(c.id)}</h2><span class="zh">${esc(c.zh)}</span><span class="n">${keep.length}</span></summary>${keep.map(v=>`<div class="item ${esc(v.pol)}"><p class="txt">${esc(T(v,'p'))}</p>${EN(v,'p')}<div class="meta"><span class="pill ${esc(v.pol)}">${POL[v.pol]||esc(v.pol)}</span><span class="mono" style="font-size:11px">${esc(v.sem)}</span> · <span class="mono" style="font-size:11px">${esc(v.uuid)} @${Math.round(v.t)}s</span><br><b>对局</b> ${esc(v.src)}<br>${v.oc?`<b>教练归因</b> ${esc(T(v,'oc'))}<br>`:''}<b>gladlog</b> ${gt(v.gt,v.mc)}</div></div>`).join('')}</details>`);}}
 out.innerHTML=parts.join('')||'<p class="note">没有匹配项。</p>';cnt.innerHTML=`显示 <b>${shown}</b> / ${total}`;}
document.querySelectorAll('.tab[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;document.querySelectorAll('.tab[data-tab]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));drawChips();render();});
document.querySelectorAll('.tab[data-lang]').forEach(b=>b.onclick=()=>{lang=b.dataset.lang;document.querySelectorAll('.tab[data-lang]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));render();});
q.addEventListener('input',render);drawChips();render();
'''

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out"); a = ap.parse_args()
    out = a.out or (DATA / "evidence" / "coach-rules-full.html")
    tax = read_json(DATA / "taxonomy.json"); asg = tax["assign"]; czh = {c["id"]: c["name_zh"] for c in tax["clusters"]}
    zh = {}
    zdir = DATA / "translations_zh"
    if zdir.exists():
        for f in zdir.glob("*.json"):
            d = read_json(f); zh[d["uuid"]] = d.get("items", {})
    courses = collections.defaultdict(list)
    for f in sorted((DATA / "rules_opus_v2").glob("*.json")):
        d = read_json(f); z = zh.get(d["uuid"], {})
        rules = []
        for i, r in enumerate(d.get("rules", [])):
            o = {k: r.get(k) for k in ("rule","trigger","consequence","role_scope","comp_scope","kind","decidable","why","gladlog_type","map_confidence")}
            for k, v in (z.get(str(i)) or {}).items():
                if v: o[k + "_zh"] = v
            rules.append(o)
        courses[d["course"]].append({"lesson": d["title"], "order": d.get("order", 0), "rules": rules})
    for c in courses.values(): c.sort(key=lambda l: l["order"])
    clusters = collections.defaultdict(list)
    for f in sorted((DATA / "verdicts_remap").glob("*.json")):
        d = read_json(f); comp = d.get("comp", {}); z = zh.get(d["uuid"], {})
        src = f"{comp.get('you','?')} · {d.get('bracket','?')} · {d.get('map','?')} · {d.get('patch','?')} · {d.get('staff','?')}"
        for i, v in enumerate(d.get("verdicts", [])):
            o = {"src": src, "uuid": d["uuid"], "t": v.get("t_start"), "p": v.get("paraphrase"), "pol": v.get("polarity"), "sem": v.get("semantic"),
                 "gt": v.get("gladlog_type"), "mc": v.get("map_confidence"), "oc": v.get("outcome_claim")}
            zi = z.get(str(i)) or {}
            if zi.get("paraphrase"): o["p_zh"] = zi["paraphrase"]
            if zi.get("outcome_claim"): o["oc_zh"] = zi["outcome_claim"]
            clusters[asg.get(v.get("semantic"), "other")].append(o)
    data = {"courses": [{"course": k, "lessons": v} for k, v in sorted(courses.items(), key=lambda kv: -sum(len(l["rules"]) for l in kv[1]))],
            "clusters": [{"id": k, "zh": czh.get(k, k), "items": clusters[k]} for k in sorted(clusters, key=lambda k: -len(clusters[k]))]}
    nr = sum(len(l["rules"]) for c in data["courses"] for l in c["lessons"]); nv = sum(len(c["items"]) for c in data["clusters"])
    nz = sum(1 for c in data["courses"] for l in c["lessons"] for r in l["rules"] if "rule_zh" in r) + sum(1 for c in data["clusters"] for v in c["items"] if "p_zh" in v)
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    page = f'''<title>教练规则全录</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chivo:wght@400;700;900&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=JetBrains+Mono:wght@400;700&display=swap">
<style>{CSS}</style>
<div class="wrap">
<header>
  <p class="eyebrow">Skill Capped 12.x · 全部转述，不含原话 · 中文译文 {nz}/{nr+nv} 条</p>
  <h1>教练规则全录</h1>
  <p class="lede"><b>{nr}</b> 条教程规则（{len(data["courses"])} 门课，按课程 → 课时）与 <b>{nv}</b> 条 VoD 判决（68 场复盘，按 {len(data["clusters"])} 个关注点归簇）。每条标着对应到 gladlog 哪个候选类型（或无对应），教程规则还标着「违反它日志今天判得出来吗」。默认显示中文译文、下附英文原转述；右上可切纯英文。</p>
  <p class="note">左侧色条：教程规则 — 蓝＝日志能判 · 金＝需新数据 · 灰＝结构不可判；VoD 判决 — 红＝失误 · 蓝＝做对了 · 灰＝更优解。点课程/簇标题展开。</p>
</header>
<div class="bar"><div class="wrap" style="padding:0">
  <div class="row">
    <div class="tabs" role="tablist"><button class="tab" role="tab" aria-selected="true" data-tab="rules">教程规则</button><button class="tab" role="tab" aria-selected="false" data-tab="verdicts">VoD 判决</button></div>
    <input type="search" id="q" placeholder="搜索（中英文均可）：规则、触发条件、判决、标签…" aria-label="搜索">
    <div class="tabs" role="tablist" aria-label="语言"><button class="tab" role="tab" aria-selected="true" data-lang="zh">中文</button><button class="tab" role="tab" aria-selected="false" data-lang="en">English</button></div>
    <span class="cnt" id="cnt"></span>
  </div>
  <div class="row" style="margin-top:8px"><div class="chips" id="chips"></div></div>
</div></div>
<main id="out"></main>
</div>
<script id="data" type="application/json">{blob}</script>
<script>{JS}</script>'''
    from pathlib import Path
    Path(out).parent.mkdir(parents=True, exist_ok=True); Path(out).write_text(page)
    print(f"wrote {out}: rules {nr} · verdicts {nv} · zh {nz} · {len(page.encode())/1e6:.2f} MB")

if __name__ == "__main__": main()
