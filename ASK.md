# ASK — manifest

> One screen for writing down what needs fixing, changing or building, and one
> button for filing it where the update protocol will find it.

---

## 1. What ASK is

A static page. No build step, no framework, no dependencies, no network except
the Todoist calls you explicitly ask for. Open `index.html` over http(s) and it
runs.

It exists because the requests were already going into Todoist by hand, one
task at a time, and the parts that matter — the gate label, the type label, the
`project:` and `tab:` line — are easy to get wrong at speed and expensive to get
wrong later. ASK is the form that cannot get them wrong.

**It is not a task manager and it is not a backlog.** It writes tasks into
Todoist and then forgets about them; what happens next is Todoist's and the
protocol's. Nothing here reads task state back, and the "sent" list is a
receipt, not a mirror.

### Three screens

| Screen | Does |
| --- | --- |
| **write** | the form: title, type, project, tab, priority, notes |
| **queue** | what has been written and not yet sent — editable, removable, and entirely local |
| **sent** | what this device has filed, newest first, with a link back to each task |

Both lists are read through **one** filter — a search, a project, a kind. One and
not two: "everything about hub" is a single question, and a queue narrowed to hub
beside a history showing everything is two answers to it. It says `n of m` while
it is hiding anything, and the send button goes on counting the whole queue,
because the whole queue is what it sends.

The split between *write* and *queue* is the whole design: a request is worth
writing down the moment you notice it, and worth **sending in a batch**, because
one run of the update protocol is one version however many requests were in it.
Six small tweaks sent together are one update, not six.

---

## 2. Files

```
ask/
├── index.html      all markup for all three screens and both sheets
├── ASK.md          this file
├── manifest.webmanifest
├── css/
│   ├── tokens.css  ROOT's token vocabulary, trimmed, plus four themes
│   └── ask.css     the frame, the screens, the pill and the sheets
├── js/
│   ├── store.js    the queue, the history, the settings, the key
│   ├── todoist.js  the API client and the intake contract — the only file that talks to the network
│   └── app.js      the three screens
├── test/
│   └── smoke.mjs   jsdom boot + behaviour checks; its one dev dependency is not part of the site
└── updates/        one file per shipped version, per _git-push/PROTOCOL.md
```

```
cd test && npm install && node smoke.mjs
```

jsdom has no layout, so the smoke answers the half of "did that come out right"
that does not need eyes. The Todoist client is not exercised there — it needs a
real key, and the first real send is the first real test of it.

Load order is `store → todoist → app`: the client reads the key from the store,
and the screens drive both.

---

## 3. The intake contract

This is the part that is not ASK's to invent. It belongs to
`_git-push/PROTOCOL.md`, and ASK's job is to satisfy it exactly.

