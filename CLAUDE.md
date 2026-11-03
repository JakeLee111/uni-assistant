# 🎓 University Assistant

Mission: no missed deadlines in any course; one place to check everything.
Stamford International University, Term 2-2026 (Blackboard: https://learn.stamford.edu).
Time zone: Asia/Bangkok. Read-only: never submit, post, or send anything.

## Data
- GitHub Actions (`.github/workflows/session.yml`) keeps the Blackboard session alive hourly
  and scrapes Blackboard + Outlook at 07:40. Results are encrypted on the `session` branch:
  `latest.json.enc` (scrape), `state.enc` (cookies — never decrypt or print), `status.json`.
- Decrypt the scrape:
  `git fetch -q origin session && git show origin/session:latest.json.enc | openssl enc -d -aes-256-cbc -pbkdf2 -pass env:STATE_KEY > data/latest.json`
  (locally: `STATE_KEY="$(cat assistant/auth/key)"`).
- `tracker.md` on `main` is the memory between runs: every deadline, with the date it was first seen.

## Daily report (08:00)
1. Decrypt the scrape. Read `status.json`.
2. Update `tracker.md`:
   - Deadlines from grade columns (`due`), announcements and emails that mention a date
     (assignment, quiz, midterm, final, presentation, registration, payment).
   - "Posted" = Blackboard `created` date, or the date first seen. Never change it later.
   - Announcement changes a date → update the row, note "moved from <old>".
   - Mark items past due as done/missed; drop them from the report after 3 days.
3. Write the report in exactly this format, plain text, no tables:

```
Tue 4 Nov

URGENT
1. CS201 Lab 5 — due today 23:59
2. MATH210 Quiz 3 — Thu 6 Nov 10:00 · study tonight + Wed
3. Registrar email — confirm exam seat by 7 Nov ⚠️

UPCOMING
4. CS201 Midterm — 12 Nov (moved from 10 Nov) 📢
5. ENG101 Essay — 14 Nov

ANNOUNCEMENTS
• CS201: midterm moved to 12 Nov, covers ch. 1–6

Next: open the CS201 Lab 5 page → Blackboard > CS201 > Assignments
```

Rules:
- URGENT = 20% or less of the timeline (posted → due) is left, OR it needs an action from me.
  Sort by due date. Everything else goes under UPCOMING (next 30 days only).
- Dates short ("Thu 6 Nov"); add the time only when it matters (exams, same-day deadlines, non-midnight).
- Use short course codes (CSC353), not the long Blackboard names.
- Emoji only: ⚠️ = action needed, 📢 = something changed. Nothing else.
- Exams/quizzes: add a short "study …" hint (when to start). No full study plans.
- ANNOUNCEMENTS: only important ones (dates, exams, grading, rooms, cancellations). Skip greetings/generic.
- Emails: only from professors, TAs, registrar, finance, exams, student affairs, or anything with a deadline.
  Only emails received since `Last report` in tracker.md. Action needed → numbered item; FYI → a bullet
  under ANNOUNCEMENTS starting "Email:". Password-expiry emails are always ⚠️ (an expired password breaks the scraper).
  Ignore marketing, newsletters, trials. Flag obvious scams ("Earn $500/week") in one line as "ignore — phishing".
- If nothing is urgent, write "None" under URGENT.
- If `status.json` says signed-out, or `checkedAt` is older than 3 hours, or the scrape lists `signedOut`,
  start the report with: `⚠️ Sign in again: on your Mac run  cd ~/Desktop/"Personal Assistant"/university/assistant && npm run login && npm run push-session`
- End with one "Next:" line: the single most important thing to do today.
4. Set `Last report:` in tracker.md to now, then commit and push `tracker.md` to `main` ("tracker <date>").

## Later
- Grade calculator from each course's grading weights on Blackboard (not yet).
