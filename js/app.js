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
    scr = name;
    $$('.scr').forEach(s => s.classList.toggle('on', s.id === 's-' + name));
    $$('.tab').forEach(t => t.classList.toggle('on', t.dataset.scr === name));
    $('#body').scrollTop = 0;
    render();
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
      const u = await Todoist.me();
      await Todoist.section();
      paintStatus(`connected as ${u && (u.full_name || u.email) || 'you'} · "${Todoist.SECTION}" found`, 'ok');
    } catch (err) { paintStatus(String(err.message || err), 'bad'); }
  };

  onChips('#set-theme', v => {
    document.documentElement.setAttribute('data-theme', v);
    Store.set('theme', v);
    lightChips('#set-theme', v);
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

  /* ── boot ───────────────────────────────────────────────────────────── */

  function render() { paintCount(); renderQueue(); renderSent(); }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if ($('#ask').classList.contains('on')) { closeAsk(false); return; }
      if ($('#set').classList.contains('on')) { closeSettings(); return; }
    }
    /* Ctrl/Cmd+Enter files the request from inside either field, which is the
       only shortcut a one-form app earns. */
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && scr === 'write') {
      e.preventDefault(); $('#a-add').click();
    }
  });

  /* The band's top line says where the requests land, and doubles as the way
     into settings — the button beside it is the one that admits to it. */
  $('#b-where').style.cursor = 'pointer';

  document.documentElement.setAttribute('data-theme', Store.get('theme') || 'void');
  renderLists();
  resetForm();
  render();
})();
