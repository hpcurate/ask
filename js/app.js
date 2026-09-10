/* ASK — three screens over one form.
   write → queue → sent, and nothing leaves the device until the queue is sent.
   That split is the whole design: a request is worth writing down the moment
   you notice it, and worth sending in a batch, because one run of the update
   protocol is one version however many requests were in it. */
(function () {
  'use strict';

  const $  = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* What each type means, in the words the protocol uses — the difference
     between `idea` and the rest is the one thing worth saying out loud. */
  const TYPE_SAYS = {
    fix:     'Something is broken or wrong. Ships as a patch.',
    change:  'It works, but it should work differently. Ships as a patch.',
    feature: "Something that isn't there yet. Makes the whole batch a minor.",
    idea:    'Parked. Read, listed, and deliberately not built — and never closed, '
           + 'because closing it would throw the idea away.',
  };

  /* ROOT is the only project with areas inside it; see paintForm. Read off the
     draft rather than the stored default, because the field has to appear and
     disappear as the project chips are tapped. */
  const isRoot = () => (draft.project || Store.get('project') || 'root') === 'root';

  let scr = 'write';
  let draft = { type: '', project: '', tab: '', prio: 4 };
  let editing = null;              // the queued id being edited, if any
  /* A request that arrived in the address. It borrows the long form back the
     way an edit does, for exactly one request — see paintQuick. */
  let linkMode = false;
  let sending = false;

  /* ── chrome ─────────────────────────────────────────────────────────── */

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
  }

  /* One dialog, promise-shaped. A confirm() anywhere else would be a bug for
     the same reason it is in ROOT: it stops the page and looks like the
     browser rather than the app. */
  let askDone = null;
  function confirm(title, body, yes) {
    $('#ask-ttl').textContent = title;
    $('#ask-body').innerHTML = body;
    $('#ask-yes').textContent = yes || 'yes';
    $('#ask-back').classList.add('on');
    $('#ask').classList.add('on');
    return new Promise(r => { askDone = r; });
  }
  function closeAsk(v) {
    $('#ask-back').classList.remove('on');
    $('#ask').classList.remove('on');
    const d = askDone; askDone = null;
    if (d) d(v);
  }
  $('#ask-yes').onclick = () => closeAsk(true);
  $('#ask-no').onclick  = () => closeAsk(false);
  $('#ask-back').onclick = () => closeAsk(false);

  function go(name) {
    if (name !== scr) clearSel();
    scr = name;
    $$('.scr').forEach(s => s.classList.toggle('on', s.id === 's-' + name));
    $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.scr === name));
    $('#body').scrollTop = 0;
    render();
    /* which of the two write screens is showing is a property of the screen you
       are on, so it is settled here rather than in three call sites */
    paintQuick();
  }
  $$('.tab').forEach(t => t.onclick = () => go(t.dataset.scr));

  /* The wordmark's number is whichever count the screen is about. */
  function paintCount() {
    const n = scr === 'sent' ? Store.sent().length : Store.queue().length;
    const box = $('#b-count');
    box.textContent = String(n);
    box.classList.toggle('zero', !n);
    /* The queue's glyph *becomes* its count. A badge over an icon is two
       things fighting for the same 22px, and of the two the number is the one
       worth having — an empty queue has nothing to say, so the icon stands. */
    const qn = Store.queue().length;
    const tn = $('#t-n');
    tn.textContent = String(qn);
    tn.hidden = !qn;
    const qt = $('.tab[data-scr="queue"]');
    if (qt) qt.classList.toggle('counting', !!qn);
  }

  /* ── chip groups ────────────────────────────────────────────────────── */

  function chipHTML(v, label, type) {
    return `<button class="chip" data-val="${esc(v)}"${type ? ` data-type="${esc(v)}"` : ''}>${esc(label)}</button>`;
  }
  function fillChips(sel, values) {
    $(sel).innerHTML = values.map(v => chipHTML(v, v)).join('');
  }
  function lightChips(sel, value) {
    $$(sel + ' .chip').forEach(c => c.classList.toggle('on', c.dataset.val === String(value)));
  }
  /* One delegated listener per group, so re-rendering a group never leaves a
     handler behind. */
  function onChips(sel, fn) {
    $(sel).addEventListener('click', e => {
      const c = e.target.closest('.chip');
      if (c) fn(c.dataset.val);
    });
  }

  function renderLists() {
    fillChips('#a-project', Store.get('projects'));
    fillChips('#a-tab', Store.get('tabs'));
    $('#set-def-project').innerHTML = Store.get('projects').map(v => chipHTML(v, v)).join('');
    lightChips('#a-project', draft.project);
    lightChips('#a-tab', draft.tab);
    lightChips('#set-def-project', Store.get('project'));
  }

  function paintForm() {
    lightChips('#a-type', draft.type);
    lightChips('#a-project', draft.project);
    lightChips('#a-tab', draft.tab);
    lightChips('#a-prio', draft.prio);
    $('#a-type-note').innerHTML = draft.type ? esc(TYPE_SAYS[draft.type]) : '';
    const other = $('#a-project-other');
    other.style.display = draft.project === 'other' ? 'block' : 'none';
    /* `tab:` is the area inside ROOT. Every other project is one app, so there
       is nothing for the field to name and thirteen chips of ROOT's vocabulary
       under a hub request is a question with no right answer. The protocol
       already reads a missing tab as `other`, which is what readForm sends. */
    $('#a-tab-f').hidden = !isRoot();
    $('#a-add').textContent = editing ? 'save the change' : 'add to the queue';
    /* an edit borrows the long form back for as long as it lasts */
    paintQuick();
  }

  onChips('#a-type', v => { draft.type = draft.type === v ? '' : v; paintForm(); });
  onChips('#a-project', v => { draft.project = v; paintForm(); });
  onChips('#a-tab', v => { draft.tab = draft.tab === v ? '' : v; paintForm(); });
  onChips('#a-prio', v => { draft.prio = +v; paintForm(); });

  function resetForm() {
    editing = null;
    draft = { type: Store.get('type') || '', project: Store.get('project') || '', tab: '', prio: 4 };
    $('#a-title').value = '';
    $('#a-notes').value = '';
    $('#a-project-other').value = '';
    paintForm();
  }


  /* ── arriving with a request already half-written ─────────────────────
     A Stream Deck key, a bookmark, a shortcut: anything that knows what it
     wants can open ASK with the request in the address and land on a form that
     is already filled in.

         ?title=…&type=fix&project=root&tab=do&prio=2&notes=…

     Every field is optional and an absent one simply is not set — "no type" is
     a real answer here, the one the protocol reads as a change, so an absent
     `type` and `type=` are the same thing and neither is an error.

     It fills the form; it does not file anything. A link that queued on its own
     would file a request every time the page was reloaded or restored, and the
     one thing this app must never do is file the same request twice. The
     query is cleared from the address for the same reason — a refresh comes
     back to the form you were looking at, not to the link that opened it. */
  function fromLink() {
    let q;
    try { q = new URLSearchParams(location.search); } catch { return false; }
    const has = k => q.has(k) && String(q.get(k)).trim() !== '';
    if (!['title','type','project','tab','prio','notes'].some(has)) return false;

    const clean = (k, max) => String(q.get(k) || '').trim().slice(0, max);
    const projects = Store.get('projects') || [];
    const tabs = Store.get('tabs') || [];

    if (has('project')) {
      const p = clean('project', 40);
      /* A project the settings list has never heard of is not refused — a new
         repo is a real request, and `other` is exactly the answer for one. It
         is typed into the other field so it reads as the deliberate choice it
         is rather than silently becoming root. */
      if (projects.includes(p)) draft.project = p;
      else { draft.project = 'other'; $('#a-project-other').value = p; }
    }
    if (has('type')) {
      const t = clean('type', 20);
      if (['fix','change','feature','idea'].includes(t)) draft.type = t;
    }
    if (has('tab')) {
      const t = clean('tab', 40);
      if (tabs.includes(t)) draft.tab = t;
    }
    if (has('prio')) {
      const n = parseInt(clean('prio', 2), 10);
      if (n >= 1 && n <= 4) draft.prio = n;
    }
    if (has('title')) $('#a-title').value = clean('title', 2000);
    if (has('notes')) $('#a-notes').value = clean('notes', 12000);

    /* Off the query and out of the history, so a reload is a reload of the
       form. replaceState rather than pushState: there is no state to go back
       to, and a back button that re-armed the link would be the same trap. */
    try { history.replaceState(null, '', location.pathname + location.hash); } catch {}
    return true;
  }

  function readForm() {
    const title = $('#a-title').value.trim();
    if (!title) { toast('the request needs a title'); $('#a-title').focus(); return null; }
    let project = draft.project || Store.get('project') || 'root';
    if (project === 'other') {
      project = $('#a-project-other').value.trim();
      if (!project) { toast('name the project'); $('#a-project-other').focus(); return null; }
    }
    /* No type is not an error: the protocol reads a missing type label as a
       change. Saying so beats a validation message. */
    return { title, type: draft.type || '', project,
             /* only ROOT has areas — anything else files under `other`, which
                is what the protocol reads a missing tab as anyway */
             tab: (project === 'root' && draft.tab) || 'other', prio: draft.prio || 4,
             notes: $('#a-notes').value.trim() };
  }

  $('#a-add').onclick = () => {
    const req = readForm();
    if (!req) return;
    if (editing) { Store.update(editing, req); toast('changed'); }
    else { Store.add(req); toast(req.type ? 'queued' : 'queued — no type, so it reads as a change'); }
    /* The link filled in exactly one request. Once it is queued the form is a
       blank form again, so quick mode — if it was on — comes back. */
    linkMode = false;
    resetForm();
    render();
    if (editing === null && scr === 'write') { /* stay put: the next one is usually right behind */ }
  };
  $('#a-clear').onclick = () => { linkMode = false; resetForm(); toast('cleared'); };

  /* ── the queue and the history ──────────────────────────────────────── */


  /* ── the filter ──────────────────────────────────────────────────────
     One filter, read by both the queue and the sent list. Not one per screen:
     "everything about hub" is one question, and a queue narrowed to hub beside
     a history showing everything is two answers to it.

     It is stored, because the reason to narrow a list is usually the reason
     you came back to it. It is also *visible* when it is on — a list quietly
     hiding rows is the one thing a receipt must never do — which is what the
     count on the bar is for. */
  const filter = () => Store.get('filter') || { project:'', type:'', q:'' };
  function setFilter(patch) {
    Store.set('filter', Object.assign({}, filter(), patch));
    render();
  }
  const filterOn = () => { const f = filter(); return !!(f.project || f.type || f.q); };

  function matches(r) {
    const f = filter();
    if (f.project && String(r.project || '') !== f.project) return false;
    /* An untyped request reads as a change, here as everywhere else — the
       protocol says so, so filtering for changes has to find it. */
    if (f.type && (r.type || 'change') !== f.type) return false;
    if (f.q) {
      const hay = [r.title, r.notes, r.project, r.tab].join(' ').toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    return true;
  }

  /* The bar. The projects offered are the ones actually *in* the list being
     filtered, not the settings list: a filter that offers a project with
     nothing under it is a filter that can only ever empty the screen. */
  function filterHTML(rows, total) {
    const f = filter();
    const projects = [...new Set(rows.map(r => r.project).filter(Boolean))].sort();
    const types = ['fix', 'change', 'feature', 'idea'];
    const chip = (kind, v, label, on) =>
      `<button class="fchip${on ? ' on' : ''}"${kind === 'type' && v ? ` data-type="${esc(v)}"` : ''}
               data-f="${kind}" data-v="${esc(v)}">${esc(label)}</button>`;
    return `<div class="filter${filterOn() ? ' on' : ''}">
      <div class="f-row">
        <input type="search" class="f-q" value="${esc(f.q)}" placeholder="find a request"
               spellcheck="false" aria-label="find a request">
        ${filterOn() ? `<button class="mini" data-f="clear" data-v="">clear</button>` : ''}
      </div>
      ${projects.length > 1 ? `<div class="f-chips">
        ${chip('project', '', 'every project', !f.project)}
        ${projects.map(p => chip('project', p, p, f.project === p)).join('')}
      </div>` : ''}
      <div class="f-chips">
        ${chip('type', '', 'every kind', !f.type)}
        ${types.map(t => chip('type', t, t, f.type === t)).join('')}
      </div>
      ${filterOn() ? `<div class="f-count">${rows.filter(matches).length} of ${total}</div>` : ''}
    </div>`;
  }

  /* One delegated listener for both bars, bound once — the bars themselves are
     rewritten on every render, so a handler on the bar would be a handler
     thrown away and re-added on every keystroke. */
  ['#q-list-wrap', '#h-list-wrap'].forEach(sel => {
    const box = $(sel); if (!box) return;
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      const k = b.dataset.f;
      if (k === 'clear') { setFilter({ project:'', type:'', q:'' }); return; }
      /* Tapping the one that is already on turns it off: a filter you can only
         change and never lift is one you clear by guessing. */
      const cur = filter()[k];
      setFilter({ [k]: cur === b.dataset.v ? '' : b.dataset.v });
    });
    box.addEventListener('input', e => {
      if (!e.target.classList.contains('f-q')) return;
      const at = e.target.selectionStart;
      setFilter({ q: e.target.value });
      /* render() rewrote the field, so the caret has to be put back — the
         alternative is a search box that jumps to the end on every letter. */
      const again = box.querySelector('.f-q');
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch {} }
    });
  });

  function cardHTML(r, opts) {
    const type = r.type || 'change';
    const meta = [r.project, r.tab, 'p' + r.prio].filter(Boolean).join(' · ');
    return `<div class="card" data-type="${esc(type)}">
      <div class="c-top">
        <span class="c-type">${esc(r.type || 'change (untyped)')}</span>
        <span class="c-meta">${esc(meta)}</span>
      </div>
      <div class="c-title">${esc(r.title)}</div>
      ${r.notes ? `<div class="c-notes">${esc(r.notes)}</div>` : ''}
      ${opts.acts ? `<div class="c-acts">
        <button class="mini" data-edit="${esc(r.id)}">edit</button>
        <button class="mini danger" data-del="${esc(r.id)}">remove</button>
      </div>` : `<div class="c-acts">
        <span class="c-meta">${esc(new Date(r.sentAt).toLocaleString())}</span>
        ${r.url ? `<a class="c-link mini" href="${esc(r.url)}" target="_blank" rel="noopener">open in todoist</a>` : ''}
      </div>`}
    </div>`;
  }

  /* Both lists are drawn the same way: the bar, then whatever survives it. The
     *send* button is deliberately not narrowed by the filter — it says how many
     are queued, not how many are on screen, because sending files the queue and
     a button that undercounted what it was about to do would be a trap. */
  function renderQueue() {
    const q = Store.queue();
    const show = q.filter(matches);
    $('#q-list-wrap').innerHTML = filterHTML(q, q.length) + (q.length
      ? (show.length
          ? `<div id="q-list">${show.map(r => cardHTML(r, { acts: true })).join('')}</div>`
          : '<div class="empty">nothing here matches.<br>clear the filter to see the rest.</div>')
      : '<div id="q-list"></div><div class="empty">nothing queued.<br>write one on the first tab.</div>');
    const btn = $('#q-send');
    btn.disabled = !q.length || sending;
    btn.textContent = sending ? 'sending…'
      : q.length ? `send ${q.length} to todoist` : 'send to todoist';
    $('#q-clear').hidden = !q.length;
  }

  function renderSent() {
    const h = Store.sent();
    const show = h.filter(matches);
    $('#h-list-wrap').innerHTML = filterHTML(h, h.length) + (h.length
      ? (show.length
          ? `<div id="h-list">${show.map(r => cardHTML(r, { acts: false })).join('')}</div>`
          : '<div class="empty">nothing here matches.<br>clear the filter to see the rest.</div>')
      : '<div class="empty">nothing sent from this device yet.</div>');
    $('#h-clear').hidden = !h.length;
  }

  $('#q-list-wrap').addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]');
    const dl = e.target.closest('[data-del]');
    if (ed) {
      const r = Store.queue().find(x => x.id === ed.dataset.edit);
      if (!r) return;
      editing = r.id;
      draft = { type: r.type, project: r.project, tab: r.tab, prio: r.prio };
      $('#a-title').value = r.title;
      $('#a-notes').value = r.notes || '';
      const known = Store.get('projects').includes(r.project);
      if (!known) { draft.project = 'other'; $('#a-project-other').value = r.project; }
      go('write');
      paintForm();
      toast('editing — saving puts it back in the queue');
      return;
    }
    if (dl) {
      Store.remove(dl.dataset.del);
      if (editing === dl.dataset.del) resetForm();
      render();
      toast('removed');
    }
  });

  $('#q-clear').onclick = async () => {
    const n = Store.queue().length;
    if (!n) return;
    if (await confirm('Clear the queue?',
      `${n} request${n === 1 ? '' : 's'} written but not sent. There is no way back.`, 'clear')) {
      Store.clearQueue(); resetForm(); render(); toast('queue cleared');
    }
  };
  $('#h-clear').onclick = async () => {
    if (await confirm('Clear the history?',
      'Only the local record goes — the tasks themselves stay in Todoist.', 'clear')) {
      Store.clearSent(); render(); toast('history cleared');
    }
  };

  /* Sending
     One at a time, and each one is removed from the queue the moment it lands.
     A batch that dies halfway therefore leaves exactly the ones that did not
     send still queued — retrying cannot duplicate what already went. */
  $('#q-send').onclick = async () => {
    if (sending) return;
    const q = Store.queue().slice();
    if (!q.length) return;
    if (!Store.token()) { toast('no Todoist key saved'); openSettings(); return; }

    const ideas = q.filter(r => r.type === 'idea').length;
    const ok = await confirm(`Send ${q.length} request${q.length === 1 ? '' : 's'}?`,
      `Filed in <b>inbox › claude requests</b> with <code>@claude</code> and their type labels.`
      + (ideas ? ` ${ideas} of them ${ideas === 1 ? 'is' : 'are'} an idea, which will be listed and parked rather than built.` : '')
      + ` This is the only step that leaves the device.`, 'send');
    if (!ok) return;

    sending = true; renderQueue();
    let done = 0, failed = null;
    for (const r of q) {
      try {
        const task = await Todoist.send(r);
        Store.markSent(r, task && task.id, task && task.url);
        Store.remove(r.id);
        done++;
        renderQueue();
      } catch (err) { failed = err; break; }
    }
    sending = false;
    render();
    if (failed) toast(`${done} sent · stopped: ${failed.message || failed}`);
    else { toast(`${done} filed in todoist`); go('sent'); }
  };

  /* ── settings ───────────────────────────────────────────────────────── */

  function openSettings() {
    $('#set-token').value = Store.token();
    $('#set-projects').value = Store.get('projects').join(', ');
    $('#set-tabs').value = Store.get('tabs').join(', ');
    lightChips('#set-theme', document.documentElement.dataset.theme);
    lightChips('#set-def-project', Store.get('project'));
    lightChips('#set-def-type', Store.get('type'));
    $('#set-size').textContent = `${Store.queue().length} queued · ${Store.sent().length} sent · ${Math.max(1, Math.round(Store.size() / 1024))} KB`;
    paintStatus(Store.token() ? 'key saved — test it to be sure' : 'no key yet', '');
    renderKeys();
    renderAccents();
    renderLook();
    paintQuick();
    $('#set-back').classList.add('on');
    $('#set').classList.add('on');
  }
  function closeSettings() {
    $('#set-back').classList.remove('on');
    $('#set').classList.remove('on');
  }
  function paintStatus(msg, kind) {
    const el = $('#set-status');
    el.textContent = msg;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  $('#b-set').onclick = openSettings;
  $('#b-where').onclick = openSettings;
  $('#set-close').onclick = closeSettings;
  $('#set-back').onclick = closeSettings;

  $('#set-save').onclick = () => {
    Store.saveToken($('#set-token').value.trim());
    paintStatus(Store.token() ? 'saved' : 'cleared', Store.token() ? 'ok' : '');
    toast('key saved');
  };
  $('#set-test').onclick = async () => {
    Store.saveToken($('#set-token').value.trim());
    paintStatus('checking…', '');
    try {
      const r = await Todoist.check();
      paintStatus(`connected · ${r.projects} projects · "${Todoist.SECTION}" found`, 'ok');
    } catch (err) { paintStatus(String(err.message || err), 'bad'); }
  };

  onChips('#set-theme', v => {
    document.documentElement.setAttribute('data-theme', v);
    Store.set('theme', v);
    lightChips('#set-theme', v);
    renderAccents();                       // the "theme's own" swatch just moved
  });
  onChips('#set-def-project', v => { Store.set('project', v); lightChips('#set-def-project', v); });
  onChips('#set-def-type', v => { Store.set('type', v); lightChips('#set-def-type', v); });

  const commaList = s => s.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  $('#set-projects').onchange = e => {
    const v = commaList(e.target.value);
    Store.set('projects', v.length ? v : Store.DEFAULTS.projects.slice());
    renderLists();
  };
  $('#set-tabs').onchange = e => {
    const v = commaList(e.target.value);
    Store.set('tabs', v.length ? v : Store.DEFAULTS.tabs.slice());
    renderLists();
  };

  $('#set-export').onclick = async () => {
    const text = Store.exportText();
    const name = `ask_${new Date().toISOString().slice(0, 10)}.md`;
    try {
      const file = new File([text], name, { type: 'text/markdown' });
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file] }); return; }
      if (navigator.share) { await navigator.share({ title: name, text }); return; }
    } catch (err) { if (err && err.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    a.download = name; a.click();
    toast('wrote ' + name);
  };
  $('#set-import').onclick = () => $('#set-file').click();
  $('#set-file').onchange = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      e.target.value = '';
      let body;
      try { body = Store.parseText(reader.result); }
      catch (err) { toast(String(err.message || err)); return; }
      const q = (body.data && body.data.queue || []).length;
      const s = (body.data && body.data.sent || []).length;
      if (await confirm('Restore this file?',
        `${q} queued and ${s} sent, plus its settings. What is on this device now is replaced.`, 'restore')) {
        Store.restore(body);
        location.reload();
      }
    };
    reader.readAsText(file);
  };

  /* ── quick mode ───────────────────────────────────────────────────────
     One question at a time, asked in order, each one moving on the moment it
     is answered — and when it is on, this *is* the write screen. Not a modal
     and not a detour: the toggle in settings swaps which of the two ways of
     writing a request the app shows, and it stays swapped until it is swapped
     back. That is the difference between a shortcut you reach for and a mode
     you work in.

     It is **not a second form**: every step writes into the same `draft` the
     long form uses and the last one hands it to the same `readForm()` and
     `Store.add()`, so there is one definition of what a request is and no
     chance of the two drifting.

     What makes it fast is that answering *is* advancing. A chip step needs one
     key — a digit, or the cursor keys and the act key — and there is no
     confirm button to reach for. A text step takes Enter. Escape starts the
     current request over at the first question rather than leaving, because in
     a permanent view there is nowhere to leave to; backspace on an answered
     question is the small undo, one question back. */
  const QSTEPS = [
    { k:'title', kind:'text', ask:'What is it?',
      hint:'exactly as you would say it — this is copied into the log word for word' },
    { k:'type', kind:'chips', ask:'What kind?',
      opts: () => [['fix','fix'],['change','change'],['feature','feature'],['idea','idea'],['','no type']] },
    { k:'project', kind:'chips', ask:'Which project?',
      opts: () => Store.get('projects').map(p => [p, p]) },
    /* Only when the project step landed on "other". Handing back to the long
       form to type the name was fine while quick mode was a detour from it,
       and there is nothing to hand back to now that it is the screen itself. */
    { k:'other', kind:'text', ask:'Name the project.', when: () => draft.project === 'other',
      hint:'the repo it belongs to, spelled as you would type it in the form' },
    /* Only ROOT has areas inside it, so only a ROOT request is asked. The
       long form hides the same field for the same reason — see paintForm. */
    { k:'tab', kind:'chips', ask:'Which area?', when: () => isRoot(),
      opts: () => Store.get('tabs').map(t => [t, t]) },
    { k:'prio', kind:'chips', ask:'How urgent?',
      opts: () => [[1,'p1 · now'],[2,'p2'],[3,'p3'],[4,'p4 · whenever']] },
    { k:'notes', kind:'text', ask:'Anything else?',
      hint:'optional — posted as a comment. Enter files it.' },
  ];
  /* The steps this request actually has. Recomputed rather than stored: the
     one conditional step hangs off an answer two questions back, and a cached
     list is a list that disagrees with the draft. */
  const qSteps = () => QSTEPS.filter(s => !s.when || s.when());
  /* A text step edits the long form's own field — that is what "not a second
     form" means in practice. */
  const QFIELD = { title:'#a-title', notes:'#a-notes', other:'#a-project-other' };

  let qAt = 0;           // which question
  let qPick = 0;         // the highlighted answer on a chips step
  let qDone = 0;         // how many this run has filed, for the first hint
  let qRows = 0;         // rows the answers were laid out in, for the cursor

  const sheetOpen = () => $('#set').classList.contains('on') || $('#ask').classList.contains('on');
  /* Editing a queued request is the one thing that puts the long form back for
     a moment: an edit is a whole request at once, which is exactly what quick
     mode is not. */
  /* Quick mode is put away while a whole request is on the form at once —
     while one is being edited, and while one arrived in the address. Both are
     the same case: a request answered one question at a time is the thing quick
     mode is for, and neither of these is one. */
  const quickOn = () => !!Store.get('quick') && !editing && !linkMode;
  const qOpen   = () => quickOn() && scr === 'write' && !sheetOpen();

  /* The view is pinned between the band and the pill, and the band's height
     depends on the safe area and on the font that loaded, so it is measured
     rather than guessed at. */
  function measureBand() {
    const h = $('#band').offsetHeight;
    if (h) document.documentElement.style.setProperty('--band-h', h + 'px');
  }

  function paintQuick() {
    const on = quickOn() && scr === 'write';
    const was = $('#q-wrap').classList.contains('on');
    document.body.classList.toggle('q-mode', on);
    $('#q-wrap').classList.toggle('on', on);
    const b = $('#set-quick');
    if (b) { b.textContent = Store.get('quick') ? 'on' : 'off'; b.classList.toggle('on', !!Store.get('quick')); }
    if (on) { measureBand(); if (!was) drawQuick(); }
  }

  /* The first question is where a request is started over, and after a filing
     it is also the only sign on screen that the last one landed — the queue is
     a screen away — so it carries the count. */
  function qHint(st) {
    const base = st.hint || 'a key answers it — it moves on by itself';
    if (qAt !== 0) return base + ' · backspace goes back one';
    return (qDone ? qDone + ' queued in a row · ' : '') + base;
  }

  function drawQuick() {
    const list = qSteps();
    qAt = Math.max(0, Math.min(qAt, list.length - 1));
    const st = list[qAt];
    if (!st) return;
    $('#q-dots').innerHTML = list.map((_, i) =>
      `<i class="${i < qAt ? 'done' : i === qAt ? 'on' : ''}"></i>`).join('');
    $('#q-ask').textContent = st.ask;
    $('#q-hint').textContent = qHint(st);

    if (st.kind === 'text') {
      const box = document.createElement('textarea');
      box.className = 'q-field'; box.id = 'q-in'; box.spellcheck = false;
      box.value = $(QFIELD[st.k]).value;
      if (st.k === 'title') box.placeholder = 'the pill bar should stay put while a sheet is open';
      $('#q-step').replaceChildren(box);
      /* Focused with the caret at the end, so the question is answerable the
         instant it lands — unless something modal is over it, which is the one
         time taking the caret would be rude. */
      setTimeout(() => {
        if (sheetOpen() || !box.isConnected) return;
        try { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } catch {}
      }, 20);
      return;
    }

    const opts = st.opts();
    $('#q-step').innerHTML = `<div class="q-opts" id="q-opts">${opts.map(([v, l], i) => `
      <button class="q-opt${i === qPick ? ' on' : ''}" data-q="${esc(v)}" data-i="${i}">
        <span class="q-n">${i < 9 ? i + 1 : ''}</span><span class="q-l">${esc(l)}</span>
      </button>`).join('')}</div>`;
    $$('#q-opts .q-opt').forEach(b => b.onclick = () => quickAnswer(b.dataset.q));
    fitOpts();
    showPick();
  }

  /* Fit the answers to the window rather than the window to the answers.
     Thirteen tabs in one column ran off the bottom of a short window, and the
     highlight could walk somewhere there was no way to see it — which breaks
     the list exactly when it is longest. So: measure one block, work out how
     many rows the space actually holds, and spill into as many columns as that
     takes, filled top to bottom so "down" still means the next answer. Columns
     are capped by width, because three slivers are worse than a short scroll,
     and a scroll still keeps the highlight in view. Where there is no layout to
     measure — a headless run — it stays one column. */
  function fitOpts() {
    const box = $('#q-opts'); if (!box) return;
    const items = Array.from(box.children);
    const gap = 8;

    /* One shape: how many columns, and whether the blocks are the smaller
       kind. Column-major, because "down" has to keep meaning the next answer
       however the answers are arranged. */
    const apply = (cols, tight) => {
      box.classList.toggle('tight', tight);
      if (cols < 2) {
        qRows = items.length;
        box.style.gridTemplateColumns = '1fr';
        box.style.gridTemplateRows = '';
        box.style.gridAutoFlow = 'row';
        return;
      }
      qRows = Math.ceil(items.length / cols);
      box.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      box.style.gridTemplateRows = `repeat(${qRows}, max-content)`;
      box.style.gridAutoFlow = 'column';
    };

    apply(1, false);
    if (items.length < 2) return;
    const space = box.clientHeight;
    if (!space || !items[0].offsetHeight) return;      // nothing to measure: one column
    const rowsThatFit = () => Math.max(1, Math.floor((space + gap) / (items[0].offsetHeight + gap)));
    const wide = Math.max(1, Math.floor((box.clientWidth + gap) / (124 + gap)));

    /* Four rungs, in the order they are worth having: one column of full-size
       blocks; one column of smaller ones; as many columns as the width allows;
       the same again, smaller. The first whose rows fit the window wins. If
       none do — a very short window, or a very long list — the last one stands
       and the box scrolls, with the highlight scrolled into view, which is the
       part that was actually broken. */
    for (const [cols, tight] of [[1, false], [1, true], [wide, false], [wide, true]]) {
      apply(cols, tight);
      if (Math.ceil(items.length / cols) <= rowsThatFit()) return;
    }
    apply(wide, true);
  }

  /* Moving the highlight repaints two classes rather than redrawing the list:
     a redraw restarts the landing animation and throws away the layout that
     was just measured, twice a keypress. */
  function movePick(step) {
    const box = $('#q-opts'); if (!box) return;
    const n = box.children.length; if (!n) return;
    qPick = ((qPick + step) % n + n) % n;
    showPick();
  }
  function showPick() {
    const box = $('#q-opts'); if (!box) return;
    Array.from(box.children).forEach((el, i) => el.classList.toggle('on', i === qPick));
    const el = box.children[qPick];
    /* whatever is selected is on screen, however many answers there are and
       however short the window is — the reason the layout is measured at all */
    if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {} }
  }

  /* One answer, then straight on. The last question files it and asks the
     first one again. */
  function quickAnswer(v) {
    const st = qSteps()[qAt];
    if (!st) return;
    if (st.kind === 'text') $(QFIELD[st.k]).value = String(v);
    else if (st.k === 'prio') draft.prio = +v;
    else draft[st.k] = String(v);
    if (st.kind === 'chips') paintForm();       // the long form holds the same draft

    /* Answering "other" grows the flow by a question and answering it back
       shrinks it again, so where "next" is depends on the answer just given. */
    const list = qSteps();
    if (qAt >= list.length - 1) { quickFile(); return; }
    qAt++; qPick = 0;
    drawQuick();
  }

  /* Filing does not leave. Quick mode is a mode: it files, clears and comes
     straight back to the first question, so a run of requests is a run of
     answers with nothing in between them. */
  function quickFile() {
    const req = readForm();
    /* A missing title cannot be fixed from here, so a rejected filing keeps
       the flow and puts the question back — readForm's toast has already said
       what is wrong. */
    if (!req) { qAt = 0; qPick = 0; drawQuick(); return; }
    Store.add(req);
    resetForm();
    render();
    qDone++;
    qAt = 0; qPick = 0;
    drawQuick();
    toast(req.type ? 'queued — next one' : 'queued — no type, so it reads as a change');
  }

  /* Escape: this request, from the top. Not "back one" and not "out" — there
     is no out — and never the queue: what it throws away is a request that was
     never filed. */
  function quickReset(say) {
    resetForm();
    qAt = 0; qPick = 0;
    drawQuick();
    if (say) toast('started over');
  }
  function quickBack() {
    if (qAt <= 0) return;
    qAt--; qPick = 0;
    drawQuick();
  }

  function quickKey(e) {
    const st = qSteps()[qAt];
    if (!st) return;
    if (e.key === 'Escape') { e.preventDefault(); quickReset(true); return; }

    if (st.kind === 'text') {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); quickAnswer($('#q-in').value.trim()); }
      /* Backspace in a field is a backspace. It only goes back a question when
         there is nothing left in the field to delete. */
      if (e.key === 'Backspace' && !$('#q-in').value) { e.preventDefault(); quickBack(); }
      return;                                   // everything else is typing
    }

    const opts = st.opts();
    const map = Store.get('keys') || {};
    const k = e.key.toLowerCase();
    if (e.key === 'Backspace') { e.preventDefault(); quickBack(); return; }
    if (/^[1-9]$/.test(e.key) && +e.key <= opts.length) {
      e.preventDefault(); quickAnswer(opts[+e.key - 1][0]); return;
    }
    if (e.key === 'ArrowDown'  || k === map.down)  { e.preventDefault(); movePick(1); return; }
    if (e.key === 'ArrowUp'    || k === map.up)    { e.preventDefault(); movePick(-1); return; }
    /* Left and right step a column when the answers spilled into columns, and
       land back where they started when they did not. */
    if (e.key === 'ArrowRight' || k === map.right) { e.preventDefault(); movePick(qRows || 1); return; }
    if (e.key === 'ArrowLeft'  || k === map.left)  { e.preventDefault(); movePick(-(qRows || 1)); return; }
    if (e.key === 'Enter' || k === map.act)        { e.preventDefault(); quickAnswer(opts[qPick][0]); return; }
  }

  $('#set-quick').onclick = () => {
    Store.set('quick', !Store.get('quick'));
    if (Store.get('quick')) { qDone = 0; qAt = 0; qPick = 0; }
    paintQuick();
    toast(Store.get('quick') ? 'quick mode on — it is the write screen now' : 'quick mode off');
  };

  /* A window that changes size changes how many answers fit in it, and the
     view is pinned to two pieces of chrome whose heights move with it. */
  window.addEventListener('resize', () => {
    if (!qOpen()) return;
    measureBand(); fitOpts(); showPick();
  });

  /* ── the accent ───────────────────────────────────────────────────────
     One custom property carries it. The tokens mix --yd, --yb and --y-fade
     *from* var(--y), so overriding --y on <html> repaints the chips, the pill,
     the toast, the wordmark's stop and the quick view's highlight in one
     assignment — which is why none of them hardcode a colour.

     --on-y, what sits on top of a filled block, is worked out from brightness
     rather than stored: white on a yellow accent is unreadable, and nobody
     should have to notice that themselves. */
  const ACCENTS = ['#a78bfa', '#7aa2f7', '#38bdf8', '#2dd4bf', '#4ade80',
                   '#facc15', '#fb923c', '#f87171', '#f472b6', '#e879f9'];
  function onColor(hex) {
    const h = String(hex || '').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    if (!isFinite(n)) return '#ffffff';
    const lum = ((n >> 16 & 255) * 299 + (n >> 8 & 255) * 587 + (n & 255) * 114) / 1000;
    return lum > 150 ? '#0e0e0e' : '#ffffff';
  }
  function applyAccent(hex) {
    const root = document.documentElement;
    if (hex) { root.style.setProperty('--y', hex); root.style.setProperty('--on-y', onColor(hex)); }
    else { root.style.removeProperty('--y'); root.style.removeProperty('--on-y'); }
  }
  function renderAccents() {
    const box = $('#set-accent'); if (!box) return;
    const now = (Store.get('accent') || '').toLowerCase();
    box.innerHTML =
      `<button class="acc-dot def${now ? '' : ' on'}" data-acc="" title="the theme's own"></button>`
      + ACCENTS.map(c => `<button class="acc-dot${now === c ? ' on' : ''}" data-acc="${c}" style="--c:${c}" title="${c}"></button>`).join('');
    box.querySelectorAll('.acc-dot').forEach(b => b.onclick = () => setAccent(b.dataset.acc));
    $('#set-accent-now').textContent = now || "the theme's own accent";
    if (now) $('#set-accent-custom').value = now;
  }
  function setAccent(hex) {
    const v = (hex || '').toLowerCase();
    Store.set('accent', v);
    applyAccent(v);
    renderAccents();
    toast(v ? 'accent ' + v : 'accent back to the theme');
  }
  /* Dragging the picker previews without writing anything; letting go keeps
     it. A store write and a toast per frame is what the other way costs. */
  $('#set-accent-custom').oninput  = e => applyAccent(e.target.value);
  $('#set-accent-custom').onchange = e => setAccent(e.target.value);
  $('#set-accent-reset').onclick   = () => setAccent('');


  /* ── the look ────────────────────────────────────────────────────────
     Every dial here is either a data attribute or a custom property on
     <html>, so changing one is a single write and no redraw at all — the same
     shape the accent already had, extended to the rest. That is why there is
     no `renderLook()`: there is nothing to re-render.

     `applyLook` is called at boot and after any change, and it is written to
     be safe to call with a store that has never heard of these keys — an
     install upgrading into 1.4 has exactly that store until the first write. */
  const LOOK_RANGE = {
    density: { min:0.85, max:1.2,  step:0.01, def:1  },
    radius:  { min:0,    max:22,   step:1,    def:12 },
    border:  { min:0,    max:2,    step:0.5,  def:1  },
  };
  const lookNum = k => {
    const r = LOOK_RANGE[k];
    const n = parseFloat(Store.get(k));
    return isFinite(n) ? Math.min(r.max, Math.max(r.min, n)) : r.def;
  };
  function applyLook() {
    const root = document.documentElement;
    const st = root.style;
    st.setProperty('--dens', String(lookNum('density')));
    st.setProperty('--r-base', lookNum('radius') + 'px');
    st.setProperty('--bw', lookNum('border') + 'px');
    root.dataset.cards     = ['outline','fill','line'].includes(Store.get('cards')) ? Store.get('cards') : 'outline';
    root.dataset.chips     = Store.get('chips') === 'pill' ? 'pill' : 'block';
    root.dataset.titleFont = Store.get('titleFont') === 'ui' ? 'ui' : 'mono';
    root.dataset.caps      = Store.get('caps') === false ? 'off' : 'on';
    root.dataset.navLabels = Store.get('navLabels') ? 'on' : 'off';
    root.dataset.motion    = Store.get('motion') === false ? 'off' : 'on';
  }

  /* One row per dial, and the readout is part of the label rather than a
     number floating beside it — a slider whose value you have to hunt for is a
     slider you set by feel and then leave alone. */
  function lookRow(k, label, note, fmt) {
    const r = LOOK_RANGE[k], v = lookNum(k);
    return `<div class="slide-row" data-look="${k}">
      <div class="slide-head">
        <span class="row-l">${esc(label)}<small>${esc(note)}</small></span>
        <span class="slide-v">${esc(fmt(v))}</span>
      </div>
      <input type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}"
             aria-label="${esc(label)}">
    </div>`;
  }
  const pickRow = (k, label, note, opts) => `<div class="f" data-pick="${k}">
      <label class="lbl">${esc(label)}${note ? ` <em>${esc(note)}</em>` : ''}</label>
      <div class="chips">${opts.map(([v, l]) =>
        `<button class="chip${String(Store.get(k)) === v ? ' on' : ''}" data-val="${esc(v)}">${esc(l)}</button>`).join('')}</div>
    </div>`;
  const swRow = (k, label, note) => `<div class="row" data-sw="${k}">
      <span class="row-l">${esc(label)}<small>${esc(note)}</small></span>
      <button class="key-cap">${Store.get(k) === false ? 'off' : Store.get(k) ? 'on' : 'off'}</button>
    </div>`;

  function renderLook() {
    const box = $('#set-look'); if (!box) return;
    box.innerHTML =
      lookRow('density', 'Spacing', 'how much air every block gets', v => Math.round(v * 100) + '%') +
      lookRow('radius',  'Corners', '0 is a hard square; everything here is a block, so this is the whole shape',
              v => Math.round(v) + 'px') +
      lookRow('border',  'Hairlines', 'the line between two blocks — 0 lets the surfaces do it alone',
              v => v + 'px') +
      pickRow('cards', 'Request cards', 'what a queued or sent request is drawn as',
              [['outline','outlined'], ['fill','filled'], ['line','a rule']]) +
      pickRow('chips', 'Chips', 'the picker blocks', [['block','blocks'], ['pill','pills']]) +
      pickRow('titleFont', 'Request title', 'the one place the characters themselves matter',
              [['mono','mono'], ['ui','the interface font']]) +
      swRow('caps', 'Small labels in capitals', 'the section heads and the field labels') +
      swRow('navLabels', 'Words in the pill', 'the names under the icons as well as the icons') +
      swRow('motion', 'Movement', 'every transition in the app at once');

    box.querySelectorAll('[data-look] input').forEach(inp => {
      const k = inp.closest('[data-look]').dataset.look;
      /* Live while it moves, stored when it lands: a write and a re-render per
         frame is what the other way costs, and the app is already repainted by
         the property itself. */
      inp.oninput = () => {
        Store.set(k, parseFloat(inp.value));
        applyLook();
        const out = inp.closest('.slide-row').querySelector('.slide-v');
        if (out) out.textContent = k === 'density' ? Math.round(parseFloat(inp.value) * 100) + '%'
                                 : k === 'radius' ? Math.round(parseFloat(inp.value)) + 'px'
                                 : inp.value + 'px';
      };
    });
    box.querySelectorAll('[data-pick]').forEach(f => {
      const k = f.dataset.pick;
      f.addEventListener('click', e => {
        const c = e.target.closest('.chip'); if (!c) return;
        Store.set(k, c.dataset.val);
        applyLook(); renderLook();
      });
    });
    box.querySelectorAll('[data-sw]').forEach(r => {
      const k = r.dataset.sw;
      r.querySelector('.key-cap').onclick = () => {
        Store.set(k, Store.get(k) === false ? true : !Store.get(k));
        applyLook(); renderLook();
      };
    });
  }

  $('#set-look-reset').onclick = () => {
    ['density','radius','border','cards','chips','titleFont','caps','navLabels','motion']
      .forEach(k => Store.set(k, Store.DEFAULTS[k]));
    applyLook(); renderLook();
    toast('the look is back to default');
  };

  /* ── the keyboard ────────────────────────────────────────────────────
     A roving cursor over the controls of the screen you are on. Two decisions
     carry the whole thing:

     The list is rebuilt on every move rather than cached. These screens
     re-render on every change — a chip picked, a request queued, a card
     removed — and a cached list hands back nodes that have left the document.
     A miss simply restarts at the top, so the cursor heals rather than breaks.

     A text field is **selected but not focused**. The bindings are letters; a
     focused field would both swallow them and type them. The cursor stops on
     the field wearing the ring, the act key steps into it, and Enter or Escape
     steps back out. That is also why the ring is a class and not
     :focus-visible — see ask.css. */
  const FOCUSABLE = 'button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])';
  let sel = null;

  const isField = el => !!(el && el.matches && el.matches('input,textarea,select'));

  /* Whatever owns the keyboard right now: an open sheet, else the screen. A
     sheet is modal, so the cursor must not be able to walk out from under it. */
  function scope() {
    if ($('#ask').classList.contains('on')) return $('#ask');
    if ($('#set').classList.contains('on')) return $('#set');
    return $('#s-' + scr);
  }
  function focusables() {
    const box = scope();
    if (!box) return [];
    return Array.from(box.querySelectorAll(FOCUSABLE))
      .filter(el => !el.disabled && el.offsetParent !== null);
  }
  function clearSel() { if (sel) sel.classList.remove('kb-sel'); sel = null; }

  function moveSel(step) {
    const list = focusables();
    if (!list.length) { clearSel(); return; }
    const at = sel ? list.indexOf(sel) : -1;
    const i = at < 0 ? (step > 0 ? 0 : list.length - 1)
                     : (at + step + list.length) % list.length;
    clearSel();
    sel = list[i];
    sel.classList.add('kb-sel');
    try { sel.scrollIntoView({ block: 'nearest' }); } catch {}
    if (!isField(sel)) { try { sel.focus({ preventScroll: true }); } catch {} }
  }

  /* Answers whether it did anything, so the act key with nothing selected is
     still whatever the browser makes of it. */
  function actOnSel() {
    if (!sel || !sel.isConnected) { clearSel(); return false; }
    if (isField(sel)) { try { sel.focus(); } catch {} return true; }
    sel.click();
    return true;
  }

  /* Enter inside a field: confirm it and go to the next one — and file the
     request when there is no next one, which is what "enter to add to queue
     when at the bottom of the form" means. The title is a textarea, so this
     deliberately takes Enter away from it: a newline in a request title is not
     a thing anyone wants, and shift+Enter is still there for one. */
  function enterFromField(el) {
    const list = focusables();
    const at = list.indexOf(el);
    const next = at >= 0 ? list[at + 1] : null;
    try { el.blur(); } catch {}
    if (!next) { if (scr === 'write') $('#a-add').click(); clearSel(); return; }
    clearSel();
    sel = next;
    sel.classList.add('kb-sel');
    try { sel.scrollIntoView({ block: 'nearest' }); } catch {}
    if (!isField(sel)) { try { sel.focus({ preventScroll: true }); } catch {} }
    else { try { sel.focus(); } catch {} }
  }

  const SCREENS = ['write', 'queue', 'sent'];
  function step(dir) {
    const i = SCREENS.indexOf(scr);
    const j = i + dir;
    if (j < 0 || j >= SCREENS.length) return;
    clearSel();
    go(SCREENS[j]);
  }

  /* A custom binding is checked first, so putting `up` on a digit is allowed to
     win over anything built in. */
  const ACTIONS = ['left', 'right', 'up', 'down', 'act'];
  function actionFor(e) {
    const map = Store.get('keys') || {};
    const k = e.key.toLowerCase();
    for (const a of ACTIONS) if (map[a] && map[a] === k) return a;
    if (e.key === 'ArrowLeft')  return 'left';
    if (e.key === 'ArrowRight') return 'right';
    if (e.key === 'ArrowUp')    return 'up';
    if (e.key === 'ArrowDown')  return 'down';
    return null;
  }

  document.addEventListener('keydown', e => {
    if (capturing) return;                       // a rebind is reading this key
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    /* Quick mode is modal: it answers every key itself, so the cursor never
       walks the screen underneath it. */
    if (qOpen()) { quickKey(e); return; }

    const el = document.activeElement;
    if (isField(el)) {
      /* The only two bindings that reach a focused field, because everything
         else there is a character being typed. */
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enterFromField(el); return; }
      if (e.key === 'Escape') { e.preventDefault(); try { el.blur(); } catch {}
                                if (sel) sel.classList.add('kb-sel'); }
      return;
    }

    if (e.key === 'Escape') {
      if ($('#ask').classList.contains('on')) { closeAsk(false); clearSel(); return; }
      if ($('#set').classList.contains('on')) { closeSettings(); clearSel(); return; }
      clearSel();
      return;
    }

    switch (actionFor(e)) {
      case 'left':  step(-1); e.preventDefault(); return;
      case 'right': step(1);  e.preventDefault(); return;
      case 'up':    moveSel(-1); e.preventDefault(); return;
      case 'down':  moveSel(1);  e.preventDefault(); return;
      case 'act':   if (actOnSel()) e.preventDefault(); return;
    }
  });

  /* Rebinding, the same capture ROOT uses: read the next key pressed rather
     than asking anyone to spell "arrowup" into a text field. */
  const KEY_ROWS = [
    { k:'left',  label:'Previous screen' },
    { k:'right', label:'Next screen' },
    { k:'up',    label:'Cursor up' },
    { k:'down',  label:'Cursor down' },
    { k:'act',   label:'Use the selected control' },
  ];
  const KEY_SHOWN = { ' ':'space', ',':'comma', '.':'period', '/':'slash' };
  const keyLabel = v => v === '' ? 'none' : (KEY_SHOWN[v] || v);
  let capturing = null;

  function renderKeys() {
    const box = $('#set-keys'); if (!box) return;
    const map = Store.get('keys') || {};
    box.innerHTML = KEY_ROWS.map(r => `<div class="row">
      <span class="row-l">${esc(r.label)}</span>
      <button class="key-cap" data-key="${esc(r.k)}">${esc(keyLabel(map[r.k] ?? ''))}</button>
    </div>`).join('');
    box.querySelectorAll('.key-cap').forEach(b => b.onclick = () => captureKey(b));
  }

  function captureKey(btn) {
    if (capturing) capturing();
    const action = btn.dataset.key;
    const was = btn.textContent;
    btn.classList.add('on');
    btn.textContent = 'press a key';
    const done = () => {
      document.removeEventListener('keydown', onKey, true);
      capturing = null;
      btn.classList.remove('on');
      btn.textContent = was;
    };
    function onKey(ev) {
      ev.preventDefault(); ev.stopPropagation();
      done();
      if (ev.key === 'Escape') return;
      const map = Object.assign({}, Store.get('keys'));
      /* A key already bound elsewhere is taken off that action: two actions on
         one key means the first wins and the second silently does nothing,
         which reads as a broken setting rather than a choice. */
      const v = (ev.key === 'Backspace' || ev.key === 'Delete') ? '' : ev.key.toLowerCase();
      if (v) Object.keys(map).forEach(k => { if (map[k] === v) map[k] = ''; });
      map[action] = v;
      Store.set('keys', map);
      renderKeys();
      toast('rebound');
    }
    capturing = done;
    document.addEventListener('keydown', onKey, true);
  }

  /* ── boot ───────────────────────────────────────────────────────────── */

  function render() { paintCount(); renderQueue(); renderSent(); }
  applyLook();

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('#ask').classList.contains('on')) { closeAsk(false); return; }
      if ($('#set').classList.contains('on')) { closeSettings(); return; }
    }
    /* Ctrl/Cmd+Enter files the request from inside either field, which is the
       only shortcut a one-form app earns. */
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && scr === 'write' && !qOpen()) {
      e.preventDefault(); $('#a-add').click();
    }
  });

  /* The band's top line says where the requests land, and doubles as the way
     into settings — the button beside it is the one that admits to it. */
  $('#b-where').style.cursor = 'pointer';

  /* the smoke drives these; nothing in the page calls them from outside */
  window.ASK = { go, moveSel, clearSel, actOnSel, selected: () => sel, renderKeys,
                 quickKey, quickReset, quickStep: () => qAt, quickDone: () => qDone,
                 quickAsk: () => $('#q-ask').textContent, paintQuick,
                 applyAccent, setAccent, renderAccents,
                 applyLook, renderLook, render, setFilter, filter: () => filter(),
                 /* fromLink fills the draft; paintForm is what puts it on the
                    screen. Boot calls the two in that order and so must anything
                    that arms a link after boot. */
                 fromLink: () => { const hit = fromLink(); if (hit) { linkMode = true; paintForm(); } return hit; },
                 paintForm, readForm, linked: () => linkMode };

  document.documentElement.setAttribute('data-theme', Store.get('theme') || 'void');
  applyAccent(Store.get('accent'));
  applyLook();
  renderLists();
  resetForm();
  /* After resetForm, which is what a blank form is; a link fills that form in
     rather than competing with it. Quick mode is put away for one request when
     a link arrives — a whole request answered one question at a time is not
     what "here is the whole request" wants. */
  if (fromLink()) { linkMode = true; go('write'); }
  paintForm();
  measureBand();
  paintQuick();
  render();
})();
