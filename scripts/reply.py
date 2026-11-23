#!/usr/bin/env python3
"""Handle one Telegram request: simple commands edit tracker.md; anything else goes to Gemini (read-only)."""
import json, os, re, sys, urllib.request, datetime

TRACKER, REPORT = "tracker.md", "report.md"
MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
ACK = 9  # column index of Ack in a '|'-split row (leading '' at 0)

def rows(lines):
    return [i for i, l in enumerate(lines) if re.match(r"\| (20\d\d-|Date TBA|Week)", l)]

def cells(l):
    return [c.strip() for c in l.rstrip("\n").split("|")]

def words(s):
    return set(w for w in re.findall(r"[a-z0-9]+", s.lower()) if len(w) > 2)

def find(lines, key):
    idx = rows(lines)
    key = key.strip()
    if key.isdigit() and os.path.exists(REPORT):
        m = re.search(rf"^{key}\. (.*)$", open(REPORT).read(), re.M)
        if not m:
            return None
        key = m.group(1)
    kw = words(key)
    best, score = None, 0
    for i in idx:
        c = cells(lines[i])
        s = len(kw & words(" ".join(c[2:5])))
        if s > score:
            best, score = i, s
    return best if score else None

def set_ack(lines, i, val):
    c = cells(lines[i])
    while len(c) <= ACK + 1:
        c.insert(len(c) - 1, "")
    c[ACK] = val
    lines[i] = " | ".join(c[1:-1]).join(["| ", " |\n"]).replace("|  |", "| |")

def parse_date(s):
    s = s.strip().lower()
    today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=7))).date()
    m = re.match(r"(\d+)\s*d", s)
    if m:
        return today + datetime.timedelta(days=int(m.group(1)))
    days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    if s[:3] in days and len(s) <= 9:
        return today + datetime.timedelta(days=(days.index(s[:3]) - today.weekday()) % 7 or 7)
    for f in ("%Y-%m-%d", "%d %b"):
        try:
            d = datetime.datetime.strptime(s.title() if f != "%Y-%m-%d" else s, f)
            if f == "%d %b":
                d = d.replace(year=today.year)
            return d.date()
        except ValueError:
            pass
    return None

def gemini(q):
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return "Gemini key missing; only simple commands work (done/snooze/undo/report)."
    ctx = open(TRACKER).read()
    prompt = ("You are Jake's university assistant. Answer briefly in plain text for a phone, no tables. "
              "Use only the tracker below. Today is " + datetime.date.today().isoformat() + ".\n\n" + ctx + "\n\nQuestion: " + q)
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        data=json.dumps({"contents": [{"parts": [{"text": prompt}]}]}).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=60))
        return r["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception as e:
        return f"Gemini busy or unavailable ({type(e).__name__}); try again later."

def main():
    msg = open("request.txt").read().strip().splitlines()[-1] if os.path.getsize("request.txt") else ""
    m = re.match(r"(?i)^/?(done|snooze|undo)\s+(.+)$", msg)
    changed = False
    if re.match(r"(?i)^/?(report|list)$", msg):
        reply = open(REPORT).read() if os.path.exists(REPORT) else "No report yet."
    elif m:
        cmd, arg = m.group(1).lower(), m.group(2)
        until = None
        if cmd == "snooze":
            parts = re.sub(r"(?i)\s+(until|till|for|to)\s+", " ", arg).split()
            for n in (2, 1):
                if len(parts) > n and parse_date(" ".join(parts[-n:])):
                    until, arg = parse_date(" ".join(parts[-n:])), " ".join(parts[:-n])
                    break
            if not until:
                print("Usage: snooze <item or number> <date, e.g. fri, 5d, 2026-12-01>")
                open("reply.txt", "w").write("Usage: snooze <item or number> <date, e.g. fri, 5d, 2026-12-01>")
                return
        lines = open(TRACKER).read().splitlines(True)
        i = find(lines, arg)
        if i is None:
            reply = f"Couldn't match '{arg}' to a tracker item."
        else:
            name = cells(lines[i])[4]
            val = {"done": "done", "undo": "", "snooze": f"snoozed until {until}"}[cmd]
            set_ack(lines, i, val)
            open(TRACKER, "w").write("".join(lines))
            changed = True
            reply = {"done": f"Marked done: {name}", "undo": f"Cleared: {name}", "snooze": f"Snoozed until {until}: {name}"}[cmd]
    else:
        reply = gemini(msg)
    open("reply.txt", "w").write(reply)
    if changed:
        open("changed", "w").write("1")

main()
