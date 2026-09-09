/* The Todoist client, and the one thing this app knows how to write.
   Same shape as ROOT's shared client — the unified v1 API, direct, with the
   {results,next_cursor} pagination it uses on some collections. Kept separate
   from app.js so the only place that talks to the network is one file.

   What it writes is the intake contract, not a format of its own:

     section     inbox › claude requests
     labels      claude  +  exactly one of fix / change / feature / idea
     content     the title, verbatim
     description project: <p> | tab: <t>
     comment     the notes, if there are any

   `claude` is the gate — a task without it is never picked up — and the type
   label decides the version bump downstream, which is why exactly one is
   allowed. */
window.Todoist = (function () {
  'use strict';

  const BASE = 'https://api.todoist.com/api/v1';
  const SECTION = 'claude requests';
  const GATE = 'claude';
  const TYPES = ['fix', 'change', 'feature', 'idea'];

  async function call(path, opts = {}) {
    const tok = Store.token();
    if (!tok) throw new Error('no Todoist key saved — add one in settings');
    let res;
    try {
      res = await fetch(BASE + path, Object.assign({}, opts, {
        headers: Object.assign({ 'Authorization': 'Bearer ' + tok },
          opts.body ? { 'Content-Type': 'application/json' } : {}, opts.headers || {}),
      }));
    } catch {
      throw new Error(location.protocol === 'file:'
        ? 'blocked by the browser — serve over http(s), not as a local file'
        : 'network error');
    }
    if (res.status === 401 || res.status === 403) throw new Error('token rejected by Todoist');
    if (res.status === 429) throw new Error('rate limited by Todoist — wait a minute');
    if (!res.ok) throw new Error('Todoist error ' + res.status);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function getAll(path, params = {}) {
    const out = [];
    let cursor = null;
    do {
      const q = new URLSearchParams(Object.assign({}, params, { limit: '200' }));
      if (cursor) q.set('cursor', cursor);
      const page = await call(`${path}?${q}`);
      if (Array.isArray(page)) { out.push(...page); cursor = null; }
      else { out.push(...((page && page.results) || [])); cursor = (page && page.next_cursor) || null; }
    } while (cursor);
    return out;
  }

  /* "claude requests" and "claude-requests" are the same section. */
  const fold = s => String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  let sectionId = null;
  async function section() {
    if (sectionId) return sectionId;
    const secs = await getAll('/sections', { project_id: 'inbox' });
    const hit = secs.find(s => fold(s.name) === fold(SECTION));
    if (!hit) throw new Error(`no "${SECTION}" section in the inbox — make it in Todoist first`);
    sectionId = hit.id;
    return sectionId;
  }

  async function me() { return call('/user'); }

  const describe = (project, tab) => `project: ${project} | tab: ${tab}`;

  /* One request becomes one task, plus one comment if it has notes. The
     comment is best-effort: the task is the request, and losing the note is
     better than filing the same request twice because a retry looked safe. */
  async function send(req) {
    const sec = await section();
    const labels = [GATE];
    if (TYPES.includes(req.type)) labels.push(req.type);

    const task = await call('/tasks', { method: 'POST', body: JSON.stringify({
      content: req.title,
      description: describe(req.project, req.tab),
      project_id: 'inbox',
      section_id: sec,
      labels,
      priority: Math.min(4, Math.max(1, 5 - (+req.prio || 4))),
    }) });

    if (req.notes && req.notes.trim() && task && task.id) {
      try { await call('/comments', { method: 'POST', body: JSON.stringify({
        task_id: task.id, content: req.notes.trim() }) }); }
      catch { /* the request is filed; the note is not worth a duplicate */ }
    }
    return task;
  }

  return { call, getAll, section, me, send, describe, TYPES, GATE, SECTION };
})();
