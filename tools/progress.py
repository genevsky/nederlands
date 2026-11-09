#!/usr/bin/env python3
"""Print a learner report from the synced progress, for writing the next module.

Reads the sync code from tools/.sync-code (git-ignored; one line, the same code you typed in the app),
fetches the Dutch progress row via the public Supabase RPC, and prints: finished modules + scores,
skill averages, open mistakes (most-missed first), weak words, and writing texts that still need feedback.

Usage: python3 -I tools/progress.py            (report)
       python3 -I tools/progress.py --json     (raw state)
"""
import json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
cfg = open(os.path.join(ROOT, "assets", "sync-config.js")).read()
URL = re.search(r'url:"([^"]+)"', cfg).group(1)
KEY = re.search(r'key:"([^"]+)"', cfg).group(1)
code_f = os.path.join(ROOT, "tools", ".sync-code")
if not os.path.exists(code_f):
    sys.exit("No tools/.sync-code yet: put the app's sync code in that file (one line).")
code = open(code_f).read().strip()

req = urllib.request.Request(URL.rstrip("/") + "/rest/v1/rpc/get_progress", data=json.dumps({"p_code": code + "-nl"}).encode(),
                             headers={"Content-Type": "application/json", "apikey": KEY}, method="POST")
doc = json.load(urllib.request.urlopen(req, timeout=20))
S = (doc or {}).get("nl")
if not S:
    sys.exit("No Dutch progress synced for this code yet.")
if "--json" in sys.argv:
    print(json.dumps(S, ensure_ascii=False, indent=1)); sys.exit()

mods = S.get("mods", {})
print("== Modules")
skills = {}
for mid in sorted(mods):
    m = mods[mid]; sc = m.get("sc", {})
    parts = []
    for k, v in sc.items():
        if k != "speak" and v and v[1]:
            parts.append(f"{k} {round(100*v[0]/v[1])}%"); skills.setdefault(k, []).append(v[0] / v[1])
    print(f"{mid}: {'done' if m.get('done') else 'step ' + str(m.get('step', 0))}, {round(m.get('ms', 0)/60000)} min · " + ", ".join(parts))
print("\n== Skill averages")
for k, v in skills.items():
    print(f"{k}: {round(100*sum(v)/len(v))}% over {len(v)} modules")
days = S.get("days", {})
print(f"\nPractice days: {len(days)} · total {round(sum(days.values())/60)} min")

errs = [(k, e) for k, e in S.get("errs", {}).items() if not e.get("res")]
errs.sort(key=lambda x: -x[1].get("n", 1))
print(f"\n== Open mistakes ({len(errs)}; resolved {sum(1 for e in S.get('errs', {}).values() if e.get('res'))})")
for k, e in errs[:40]:
    it = e.get("it", {}); a = it.get("a")
    ans = a[0] if isinstance(a, list) else (it.get("o", [None])[a] if isinstance(a, int) and not isinstance(a, bool) and it.get("o") else a)
    q = re.sub(r"\s+", " ", str(it.get("q", "")))[:110]
    print(f"- [{e.get('sk')}] ×{e.get('n')} {k}: {q} → {ans}")

srs = S.get("srs", {}).values()
weak = sorted([w for w in srs if w.get("w", 0) >= 1], key=lambda w: (-w.get("w", 0), w.get("b", 1)))
print(f"\n== Words: {len(list(S.get('srs', {})))} in deck · weak ones:")
for w in weak[:25]:
    print(f"- {w['nl']} ({w['en']}) box {w.get('b')} missed {w.get('w')}×")

print("\n== Writing (newest first)")
for mid, w in sorted(S.get("writing", {}).items(), key=lambda x: -x[1].get("ts", 0)):
    print(f"--- {mid} ({w.get('words')} words)\nTASK: {w.get('task')}\nTEXT:\n{w.get('text')}\n")