| Field | What ASK writes |
| --- | --- |
| section | Inbox → **claude requests**, resolved by name and cached |
| labels | `claude` **+ exactly one** of `fix` / `change` / `feature` / `idea` |
| content | the title, **verbatim** |
| description | `project: <project> \| tab: <tab>` — the tab is asked for, and sent, only when the project is **root**; every other project is one app and files under `other`, which is what the protocol reads a missing tab as anyway |
| comment | the notes, if there are any |
| priority | p1–p4 in the UI, inverted for the API (p1 is Todoist's 4) |

The inbox is resolved to its **real project id** before anything is written.
The API will not accept the word `inbox` in place of one, and the 400 it answers
with says so only in the response body — see the changelog.

- **`claude` is the gate.** A task without it is never picked up.
- **Exactly one type label**, because the type decides the version bump: `fix`
  and `change` are patches, `feature` makes the whole batch a minor.
- **`idea` is not a fourth type**, it is the absence of a request — a thought
  written down where it will be seen again. It is listed and parked, never
  built, and never completed, because completing it would throw away the one
  thing it is for. The form says so when you pick it.
- **No type is not an error.** The protocol reads a missing type label as a
  `change`, so ASK lets it through and says what will happen instead of
  refusing to file it.

### The title is a record, not a draft

It is copied into the filled template and into the update log **word for word**,
lowercase and quirks included. Nothing here tidies it, and nothing should.

---

## 4. Sending

One task at a time, and **each request leaves the queue the moment it lands**.
A batch that dies halfway therefore leaves exactly the ones that did not send
still queued, so retrying cannot file the same request twice. That is the only
failure mode worth designing around here: a duplicate request becomes a
duplicate build.

The comment is best-effort. If the task is created and the comment fails, the
request is still filed and the note is lost — better than a retry that
duplicates the task to save a note.

---

## 5. Storage

| Key | Holds |
| --- | --- |
| `ask_v1` | `{ queue, sent }` — the sent list is capped at 200 |
| `ask_prefs_v1` | theme and accent, the nine shape dials (§10), default project and type, the project/tab lists, the key bindings, whether quick mode is on, and the filter the two lists share |
| `root_todoist_v1` | **ROOT's key, deliberately under ROOT's own name** — served from the same origin as ROOT, ASK needs nothing pasted in |

The key is never in an export. `export .md` writes the queue, the history and
the settings in the same fenced shape ROOT's exports use, so the two read alike.

---

## 6. Design

The token vocabulary is ROOT's, copied rather than shared: the two are separate
sites, and a stylesheet shared across repos is a dependency neither wants. The
names are the contract — anything written against ROOT's tokens reads the same
here.

Four themes instead of fifteen. This app is a form, not a place you live — and
one accent on top of them, which is yours to set. See §9.

**Everything is a block.** One radius scale, one filled surface per depth,
hairlines only where two blocks would otherwise merge, and no decoration that is
not a control. A picked chip is a solid colour and an unpicked one a solid
surface, with nothing in between to read. The interface font is the platform's
own, because a form you fill in on a phone should read like the phone; the mono
is kept for the two places where the characters themselves matter — a request
title, which is a verbatim record, and code.

The frame is ROOT 4.5's: past 560px the whole app is a phone-shaped box in the
middle of the screen, centred by a transform on `<body>` which also makes body
the containing block for its own `position:fixed` children — the pill, the
toast and both sheets land inside the box for free.

The four request types wear their Todoist label colours, so a chip here and a
label there are recognisably the same thing.

---

## 7. The keyboard

A roving cursor over the controls of the screen you are on. Left and right step
between the three screens and stop at the ends; up and down walk the controls;
the act key uses the selected one. Enter confirms a field and moves to the next,
and files the request from the last one — which deliberately takes Enter away
from the title textarea, since a newline in a request title is not a thing
anyone wants (shift+Enter still gives one).

Two rules carry it:

- **The focusable list is rebuilt on every move, never cached.** These screens
  re-render constantly and a cached list hands back detached nodes. A miss
  restarts at the top, so the cursor heals rather than breaks.
- **A text field is selected but not focused.** The bindings are letters, and a
  focused field would swallow them *and* type them. Space steps in; Enter or
  Escape steps back out. That is why the ring is a class rather than
  `:focus-visible` — on an unfocused field there is nothing to paint.

The five bindings are settings (`a`, `u`, `.`, `e`, space by default). The
arrows, Enter, Escape and Tab are built in and are not rebindable: they read the
same on every keyboard, so there is nothing to choose.

## 8. Quick mode

A switch in settings, off by default, and when it is on **it is the write
screen** — not an overlay over it, not a button you reach for. The long form
and the flow are two ways of writing the same request, and the toggle chooses
which one the app shows until it is toggled back.

One question at a time — request, kind, project, area, priority, note — and
**answering is advancing**: a digit picks a numbered answer, or the cursor keys
and the act key do; a text step takes Enter and lands with its field already
focused. There is no confirm button anywhere in it.

**Escape starts this request over**, at the first question, with the answers
cleared — there is nowhere to leave to in a permanent view, and the thing worth
undoing is a request that was never filed. Backspace is the small undo, one
question back, and in a text field it only does that once the field is empty.

**Filing does not leave either.** The note step files the request, clears it and
asks the first question again, so a run of requests is a run of answers with
nothing in between them. The first question carries how many the run has queued
so far, which is also the only sign on screen that the last one landed — the
queue is a screen away.

A filing the form rejects — an empty request line — keeps the question rather
than dropping out; the toast has already said what is missing.

### The answers fit the window

A list of thirteen tabs in one column runs off the bottom of a short window, and
a highlight that walks past the fold is a highlight you cannot see — which
breaks the list exactly when it is longest. So the layout is measured, in this
order: one column of full-size blocks, one column of smaller ones, as many
columns as the width allows, the same again smaller. The first shape whose rows
fit the space wins. Columns fill top to bottom, so **down** still means the next
answer and left and right step a column. If nothing fits — a very short window —
the last shape stands and the box scrolls with the selection scrolled into view,
which is the fallback rather than the plan.

### Two things it does not do

It is not a second form. Every step writes the same `draft` the long form uses
and files through the same `readForm()` / `Store.add()`, so there is one
definition of a request and the two cannot drift.

It does not hand back. Picking **other** as the project used to close the flow
and put the cursor in the long form's project field; with the flow *being* the
screen there is nothing to hand back to, so "other" grows the flow a question
and asks for the name in place. The one thing that does borrow the long form is
editing a queued request — an edit is a whole request at once, which is exactly
what quick mode is not — and saving it hands the screen back.

---

## 9. The accent

The theme sets the surfaces; the accent is one colour on top of them, and it is
yours. Ten presets and a colour picker in settings, kept as `#rrggbb` in prefs
and written onto `<html>` as an inline `--y` — the same custom property the
tokens mix `--yd`, `--yb` and `--y-fade` *from*, which is why one assignment
repaints the chips, the pill, the toast, the wordmark's stop and the quick
view's highlight together. Nothing in the app hardcodes the accent; that is the
rule that makes this a one-liner rather than a search.

`--on-y`, the ink on top of a filled block, is worked out from the colour's
brightness rather than stored. White on a yellow accent is unreadable and no one
should have to notice that themselves.

Empty means the theme's own, which is a different state from having chosen the
same colour the theme happened to have: only the first one follows when the
theme changes. It is applied in the same inline script that applies the theme,
before the first paint, because a preference read after the first paint is a
flash.

---

## 10. The shape

The theme sets the surfaces and the accent is one colour on top of them (§9);
past those, nine dials say what shape the app is. Everything here is a block, so
three of them reshape the whole thing: how much air a block gets (`--dens`), how
hard its corners are (`--r-base`), and whether there is a line between two of
them at all (`--bw`). The other six each change one kind of thing: what a request
card is made of, whether chips are blocks or pills, the request title's own face,
capitals on the small labels, the words under the pill's icons, and movement.

Every one is a custom property or a data attribute on `<html>`, which is the same
mechanism the accent uses and for the same reason: a change is one write and no
redraw. The reader lands on the default for a dial the store has never heard of,
which is exactly what an install upgrading into 1.4 is until its first write.

None of them is stored per screen. An app that looks different depending on where
you are in it is two apps.

## 11. Arriving with the request already written

`?title=…&type=fix&project=root&tab=do&prio=2&notes=…` fills the write screen in.
A Stream Deck key, a bookmark, a shortcut — anything that already knows what it
wants can open ASK on a form that is filled in.

Every field is optional, and an absent one is simply not set: **no type is a real
answer**, the one the protocol reads as a change, so `type=` and no `type` at all
are the same thing and neither is an error. A project the settings list has never
heard of becomes `other` with the name typed in, because a new repo is a real
request. Values this build does not have are dropped and the rest still lands —
the link is a convenience, and the form is still the form.

Two rules carry it, and both are about not filing twice:

- **It fills the form; it does not file anything.** A link that queued on its own
  would file a request every time the page was reloaded or restored.
- **The query is taken off the address** with `replaceState`, so a reload comes
  back to the form and not to the link, and a back button cannot re-arm it.

Quick mode is put away for that one request — a whole request handed over at once
is exactly what quick mode is not — and comes back when it is queued or cleared.
That is the same rule editing a queued request already followed.

---

## Changelog

### 1.4.0 — 2026-09-10 — icons in the pill, one filter over both lists, the shape is yours, and a key can open it filled in

- The pill is **icons**. Three names in a 310px bar is most of a phone's width
  spent saying what the shapes already say; the words come back under them from
  settings. The queue's glyph **becomes** its count the moment there is one,
  rather than carrying a badge over it.
- **`tab:` is ROOT's alone.** Every other project is one app, so the field is
  hidden as a whole and the request files under `other` — which is what the
  protocol already reads a missing tab as. Quick mode skips the question by the
  same test, so the two cannot drift. See §3.
- **One filter, read by the queue and the sent list alike** — a search, the
  projects actually in the list, and the four kinds. Tapping the live chip lifts
  it; an untyped request reads as a change here the way the protocol reads it;
  the bar says `n of m` while it is hiding anything, because a receipt that hides
  rows quietly is the one thing this must never be. The **send** button still
  counts the whole queue, because that is what it sends.
- **Nine shape dials** under a new *Shape* section: spacing, corners, hairlines,
  what a request card is made of, chips as blocks or pills, the request title's
  own face, capitals, words in the pill, and movement. Each is one property or
  one attribute on `<html>`, so a change costs no redraw — the shape the accent
  already had. See §10.
- **A request can arrive in the address** — `?title=…&type=…&project=…&tab=…`.
  It fills the form and files nothing, and the query is cleared off the address,
  because the one thing this app must never do is file a request twice. See §11.
  That is what todoist-deck v0.4.0 opens.
- 117 checks (32 added). The window fitting, the icons' balance and all nine
  shape dials still need eyes.

### 1.3.0 — 2026-09-10 — quick mode is a view, and the accent is yours

- Quick mode is no longer a detour: with it on it **is** the write screen, and
  it stays that way. No overlay, no button to reach for. See §8.
- Escape starts the current request over instead of leaving; backspace is the
  one-question undo.
- The answers are laid out to fit the window — smaller blocks, then columns,
  before anything scrolls — and the selection is always in view. That is the
  thing that was broken with thirteen tabs on a short screen.
- "Other" asks for the project name inside the flow rather than handing back to
  a form that is not on screen. Editing a queued request still borrows it.
- A custom accent in settings: ten presets, a colour picker, and the ink on top
  of it worked out rather than guessed. See §9.
- Everything is blocks — one radius scale, filled surfaces, the platform's own
  UI font, and the mono kept for the two places the characters matter: a request
  title and code.
- 84 checks (21 added). The window-fitting itself needs a browser.

### 1.2.1 — 2026-09-10 — quick mode stays open

- Filing no longer closes the flow: it clears and asks the first question again,
  so several requests are one run. Escape on that first question leaves.
- The first question carries the run's count and the way out.
- A rejected filing keeps the question instead of dropping out of the flow.
- 67 checks (4 added).

### 1.2.0 — 2026-09-09 — one field at a time

- Quick mode: one question per screen, each answered with a key and advancing
  on its own. See §8.
- Escape goes back a step, not out.
- The same draft and the same `Store.add` as the long form — one definition of
  a request, not two.
- 63 checks (14 added). The motion and the caret landing need a browser.

### 1.1.0 — 2026-09-09 — the form works without a mouse

- A roving cursor on the bindings the request named, with the arrows alongside.
  Screens on left/right, controls on up/down, the act key to use one.
- Enter confirms a field and moves on, and files the request at the end of the
  form. Shift+Enter still types a newline.
- All five bindings rebindable, capturing the next key pressed; a key already
  bound elsewhere is freed rather than shadowed.
- 49 checks. The cursor's movement itself needs a browser — jsdom has no
  `offsetParent`, so the list it walks is empty there. See §7.

### 1.0.1 — 2026-09-09 — the inbox has an id, and a 400 has to say why

- **Sending failed with a bare `400`.** The task POST carried
  `project_id: "inbox"` — the literal word. Some tooling accepts that as a
  convenience; the API does not, and it answers with a 400 whose reason is in
  the body. The inbox is now resolved to its real id off `/projects`
  (`inbox_project` / `is_inbox_project` / `inboxProject`, all three spellings,
  then the name as a last resort), and `/sections` is asked with that id too.
- **The error path was hiding the answer.** `throw new Error('Todoist error ' + status)`
  threw the one useful thing — the response body — away, which turned a
  one-line fix into a guess. Errors now read `Todoist 400: <what it said>`,
  whichever of the four shapes the body arrives in.
- **The smoke now watches the wire.** It stubs `fetch` and asserts on what is
  actually sent: a real project id, the resolved section, the gate plus exactly
  one type label, the verbatim title, the `project: | tab:` line, the inverted
  priority, and the note as a comment. Nothing before looked at the request,
  which is why nothing caught this.
- **The connection test stopped guessing at an endpoint.** It hit `/user`,
  which was never verified; it now uses `/projects` — the call the app already
  depends on — so a green test means sending will work.

### 1.0 — 2026-09-09 — the form that cannot get the labels wrong

- Three screens, one form. Write, queue, send in a batch.
- The intake contract from `_git-push/PROTOCOL.md`, enforced: the gate label,
  exactly one type, the `project: | tab:` description, notes as a comment.
- Each request leaves the queue as it lands, so a half-failed batch retries
  without duplicating.
- ROOT's tokens and frame; four themes.
- Export/import everything as one `.md`, minus the key.
