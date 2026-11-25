#!/usr/bin/env python3
"""Build Nederlands sessions: content/<id>.json -> modules/<id>.js + audio/<id>/*.m4a, and modules/ready.js.
Sessions are modules (mNN, standard format) and lessons (lNN, "kind":"les", focused grammar lessons).

Usage:  python3 -I tools/build.py            (everything in content/)
        python3 -I tools/build.py m05 l01    (some sessions; ready.js is still rebuilt from all)
        python3 -I tools/build.py --check    (validate only, no audio)

Audio uses macOS `say` (Dutch voices: Claire (Enhanced) nl_NL as narrator, Xander nl_NL) + `afconvert` to AAC .m4a.
Clips are only regenerated when their text, voice or rate changed (tools/audio_cache.json).
"""
import hashlib, json, os, re, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTENT, MODS, AUDIO = (os.path.join(ROOT, d) for d in ("content", "modules", "audio"))
CACHE_F = os.path.join(ROOT, "tools", "audio_cache.json")
VOICES = ["Claire (Enhanced)", "Xander (Enhanced)"]   # narrator/speaker 1, speaker 2 (more speakers alternate)
RATE = 165                           # words per minute; modules can override with "rate"
GLOSS = re.compile(r"\{([^{}|]+)\|[^{}]+\}")

# ---- teach before test -------------------------------------------------------------------------------------------
# Forms that may only be asked for (in answers the learner has to produce) once the lesson that teaches them came
# earlier in the plan, or in that session itself after its explanation. Reading/listening texts may contain them
# (that is input, not a test). "reden" (also a noun) and "vroeg" (also 'early') are left out on purpose.
GATES = {
    "irr1": ("l01", "was waren had hadden ging gingen kwam kwamen zag zagen deed deden nam namen stond stonden zat zaten "
                    "reed kon konden moest moesten wist wisten zei zeiden kreeg kregen bleef bleven"),
    "irr2": ("l03", "sliep sliepen liep liepen zwom zwommen las lazen gaf gaven vond vonden begon begonnen dronk dronken "
                    "at aten koos kozen lag lagen sprak spraken schreef schreven dacht dachten bracht brachten kocht kochten "
                    "zocht zochten viel vielen hield hielden hielp hielpen vergat vergaten verloor verloren trok trokken "
                    "vertrok vertrokken bezocht bezochten riep riepen mocht mochten"),
}
GATE_FORMS = {tag: set(forms.split()) for tag, (_, forms) in GATES.items()}
CODES = {"WO", "VERB", "TENSE", "SP", "ART", "ADJ", "PREP", "PRON", "WORD", "MISS", "PL", "PUNCT", "?"}  # same list as CODES in app.js


def plan_order():
    """Session ids in plan order, read from curriculum.js."""
    src = open(os.path.join(ROOT, "curriculum.js"), encoding="utf-8").read()
    return [lid or "m%02d" % int(n) for lid, n in re.findall(r'^ \{(?:id:"(l\d\d)",[^\n]*|n:(\d+),[^\n]*)$', src, re.M)]


def produced(items):
    """Answer strings the learner has to produce or pick in these items."""
    out = []
    for it in items or []:
        t = it.get("t")
        if t in ("type", "order"):
            out += it["a"]
        elif t == "mc":
            out.append(it["o"][it["a"]])
    return out


def prompt_check(m, where):
    """A card's English prompt must not give the answer away: no other forms of the word (e.g. 'plural: namen'),
    and not the Dutch answer itself. Related forms go in 'say' (spoken, and shown only after answering)."""
    for i, w in enumerate(m.get("words", []) + m.get("preps", [])):
        en = w["en"].lower()
        need(not re.search(r"plural|meervoud|singular|enkelvoud|·", en), f"{where} {w['nl']!r}: the prompt 'en' lists other forms ({w['en']!r}); put them in 'say'")
        for form in {re.sub(r"^(de|het|een) ", "", w["nl"].lower()), (w.get("cz") or "").lower()} - {""}:
            need(not re.search(r"(^|[^a-zà-ÿ])" + re.escape(form) + r"($|[^a-zà-ÿ])", en), f"{where} {w['nl']!r}: the prompt 'en' contains the answer {form!r}")


def tense_check(m, where):
    """A gap with a verb hint like '(hebben)' must say which tense it wants when the answer isn't the present:
    '(hebben, past)' or '(betalen, participle)'. Alex asked for this explicitly (2026-11-25)."""
    items = []
    if m.get("kind") == "les":
        for c in m["chunks"]:
            items += c["items"]
        items += m["practice"]
    else:
        items += m["gram"]["items"] + m["gram"].get("check", []) + m.get("personal", [])
    past = set().union(*GATE_FORMS.values())
    for it in items:
        q = it.get("q", "")
        h = re.search(r"\(([a-z]+en)\b[^)]*\)", q)
        if not h or re.search(r"past|particip|perfect|tense|verleden", q, re.I):
            continue
        answers = it["a"] if isinstance(it["a"], list) else [it["o"][it["a"]]] if it.get("t") == "mc" else []
        for ans in answers:
            w = ans.lower().strip(" .")
            if w in past or (len(w) > 4 and re.fullmatch(r"[a-zà-ÿ]+(te|de|ten|den)", w) and w[:-2] != h.group(1)[:-2]) or re.fullmatch(r"ge[a-zà-ÿ]+[dt]|[a-zà-ÿ]+ge[a-zà-ÿ]+[dt]", w):
                raise Bad(f"{where}: {q[-50:]!r} asks for {ans!r} but the hint doesn't say the tense; write '({h.group(1)}, past)' or '({h.group(1)}, participle)'")


