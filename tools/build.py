#!/usr/bin/env python3
"""Build Nederlands modules: content/mNN.json -> modules/mNN.js + audio/mNN/*.m4a, and modules/ready.js.

Usage:  python3 -I tools/build.py            (all modules in content/)
        python3 -I tools/build.py m05        (one module; ready.js is still rebuilt from all)
        python3 -I tools/build.py --check    (validate only, no audio)

Audio uses macOS `say` (Dutch voices: Xander nl_NL, Ellen nl_BE) + `afconvert` to AAC .m4a.
Clips are only regenerated when their text, voice or rate changed (tools/audio_cache.json).
"""
import hashlib, json, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT, MODS, AUDIO = (os.path.join(ROOT, d) for d in ("content", "modules", "audio"))
CACHE_F = os.path.join(ROOT, "tools", "audio_cache.json")
VOICES = ["Xander", "Ellen"]          # default voice for speaker 1, 2 (more speakers alternate)
RATE = 165                           # words per minute; modules can override with "rate"
GLOSS = re.compile(r"\{([^{}|]+)\|[^{}]+\}")


def plain(s):
    """Text for TTS / dictation answers: drop gloss markup and emphasis."""
    s = GLOSS.sub(r"\1", s)
    return re.sub(r"\*\*|==|\*", "", s).strip()


class Bad(Exception):
    pass


def need(cond, msg):
    if not cond:
        raise Bad(msg)


def check_items(items, where, kinds=("mc", "tf", "type", "order")):
    for i, it in enumerate(items):
        w = f"{where}[{i}]"
        t = it.get("t")
        need(t in kinds, f"{w}: type {t!r} not allowed here")
        need(it.get("q") or t == "order", f"{w}: missing q")
        if t == "mc":
            need(isinstance(it.get("o"), list) and len(it["o"]) >= 2, f"{w}: mc needs options o")
            need(isinstance(it.get("a"), int) and 0 <= it["a"] < len(it["o"]), f"{w}: mc answer index out of range")
            need(len(set(it["o"])) == len(it["o"]), f"{w}: duplicate options")
        elif t == "tf":
            need(isinstance(it.get("a"), bool), f"{w}: tf answer must be true/false")
        elif t in ("type", "order"):
            need(isinstance(it.get("a"), list) and it["a"] and all(isinstance(a, str) and a.strip() for a in it["a"]), f"{w}: answers a must be a non-empty list of strings")
            need("___" not in it["a"][0], f"{w}: answer contains ___")
        if t == "order":
            base = sorted(re.sub(r"[.?!]$", "", it["a"][0]).lower().split(" "))
            for a in it["a"]:
                need(sorted(re.sub(r"[.?!]$", "", a).lower().split(" ")) == base, f"{w}: alternative order {a!r} uses different words")
            need(len(base) >= 3, f"{w}: order item too short")


def validate(m, mid):
    need(m.get("id") == mid, f"id must be {mid}")
    for k in ("n", "title", "lvl", "goals", "words", "read", "listen", "gram", "write", "speak"):
        need(k in m, f"missing {k}")
    W = m["words"]
    need(8 <= len(W) <= 16, "words: use 8–16 words")
    for i, w in enumerate(W):
        need(all(w.get(k) for k in ("nl", "en", "ex")), f"words[{i}]: needs nl, en, ex")
        if w.get("cz"):
            need(w["cz"] in w["ex"], f"words[{i}]: cz {w['cz']!r} not in example")
    need(len({w["nl"] for w in W}) == len(W), "duplicate words")
    R = m["read"]
    need(R.get("title") and R.get("text"), "read: needs title and text")
    need(R["text"].count("{") == R["text"].count("}"), "read: unbalanced gloss braces")
    check_items(R["qs"], "read.qs")
    L = m["listen"]
    n = len(L["lines"])
    need(n >= 4, "listen: needs lines")
    for i, q in enumerate(L["qs"]):
        need(all(0 <= x < n for x in q.get("l", [])), f"listen.qs[{i}]: line ref out of range")
    check_items(L["qs"], "listen.qs")
    need(all(0 <= x < n for x in L.get("dict", [])), "listen.dict: line ref out of range")
    G = m["gram"]
    need(G.get("title") and G.get("explain") and len(G.get("items", [])) >= 6, "gram: needs title, explain, 6+ items")
    check_items(G["items"], "gram.items")
    check_items(m.get("personal", []), "personal")
    Wr = m["write"]
    need(all(Wr.get(k) for k in ("task", "min", "max", "check", "model")), "write: needs task, min, max, check, model")
    Sp = m["speak"]
    need(Sp.get("lines"), "speak: needs lines")
    for i, l in enumerate(Sp["lines"]):
        need(("l" in l and 0 <= l["l"] < n) or l.get("t"), f"speak.lines[{i}]: needs t or valid l")


