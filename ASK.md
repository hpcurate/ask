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
| description | `project: <project> \| tab: <tab>` |
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
| `ask_prefs_v1` | theme, default project and type, and the project/tab lists |
| `root_todoist_v1` | **ROOT's key, deliberately under ROOT's own name** — served from the same origin as ROOT, ASK needs nothing pasted in |

The key is never in an export. `export .md` writes the queue, the history and
the settings in the same fenced shape ROOT's exports use, so the two read alike.

---

## 6. Design

The token vocabulary is ROOT's, copied rather than shared: the two are separate
sites, and a stylesheet shared across repos is a dependency neither wants. The
names are the contract — anything written against ROOT's tokens reads the same
here.

Four themes instead of fifteen. This app is a form, not a place you live.

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

Off by default. With it on, a *quick add* button asks for one field at a time —
request, kind, project, area, priority, note — and **answering is advancing**: a
digit picks a numbered option, or the cursor keys and the act key do; a text step
takes Enter and lands with its field already focused. There is no confirm button
anywhere in the flow. Escape steps *back* one question rather than out, because
losing four answers to one mistyped key is how a fast path stops getting used.

It is not a second form. Every step writes the same `draft` the long form uses
and files through the same `readForm()` / `Store.add()`, so there is one
definition of a request and the two cannot drift.

The one hand-back: picking **other** as the project needs a name typed and the
flow has nowhere to type one, so it closes, carries the title over and puts the
cursor in the long form's project field.

---

## Changelog

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