def gate_check(m, mid):
    order = plan_order()
    need(mid in order, f"{mid} is not in curriculum.js")
    me = order.index(mid)
    first = min(order.index(t) for t, _ in GATES.values())
    if me < first:
        return  # sessions built before the rule existed
    prompt_check(m, mid)
    tense_check(m, mid)
    before = {tag for tag, (teacher, _) in GATES.items() if order.index(teacher) < me}
    self_ = before | {tag for tag, (teacher, _) in GATES.items() if teacher == mid}

    def check(texts, allowed, where):
        bad = set()
        for txt in texts:
            for w in re.findall(r"[a-zà-ÿ]+", plain(txt).lower()):
                for tag, forms in GATE_FORMS.items():
                    if tag not in allowed and w in forms:
                        bad.add(f"{w} ({tag}, taught in {GATES[tag][0]})")
        need(not bad, f"{where}: asks for forms not taught yet: {', '.join(sorted(bad))}")

    check(produced(m.get("personal")), before, "personal (warm-up, before any explanation)")
    if m.get("kind") == "les":
        check(produced(m["discover"]["qs"]), self_, "discover.qs")
        for k, c in enumerate(m["chunks"]):
            check(produced(c["items"]), self_, f"chunks[{k}]")
        check(produced(m["practice"]), self_, "practice")
        check([w["nl"] for w in m["words"] + m.get("preps", [])] + [w.get("cz", "") for w in m["words"] + m.get("preps", [])], self_, "words")
    else:
        need(m.get("flow") == 2, "modules from now on need \"flow\": 2 (grammar explained before it is practised)")
        need(2 <= len(m["gram"].get("check", [])) <= 4, "gram.check: 2–4 easy items after the explanation")
        check(produced(m["gram"]["check"]) + produced(m["gram"]["items"]), self_, "gram")
        check([w["nl"] for w in m["words"] + m.get("preps", [])] + [w.get("cz", "") for w in m["words"] + m.get("preps", [])], self_, "words")


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


def validate_les(m, mid):
    for k in ("les", "title", "lvl", "goals", "discover", "chunks", "practice", "words", "write"):
        need(k in m, f"missing {k}")
    D = m["discover"]
    need(D.get("title") and D.get("text") and D.get("qs"), "discover: needs title, text, qs")
    check_items(D["qs"], "discover.qs")
    need(len(m["chunks"]) >= 2, "chunks: at least 2 small steps")
    for k, c in enumerate(m["chunks"]):
        need(c.get("title") and c.get("explain") and len(c.get("items", [])) >= 2, f"chunks[{k}]: needs title, explain, 2+ items")
        check_items(c["items"], f"chunks[{k}].items")
    need(len(m["practice"]) >= 8, "practice: 8+ items, easy to hard")
    check_items(m["practice"], "practice")
    W = m["words"]
    need(6 <= len(W) <= 24, "words (forms to learn): use 6–24")
    for i, w in enumerate(W):
        need(all(w.get(k) for k in ("nl", "en", "ex")), f"words[{i}]: needs nl, en, ex")
        if w.get("cz"):
            need(w["cz"] in w["ex"], f"words[{i}]: cz {w['cz']!r} not in example")
    Wr = m["write"]
    need(all(Wr.get(k) for k in ("task", "min", "max", "check", "model")), "write: needs task, min, max, check, model")


