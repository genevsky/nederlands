#!/usr/bin/env python3
"""Click-test: runs a module start to finish in Chromium (phone + desktop), with some deliberate mistakes,
then checks the error bank, the daily review, progress page and console errors.
Usage: ~/.venvs/studie/bin/python -I tools/test_site.py [m01] [--url http://localhost:8765]"""
import json, sys, re
from playwright.sync_api import sync_playwright

mid = next((a for a in sys.argv[1:] if re.fullmatch(r"[ml]\d\d", a)), "m01")
url = sys.argv[sys.argv.index("--url") + 1] if "--url" in sys.argv else "http://localhost:8765"
WRONG_EVERY = 4  # answer every 4th question wrong

def answer(page, n):
    it = page.evaluate("window.__curItem")
    t = it["t"]
    wrong = n % WRONG_EVERY == 3
    if t in ("mc", "tf"):
        correct = it["a"] if t == "mc" else (0 if it["a"] else 1)
        k = correct if not wrong else (correct + 1) % (len(it["o"]) if t == "mc" else 2)
        page.click(f'.opt[data-k="{k}"]')
    elif t in ("type", "dict"):
        sel = ".ans .inp"
        page.fill(sel, "xyz fout" if wrong else it["a"][0])
        page.click("#act button")
    elif t == "order":
        target = re.sub(r"[.?!]$", "", it["a"][0]).split(" ")
        if not it.get("keepCap"): target[0] = target[0].lower()
        if wrong: target = list(reversed(target))
        for w in target:
            page.locator(".pool .tok", has_text=re.compile("^" + re.escape(w) + "$")).first.click()
        page.click("#act button")
    elif t == "card":
        pass
    page.wait_for_selector(".fbx", timeout=3000)
    page.click("#act button")  # Continue
    return wrong

def run_items(page, budget=80):
    n = 0
    while n < budget:
        page.wait_for_timeout(60)
        if not page.locator("#run .item, #run2 .item, .chk .item").count():
            return n
        answer(page, n); n += 1
    raise RuntimeError("item loop did not end")

def act(page, label_part=None):
    b = page.locator("#act button")
    if label_part: assert label_part in b.inner_text(), (b.inner_text(), label_part)
    b.click(); page.wait_for_timeout(150)

def main():
    errors = []
    with sync_playwright() as p:
        br = p.chromium.launch()
        for name, vp in (("phone", {"width": 390, "height": 844}), ("desktop", {"width": 1280, "height": 900})):
            ctx = br.new_context(viewport=vp, is_mobile=name == "phone", has_touch=name == "phone")
            page = ctx.new_page()
            page.on("pageerror", lambda e: (errors.append(f"{name}: {e}"), print("PAGEERROR", e)))
            page.on("console", lambda m: m.type == "error" and errors.append(f"{name} console: {m.text}"))
            page.goto(url + "/#/m/" + mid); page.wait_for_selector("ol.steps")
            if page.locator(".fbcard").count():
                print(name, "feedback items", page.locator(".fbcard .corr").count())
                if page.locator(".mtext .ec").count():  # tapping a mark explains it
                    page.locator(".mtext .ec").first.click()
                    assert page.locator("#ecx").is_visible(), "mark explanation did not open"
                    print(name, "mark explained:", page.locator("#ecx").inner_text().replace("\n", " | ")[:140])
            # walk every step, whatever the order (flow 1, flow 2 or a lesson): answer items, then press the action button
            steps = page.locator("ol.steps li").count(); print(name, "steps", steps)
            total = 0
            for guard in range(80):
                total += run_items(page)
                if page.locator("table.scores").count():
                    break
                label = page.locator("#act button").inner_text(); cur = page.locator("ol.steps li.cur").inner_text() if page.locator("ol.steps li.cur").count() else "?"
                if "--debug" in sys.argv: print("   step", repr(cur), "label", repr(label))
                if page.locator("#wt").count() and "done writing" in label:
                    page.fill("#wt", "Vorige zaterdag was ik vroeg wakker. Ik ging met de trein naar Utrecht, maar de trein had vertraging. Ik moest lang wachten en ik kwam te laat. Daarna werkte ik thuis.")
                act(page)
            else:
                raise RuntimeError("module did not reach the end")
            print(name, "items answered", total)
            st = page.evaluate("JSON.parse(localStorage.getItem('nl:state'))")
            m = st["mods"][mid]
            print(name, "scores", m["sc"], "done", bool(m.get("done")))
            errs = st["errs"]; print(name, "errors banked", len(errs), "words in srs", len(st["srs"]))
            assert m.get("done") and len(errs) > 0 and len(st["srs"]) >= 8 and st["writing"][mid]["words"] > 10
            # horizontal overflow check
            ov = page.evaluate("document.documentElement.scrollWidth - innerWidth")
            assert ov <= 0, f"{name}: horizontal overflow {ov}px"
            page.screenshot(path=f"/tmp/nl-{name}-end.png", full_page=False) if False else None
            # time travel 1 day: everything banked is due -> review
            # (go to the review first: the open page saves its state on the way, which would undo the time travel)
            page.goto(url + "/#/review")
            page.evaluate("""(()=>{const s=JSON.parse(localStorage.getItem('nl:state'));Object.values(s.errs).forEach(e=>e.due-=1);Object.values(s.srs).forEach(w=>w.due-=1);Object.values(s.gram||{}).forEach(g=>g.due-=1);localStorage.setItem('nl:state',JSON.stringify(s))})()""")
            page.reload()
            try:
                page.wait_for_selector("#run .item", timeout=8000)
            except Exception:
                print("REVIEW PAGE:", page.url, page.locator("#view").inner_text()[:400]); raise
            n = run_items(page, 200); print(name, "review items", n)
            page.goto(url + "/#/progress"); page.wait_for_selector(".bars")
            ov = page.evaluate("document.documentElement.scrollWidth - innerWidth"); assert ov <= 0, f"{name}: progress overflow {ov}px"
            page.goto(url + "/#/words"); page.wait_for_selector("ul.bank li")
            page.goto(url + "/#/grammar"); page.wait_for_selector("details.gref")
            ov = page.evaluate("document.documentElement.scrollWidth - innerWidth"); assert ov <= 0, f"{name}: grammar overflow {ov}px"
            page.goto(url + "/#/"); page.wait_for_selector(".card.rev")
            ctx.close()
        br.close()
    if errors:
        print("JS ERRORS:\n" + "\n".join(errors)); sys.exit(1)
    print("ALL OK")

main()
