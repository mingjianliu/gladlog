#!/usr/bin/env python3
"""Pull the public Skill Capped catalogue dump. The URL carries a timestamp that changes; get the
current one from the site's network tab (courses_v2/<game>/course_dump_<ts>.json). No auth."""
import sys, urllib.request
from common import DATA
def main():
    if len(sys.argv) < 2: sys.exit("usage: fetch_catalog.py <course_dump_url>")
    DATA.mkdir(parents=True, exist_ok=True); out = DATA / "course_dump.json"
    urllib.request.urlretrieve(sys.argv[1], out); print(f"wrote {out} ({out.stat().st_size/1e6:.1f} MB)")
if __name__ == "__main__": main()
