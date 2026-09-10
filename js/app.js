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

  let scr = 'write';
  let draft = { type: '', project: '', tab: '', prio: 4 };
  let editing = null;              // the queued id being edited, if any
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
    const tn = $('#t-n');
    tn.textContent = String(Store.queue().length);
    tn.hidden = !Store.queue().length;
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
             tab: draft.tab || 'other', prio: draft.prio || 4,
             notes: $('#a-notes').value.trim() };
  }

  $('#a-add').onclick = () => {
    const req = readForm();
    if (!req) return;
    if (editing) { Store.update(editing, req); toast('changed'); }
    else { Store.add(req); toast(req.type ? 'queued' : 'queued — no type, so it reads as a change'); }
    resetForm();
    render();
    if (editing === null && scr === 'write') { /* stay put: the next one is usually right behind */ }
  };
  $('#a-clear').onclick = () => { resetForm(); toast('cleared'); };

  /* ── the queue and the history ──────────────────────────────────────── */

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

  function renderQueue() {
    const q = Store.queue();
    $('#q-list').innerHTML = q.length
      ? q.map(r => cardHTML(r, { acts: true })).join('')
      : '<div class="empty">nothing queued.<br>write one on the first tab.</div>';
    const btn = $('#q-send');
    btn.disabled = !q.length || sending;
    btn.textContent = sending ? 'sending…'
      : q.length ? `send ${q.length} to todoist` : 'send to todoist';
    $('#q-clear').hidden = !q.length;
  }

  function renderSent() {
    const h = Store.sent();
    $('#h-list').innerHTML = h.length
      ? h.map(r => cardHTML(r, { acts: false })).join('')
      : '<div class="empty">nothing sent from this device yet.</div>';
    $('#h-clear').hidden = !h.length;
  }

  $('#q-list').addEventListener('click', e => {
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
    { k:'tab', kind:'chips', ask:'Which area?',
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
  const quickOn = () => !!Store.get('quick') && !editing;
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
                 applyAccent, setAccent, renderAccents };

  document.documentElement.setAttribute('data-theme', Store.get('theme') || 'void');
  applyAccent(Store.get('accent'));
  renderLists();
  resetForm();
  measureBand();
  paintQuick();
  render();
})();
