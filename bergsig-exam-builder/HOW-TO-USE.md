# Bergsig Exam Builder — How to use it

A single file. No installation, no Python, no admin rights, nothing to set up on the
computer. It runs entirely inside Edge or Chrome on any standard Windows PC or laptop.

---

## First time only (about 5 minutes)

**1. Put the file somewhere sensible**
Copy `Bergsig-Exam-Builder.html` to your Documents folder, or the desktop.

**2. Open it**
Double-click it. It opens in Edge (or right-click → Open with → Google Chrome).
If Windows asks which app to use, pick Edge or Chrome — never Word or Notepad.

**3. Pin it so you can find it again**
With the app open in Edge, click the **⋯** menu (top right) → **More tools** →
**Pin to taskbar**. It then behaves like any other program: one click from the taskbar.

**4. Get an Anthropic API key**
Go to **console.anthropic.com**, sign in, open **API keys**, and click **Create key**.
Copy the key — it starts with `sk-ant-`. You only see it once, so paste it into the app
straight away.

You will also need to load some credit onto the account (**Billing** → **Add credits**).
A full six-document set costs roughly R10–R25 in API usage depending on the model.

**5. Save the key in the app**
Click **Settings** → paste the key → **Save key** → **Test connection**.
The badge at the top right should turn green and say *API key saved*.

The key is stored on that computer only, in that browser. It is never sent anywhere
except directly to Anthropic. If you use a different laptop, you enter it again there.

---

## Making a paper

### Step 1 — Paper details

Fill in the grade, subject, date, marks, duration and staff names. Two fields are worth
explaining:

- **Header month / year** — what prints in the running header on every page, e.g.
  `SEPTEMBER 2026`.
- **First question number** — leave at 1 for a standalone paper. Set it to **4** when the
  paper is a later section of a bigger exam, the way your Grade 9 papers are numbered
  (Questions 4–8, Section C).

### Step 2 — Where the content comes from

Four ways to work, matching how you actually set papers:

| Mode | What it does | When to use it |
|---|---|---|
| **From uploaded examples** | Reads last year's paper, copies its layout, question style and mark pattern, then writes completely new businesses, names, dates and figures | You have last year's paper and want the same thing again |
| **From my instructions** | No uploads at all. You just name the topics | "Create a Grade 11 paper on Subsidiary journals, Debtors and creditors ledger, General Ledger" |
| **Examples + my instructions** | Follows the uploaded layout, but covers the topics you name | Same format as last year, different content focus |
| **Follow a framework** | Treats an uploaded document as binding instructions — exactly what each question must contain | You've written a spec for the paper and want it followed to the letter |

For uploads, drop in `.docx` files (question paper, answer sheet, memo — all three is
best). Tap the **FRAMEWORK** tag on a file to mark it as binding instructions rather than
a style example. Files with "framework" or "raamwerk" in the name are tagged automatically.

### Step 3 — What to produce

Pick English, Afrikaans or both, and pick any combination of exam paper, answer sheet and
memo. Click **Generate documents**.

Watch the log. It reports each question as it is written, and — importantly — checks that
the memo ticks add up to that question's marks:

```
QUESTION 6: SUBSIDIARY JOURNALS done - 10 ticks for 10 marks ✓
```

If it says **(check this)** instead of ✓, that question's mark allocation needs a look
before you print.

Then download the files individually or all at once. They land in your normal Downloads
folder as ordinary Word documents.

---

## What comes out

Documents identical in style to your existing papers: Courgette school name, crest,
bordered EXAMINATION / GRADE boxes, dashed subject box, running header, "Please turn over"
footer, per-question mark boxes, landscape journal pages where they're needed, and the
closing TOTAL box.

The page counts printed on the cover ("consists of 6 pages and a 5 page answer book") are
calculated by the app, not guessed by the AI, so they are always right.

Everything opens in Word and is fully editable. Treat the output as a strong first draft —
always read it before it goes to a class.

---

## Save paper data (.json)

After generating, **Save paper data** writes a small `.json` file containing the entire
paper. Keep it alongside the Word files. It is useful for two things: it records exactly
what was generated, and it means a future version of this tool can rebuild or tweak that
same paper without spending any API credit.

---

## Choosing a model

| Model | Use it for |
|---|---|
| **Claude Opus 5** | Full exams. The most reliable accounting arithmetic — ledgers that balance, journals that cross-cast. This is the default and what I'd use for anything going to a class. |
| **Claude Sonnet 5** | Faster and cheaper, good for straightforward papers |
| **Claude Haiku 4.5** | Cheapest. Fine for a short class test |
| **Claude Fable 5** | Frontier tier. Only if your account has access |

Change it any time in **Settings** — it remembers your choice.

---

## If something goes wrong

**"Your API key was rejected"** — the key was mistyped or has been deleted in the console.
Create a new one and save it again.

**"Your Anthropic account is out of credit"** — top up at console.anthropic.com → Billing.

**"The model returned incomplete JSON"** — the response was cut off. The app retries three
times automatically; if it still fails, try again or switch to Opus 5.

**A question's ticks don't match its marks** — the log flags this. Open the memo and fix
that question by hand, or regenerate.

**Nothing happens when you double-click the file** — right-click → Open with → Microsoft
Edge. Windows sometimes associates `.html` with the wrong program.

**The layout looks wrong in Word** — check that the school name renders in the script font.
The font is embedded in every document, so it should work even on a computer that has
never seen Courgette.

---

## Sharing it with other staff

Copy the one file. That's the whole app. Each teacher enters their own API key on their own
machine the first time. Nothing else to install, and no server or network share required.
