#!/usr/bin/env python
"""Stage A: audio -> timestamped transcript, for VoD commentaries or course lessons.

  fetch_transcribe.py --kind vod    [--patch-prefix 12] [--limit N] [--shard i n]
  fetch_transcribe.py --kind course [--course TITLE]    [--limit N] [--shard i n]

Only the master playlist is gated; /api/video/<uuid>/<bitrate>.m3u8 and the .ts segments are open,
so nothing here touches a credential. Audio is a scratch artifact (deleted after transcription);
transcripts hold the coach's words and stay in the gitignored data root. Run with crv's venv python
(faster_whisper). Frames are deliberately not extracted here (user ruling 2026-09-04: courses are
scripted; VoD frames are pulled on demand at verdict instants, see the HANDOFF).
"""
import argparse, json, re, subprocess, time
from common import DATA, read_json, write_json, shard
STREAM = "https://www.skill-capped.com/api/video/{uuid}/500.m3u8"
COMP = [("you","yourClass/Spec"),("ally1","yourFirstTeammate"),("ally2","yourSecondTeammate"),
        ("enemy1","theirFirstClass/Spec"),("enemy2","theirSecondClass/Spec"),("enemy3","theirThirdClass/Spec")]

def vod_targets(patch_prefix):
    d = read_json(DATA / "course_dump.json")
    out = [c for c in d["commentaries"] if str(c.get("patch","")).startswith(patch_prefix)]
    return sorted(out, key=lambda c: -c.get("rDate", 0))

def course_targets():
    d = read_json(DATA / "course_dump.json"); cfg = read_json(DATA / "courses_tier1.json")
    vids = {v["uuid"]: v for v in d["videos"]}; v2c = d["videosToCourses"]; out = []
    want = {t: None for t in cfg["courses"]}
    want.update({t: re.compile(f["exclude_title_regex"]) for t, f in cfg.get("courses_filtered", {}).items()})
    for course, excl in want.items():
        order = 0
        for ch in v2c.get(course, {}).get("chapters", []):
            for x in ch.get("vids", []):
                v = vids.get(x["uuid"])
                if not v or v["durSec"] < 30 or (excl and excl.search(v["title"])): continue
                order += 1
                out.append({"uuid": v["uuid"], "course": course, "chapter": ch.get("title",""), "order": order,
                            "title": v["title"], "durSec": v["durSec"], "role": v.get("role")})
    return out

def grab_audio(uuid, dest):
    if dest.exists() and dest.stat().st_size > 1000: return True
    return subprocess.run(["ffmpeg","-y","-v","error","-i",STREAM.format(uuid=uuid),"-vn","-acodec","pcm_s16le","-ar","16000","-ac","1",str(dest)],
                          capture_output=True).returncode == 0

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--kind", choices=["vod","course"], required=True)
    ap.add_argument("--patch-prefix", default="12"); ap.add_argument("--course"); ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--shard", nargs=2, type=int, default=[0,1]); a = ap.parse_args()
    from faster_whisper import WhisperModel
    model = WhisperModel("turbo", device="cpu", compute_type="int8", cpu_threads=3)
    tgts = vod_targets(a.patch_prefix) if a.kind == "vod" else course_targets()
    if a.course: tgts = [t for t in tgts if t["course"] == a.course]
    if a.limit: tgts = tgts[:a.limit]
    tgts = shard(tgts, *a.shard)
    out_dir = DATA / ("transcripts" if a.kind == "vod" else "transcripts_courses"); audio = DATA / "audio"; audio.mkdir(parents=True, exist_ok=True)
    print(f"shard {a.shard[0]}/{a.shard[1]}: {len(tgts)} targets ({sum(t['durSec'] for t in tgts)/60:.0f} min) -> {out_dir.name}", flush=True)
    for i, c in enumerate(tgts, 1):
        uuid = c["uuid"]; out = out_dir / f"{uuid}.json"
        if out.exists(): print(f"[{i}/{len(tgts)}] {uuid} cached", flush=True); continue
        t0 = time.time(); wav = audio / f"{uuid}.wav"
        if not grab_audio(uuid, wav): print(f"[{i}/{len(tgts)}] {uuid} AUDIO FAILED", flush=True); continue
        segs, _ = model.transcribe(str(wav), language="en", vad_filter=True)
        segments = [{"start": round(s.start,2), "end": round(s.end,2), "text": s.text.strip()} for s in segs]
        if a.kind == "vod":
            rec = {"uuid": uuid, "title": c.get("title",""), "patch": c.get("patch"), "bracket": c.get("bracket"), "type": c.get("type"),
                   "staff": c.get("staff"), "map": c.get("map"), "durSec": c.get("durSec"), "rDate": c.get("rDate"),
                   "comp": {k: c.get(f) for k, f in COMP}, "segments": segments}
        else:
            rec = dict(c, segments=segments)
        write_json(out, rec); wav.unlink(missing_ok=True)
        print(f"[{i}/{len(tgts)}] {uuid} {c.get('durSec')}s -> {len(segments)} segs in {time.time()-t0:.0f}s", flush=True)

if __name__ == "__main__": main()