def validate(m, mid):
    need(m.get("id") == mid, f"id must be {mid}")
    if m.get("kind") == "les":
        validate_les(m, mid)
        gate_check(m, mid)
        return
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
    if m.get("flow") == 2:
        check_items(m["gram"].get("check", []), "gram.check")
        need(14 <= len(W) <= 16, "words: flow-2 modules have 14–16 words")
        P = m.get("preps", [])
        need(3 <= len(P) <= 4, "preps: 3–4 fixed preposition combinations (wachten op, trots zijn op…)")
        for i, w in enumerate(P):
            need(all(w.get(k) for k in ("nl", "en", "ex", "cz")), f"preps[{i}]: needs nl, en, ex, cz")
            need(re.search(r"(^|[^A-Za-zÀ-ÿ])" + re.escape(w["cz"]) + r"(?![A-Za-zÀ-ÿ])", w["ex"]), f"preps[{i}]: cz {w['cz']!r} is not a whole word in ex")
        F = Sp.get("func")
        need(F and F.get("title") and 4 <= len(F.get("phrases", [])) <= 7, "speak.func: title + 4–7 phrases for one everyday task")
        need(all(f.get("nl") and f.get("en") for f in F["phrases"]), "speak.func.phrases: need nl and en")
        need(Sp.get("role"), "speak.role: the role-play situation for practising with Claude")
    fb = m.get("feedback")
    if fb and fb.get("text"):
        codes = re.findall(r"\[\[[^|\]]+\|([^\]]+)\]\]", fb["text"])
        need(codes, "feedback.text: mark mistakes as [[fragment|CODE]]")
        bad = sorted(set(codes) - CODES)
        need(not bad, f"feedback.text: unknown codes {bad}; use {sorted(CODES)}")
    gate_check(m, mid)


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
        jobs += [(w.get("say") or w["nl"], VOICES[0], rate - 15, w["au"]), (plain(w["ex"]), VOICES[0], rate, w["aux"])]
    if m.get("kind") == "les":
        D = m["discover"]
        D["au"] = A("disc")
        jobs.append((" \n".join(plain(p) for p in D["text"].split("\n\n")), VOICES[0], rate - 10, D["au"]))
        return finish(m, mid, jobs, cache, audio)
    for k, w in enumerate(m.get("preps", [])):
        w["au"], w["aux"] = A(f"pw{k}"), A(f"px{k}")
        jobs += [(w["nl"], VOICES[0], rate - 15, w["au"]), (plain(w["ex"]), VOICES[0], rate, w["aux"])]
    for k, f in enumerate((m["speak"].get("func") or {}).get("phrases", [])):
        f["au"] = A(f"f{k}")
        jobs.append((plain(f["nl"]).replace("…", "").strip(), VOICES[0], rate - 10, f["au"]))
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
    return finish(m, mid, jobs, cache, audio)


def finish(m, mid, jobs, cache, audio):
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


def dict_pool(ready):
    """Per module: sentences that have audio and suit dictation (4–14 words): listening lines, word examples, speaking lines."""
    pool = {}
    for mid in ready:
        js = open(os.path.join(MODS, mid + ".js"), encoding="utf-8").read()
        m = json.loads(js[js.index("]=") + 2:].rstrip().rstrip(";"))
        seen, out = set(), []
        cands = [(l["t"], l.get("au")) for l in m.get("listen", {}).get("lines", [])]
        cands += [(w["ex"], w.get("aux")) for w in m["words"]]
        cands += [(l["t"], l.get("au")) for l in m.get("speak", {}).get("lines", [])]
        for t, au in cands:
            t = plain(t)
            if au and 4 <= len(t.split()) <= 14 and t not in seen:
                seen.add(t); out.append([t, au])
        pool[mid] = out
    return pool


def item_index(ready):
    """id -> current item fields, using the same ids the app gives exercises (so the error bank can refresh old wording)."""
    keep = ("t", "q", "o", "a", "x", "hint", "keep", "keepCap", "art")
    idx = {}
    for mid in ready:
        js = open(os.path.join(MODS, mid + ".js"), encoding="utf-8").read()
        m = json.loads(js[js.index("]=") + 2:].rstrip().rstrip(";"))
        groups = []
        if m.get("kind") == "les":
            groups += [(f"{mid}.c{k}.", c["items"]) for k, c in enumerate(m["chunks"])]
            groups.append((f"{mid}.g.", m["practice"]))
        else:
            groups += [(f"{mid}.g.", m["gram"]["items"]), (f"{mid}.c.", m["gram"].get("check", [])),
                       (f"{mid}.p.", m.get("personal", [])), (f"{mid}.r.", m["read"]["qs"]), (f"{mid}.l.", m["listen"]["qs"])]
        for pre, items in groups:
            for k, it in enumerate(items):
                idx[pre + str(k)] = {f: it[f] for f in keep if f in it}
    return idx


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    audio = "--check" not in sys.argv
    cache = json.load(open(CACHE_F)) if os.path.exists(CACHE_F) else {}
    allm = sorted(f[:-5] for f in os.listdir(CONTENT) if re.fullmatch(r"[ml]\d\d\.json", f))
    bad = 0
    for mid in (args or allm):
        try:
            build(mid, cache, audio)
        except Bad as e:
            print(f"{mid}: ERROR {e}")
            bad += 1
    if audio:
        json.dump(cache, open(CACHE_F, "w"), indent=0, sort_keys=True)
    ready = sorted(f[:-3] for f in os.listdir(MODS) if re.fullmatch(r"[ml]\d\d\.js", f))
    with open(os.path.join(MODS, "ready.js"), "w", encoding="utf-8") as f:
        f.write("window.NL_READY=%s;\n" % json.dumps(ready))
        f.write("/* dictation pool: sentences with audio, used to vary dictation mistakes in the review */\n")
        f.write("window.NL_POOL=%s;\n" % json.dumps(dict_pool(ready), ensure_ascii=False, separators=(",", ":")))
        f.write("/* current text of every exercise by id: mistakes already in the review show the latest wording */\n")
        f.write("window.NL_Q=%s;\n" % json.dumps(item_index(ready), ensure_ascii=False, separators=(",", ":")))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