def say(text, voice, rate, out, cache, force=False):
    key = hashlib.sha1(f"{voice}|{rate}|{text}".encode()).hexdigest()
    rel = os.path.relpath(out, ROOT)
    if not force and cache.get(rel) == key and os.path.exists(out):
        return False
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        aiff = os.path.join(td, "a.aiff")
        subprocess.run(["say", "-v", voice, "-r", str(rate), "-o", aiff, text], check=True)
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "48000", aiff, out], check=True)
    cache[rel] = key
    return True


def build(mid, cache, audio=True):
    src = os.path.join(CONTENT, mid + ".json")
    m = json.load(open(src, encoding="utf-8"))
    validate(m, mid)
    rate = m.get("rate", RATE)
    A = lambda name: f"audio/{mid}/{name}.m4a"
    jobs = []  # (text, voice, rate, relpath)
    for k, w in enumerate(m["words"]):
        w["au"], w["aux"] = A(f"w{k}"), A(f"x{k}")
        jobs += [(w["nl"], VOICES[0], rate - 15, w["au"]), (plain(w["ex"]), VOICES[0], rate, w["aux"])]
    R = m["read"]
    R["au"] = A("read")
    jobs.append((" \n".join(plain(p) for p in R["text"].split("\n\n")), VOICES[0], rate, R["au"]))
    L = m["listen"]
    voices = dict(L.get("voices", {}))
    order = []
    for k, l in enumerate(L["lines"]):
        who = l.get("who", "")
        if who not in voices:
            voices[who] = VOICES[len(order) % len(VOICES)]
        if who not in order:
            order.append(who)
        l["au"] = A(f"l{k:02d}")
        jobs.append((plain(l["t"]), voices[who], L.get("rate", rate), l["au"]))
    for k, l in enumerate(m["speak"]["lines"]):
        if "l" in l:
            src_line = L["lines"][l["l"]]
            l["t"], l["au"] = src_line["t"], src_line["au"]
        else:
            l["au"] = A(f"s{k}")
            jobs.append((plain(l["t"]), VOICES[0], rate - 10, l["au"]))
    made = 0
    if audio:
        for text, voice, r, rel in jobs:
            made += say(text, voice, r, os.path.join(ROOT, rel), cache)
        keep = {os.path.basename(j[3]) for j in jobs}
        d = os.path.join(AUDIO, mid)
        for f in os.listdir(d):
            if f.endswith(".m4a") and f not in keep:
                os.remove(os.path.join(d, f))
    os.makedirs(MODS, exist_ok=True)
    with open(os.path.join(MODS, mid + ".js"), "w", encoding="utf-8") as f:
        f.write("/* generated by tools/build.py from content/%s.json — edit the JSON, not this file */\n" % mid)
        f.write("window.NL_MOD=window.NL_MOD||{};NL_MOD[%s]=%s;\n" % (json.dumps(mid), json.dumps(m, ensure_ascii=False, separators=(",", ":"))))
    print(f"{mid}: ok ({len(jobs)} clips, {made} new)")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    audio = "--check" not in sys.argv
    cache = json.load(open(CACHE_F)) if os.path.exists(CACHE_F) else {}
    allm = sorted(f[:-5] for f in os.listdir(CONTENT) if re.fullmatch(r"m\d\d\.json", f))
    bad = 0
    for mid in (args or allm):
        try:
            build(mid, cache, audio)
        except Bad as e:
            print(f"{mid}: ERROR {e}")
            bad += 1
    if audio:
        json.dump(cache, open(CACHE_F, "w"), indent=0, sort_keys=True)
    ready = sorted(f[:-3] for f in os.listdir(MODS) if re.fullmatch(r"m\d\d\.js", f))
    with open(os.path.join(MODS, "ready.js"), "w") as f:
        f.write("window.NL_READY=%s;\n" % json.dumps(ready))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
