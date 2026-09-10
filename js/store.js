/* Store — the queue, the history, the settings and the key.
   Three keys, all local. The Todoist key is read from ROOT's own key first, so
   an install served from the same origin as ROOT needs nothing pasted in; if
   it is on its own origin, saving here writes ROOT's key name anyway, which
   costs nothing and means the two agree wherever they do share one. */
window.Store = (function () {
  'use strict';

  const K_DATA  = 'ask_v1';           // { queue:[], sent:[] }
  const K_PREFS = 'ask_prefs_v1';     // { theme, project, type, projects, tabs }
  const K_TOKEN = 'root_todoist_v1';  // ROOT's key, deliberately the same name

  /* The tab vocabulary is the protocol's, not an invention: these are the
     values `tab:` is allowed to take, plus `other` for anything shell-wide.
     Projects default to what actually exists in the ecosystem. */
  const DEFAULTS = {
    theme: 'void',
    project: 'root',
    type: '',
    projects: ['root', 'hub', 'ask', 'other'],
    tabs: ['do', 'log', 'plan', 'store', 'tend', 'track', 'learn', 'day',
           'create', 'tools', 'settings', 'search', 'other'],
    /* The five keys the cursor moves on. Rebindable for the same reason ROOT's
       are: the defaults are a guess about a layout, and a key that sits under
       the finger on one keyboard is nowhere near it on another. The arrows,
       Enter, Escape and Tab are built in and are not in here — those read the
       same everywhere, so there is nothing to choose. */
    keys: { left:'a', right:'u', up:'.', down:'e', act:' ' },
    /* Ask one field at a time instead of showing the whole form. Off by
       default: the long form is the one that shows you everything at once, and
       that is the right first impression. On, it replaces the write screen for
       as long as it is on — it is a mode, not a detour. */
    quick: false,
    /* An accent of your own, as `#rrggbb`. Empty means the theme's, which is
       the only reason this is a string and not a colour: "none chosen" and
       "chose the same colour the theme had" are different states, and only the
       first one follows the theme when the theme changes. */
    accent: '',
    /* ── the look, past the theme and the accent ────────────────────────────
       ROOT's appearance dials, cut down to the handful a form actually has a
       use for. Every one of them is either a data attribute or a custom
       property on <html>, so a change is one write and no redraw — the same
       rule the accent already follows.

       `radius`, `border` and `density` are the three that reshape *everything*,
       because everything here is a block; the rest each change one kind of
       thing. None of them is stored per screen: an app that looks different
       depending on where you are in it is two apps. */
    density: 1,          // --dens, 0.85–1.2
    radius:  12,         // --r-base in px, 0–22; 0 is a hard square
    border:  1,          // --bw in px, 0–2
    cards:   'outline',  // outline | fill | line — what a request card is made of
    chips:   'block',    // block | pill
    titleFont: 'mono',   // mono | ui — the request title's own face
    caps:    true,       // small labels in capitals, ROOT's --caps
    navLabels: false,    // words under the pill's icons as well as the icons
    motion:  true,       // transitions at all
    /* ── the queue and the sent list ────────────────────────────────────────
       Which requests those two screens show. Not a per-screen setting — the
       same filter reads both, because "everything about hub" is one question
       and answering it differently on two screens would be a bug. */
    filter: { project: '', type: '', q: '' },
  };

  const read = (k, fb) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? fb; } catch { return fb; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

  let data  = read(K_DATA, null) || { queue: [], sent: [] };
  let prefs = Object.assign({}, DEFAULTS, read(K_PREFS, null) || {});
  /* A stored record written before an action existed is missing that key, so
     the map is merged rather than replaced — the same rule the rest of prefs
     follows one level up. */
  prefs.keys = Object.assign({}, DEFAULTS.keys, prefs.keys || {});
  /* Same rule one level down: a stored filter written before a field existed
     is missing it, and an undefined filter field is one that silently matches
     nothing. */
  prefs.filter = Object.assign({}, DEFAULTS.filter, prefs.filter || {});

  const save      = () => write(K_DATA, data);
  const savePrefs = () => write(K_PREFS, prefs);

  const queue = () => data.queue;
  const sent  = () => data.sent;

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function add(req) {
    data.queue.push(Object.assign({ id: uid(), at: Date.now() }, req));
    save();
  }
  function update(id, patch) {
    const i = data.queue.findIndex(q => q.id === id);
    if (i < 0) return;
    data.queue[i] = Object.assign({}, data.queue[i], patch);
    save();
  }
  function remove(id) { data.queue = data.queue.filter(q => q.id !== id); save(); }
  function clearQueue() { data.queue = []; save(); }

  /* A sent request keeps the Todoist id, which is the only way back to the
     thing it became. Capped at 200 — this is a receipt, not an archive. */
  function markSent(req, taskId, url) {
    data.sent.unshift(Object.assign({}, req, { taskId, url, sentAt: Date.now() }));
    data.sent = data.sent.slice(0, 200);
    save();
  }
  function clearSent() { data.sent = []; save(); }

  const get = k => prefs[k];
  function set(k, v) { prefs[k] = v; savePrefs(); }

  function token() { return (read(K_TOKEN, null) || {}).token || ''; }
  function saveToken(t) { write(K_TOKEN, { token: t, saved: Date.now() }); }

  /* Everything this app holds, as one .md — the same shape ROOT's export uses,
     so the two read alike. The key is never in it. */
  const FENCE = '```ask';
  function exportText() {
    const body = { app: 'ask', kind: 'everything', version: 1,
                   written: Date.now(), data, prefs };
    return (
`# ASK — everything

${data.queue.length} queued · ${data.sent.length} sent · settings and lists.
Written ${new Date(body.written).toLocaleString()}.

The Todoist key is **not** in here.

${FENCE}
${JSON.stringify(body)}
\`\`\`
`);
  }
  function parseText(text) {
    const s = String(text || '');
    const a = s.indexOf(FENCE);
    const b = a < 0 ? -1 : s.indexOf('```', a + FENCE.length);
    if (a < 0 || b < 0) throw new Error('not an ASK file');
    let body;
    try { body = JSON.parse(s.slice(a + FENCE.length, b).trim()); }
    catch { throw new Error('that file is damaged'); }
    if (!body || body.app !== 'ask') throw new Error('not an ASK file');
    return body;
  }
  function restore(body) {
    if (body.data) { data = { queue: body.data.queue || [], sent: body.data.sent || [] }; save(); }
    if (body.prefs) {
      prefs = Object.assign({}, DEFAULTS, body.prefs);
      prefs.keys   = Object.assign({}, DEFAULTS.keys,   body.prefs.keys   || {});
      prefs.filter = Object.assign({}, DEFAULTS.filter, body.prefs.filter || {});
      savePrefs();
    }
  }
  const size = () => (localStorage.getItem(K_DATA) || '').length + (localStorage.getItem(K_PREFS) || '').length;

  return { DEFAULTS, queue, sent, add, update, remove, clearQueue, markSent, clearSent,
           get, set, token, saveToken, exportText, parseText, restore, size };
})();
