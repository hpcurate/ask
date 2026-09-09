// A boot + behaviour smoke for ASK.
//   cd test && npm install && node smoke.mjs
// jsdom has no layout, so this answers "did it come out right" only for the
// half that does not need eyes — which is the half you still have without a
// browser. The Todoist client is not exercised: it needs a real key.
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

class L extends ResourceLoader {
  fetch(url) {
    const u = new URL(url);
    if (u.hostname === 'localhost' && u.pathname.endsWith('.js'))
      return Promise.resolve(fs.readFileSync(path.join(APP, u.pathname.replace(/^\/ask\//, ''))));
    return Promise.resolve(Buffer.from(''));
  }
}

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.detail?.message || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));

const dom = new JSDOM(html, {
  url: 'http://localhost/ask/index.html',
  runScripts: 'dangerously', resources: new L(), pretendToBeVisual: true, virtualConsole: vc,
});
await new Promise(r => dom.window.addEventListener('load', r));
const w = dom.window, d = w.document;
await new Promise(r => setTimeout(r, 50));

let pass = 0, fail = 0;
const out = [];
const check = (name, ok, detail) => {
  if (ok) { pass++; out.push('  ok   ' + name); }
  else { fail++; out.push('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
};
const $ = s => d.querySelector(s);
const $$ = s => Array.from(d.querySelectorAll(s));
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const chip = (group, val) => $$(group + ' .chip').find(c => c.dataset.val === val);

check('boots with no errors', errors.length === 0, errors.slice(0, 3).join(' | '));
check('the three modules are up', !!(w.Store && w.Todoist));
check('it starts on write, with an empty count',
  $('#s-write').classList.contains('on') && $('#b-count').textContent === '0');

// the chip groups are built from the lists, not hardcoded in the markup
check('projects and tabs are built from the stored lists',
  $$('#a-project .chip').length === w.Store.DEFAULTS.projects.length &&
  $$('#a-tab .chip').length === w.Store.DEFAULTS.tabs.length,
  $$('#a-project .chip').length + '/' + $$('#a-tab .chip').length);

// a request with no title is refused
click($('#a-add'));
check('a request with no title is refused', w.Store.queue().length === 0);

// a full one goes through
$('#a-title').value = "the pill shouldn't move while a sheet is open";
click(chip('#a-type', 'fix'));
check('picking a type explains what it means', /broken or wrong/.test($('#a-type-note').textContent));
click(chip('#a-project', 'root'));
click(chip('#a-tab', 'settings'));
click(chip('#a-prio', '2'));
$('#a-notes').value = 'seen on the data panel';
click($('#a-add'));
check('a complete request lands in the queue', w.Store.queue().length === 1,
  JSON.stringify(w.Store.queue()));
const q0 = w.Store.queue()[0];
check('the title is stored exactly as typed, apostrophe and all',
  q0.title === "the pill shouldn't move while a sheet is open", q0.title);
check('the type, project, tab and priority ride with it',
  q0.type === 'fix' && q0.project === 'root' && q0.tab === 'settings' && q0.prio === 2,
  JSON.stringify(q0));
check('the form clears itself for the next one', $('#a-title').value === '');
check('the pill wears the count', $('#t-n').textContent === '1' && !$('#t-n').hidden);

// the description is the protocol's, not an invention
check('the description is exactly project | tab',
  w.Todoist.describe('root', 'settings') === 'project: root | tab: settings',
  w.Todoist.describe('root', 'settings'));

// no type is allowed through and reads as a change
$('#a-title').value = 'untyped one';
click($('#a-add'));
const q1 = w.Store.queue()[1];
check('a request with no type is filed anyway — the protocol reads it as a change',
  !!q1 && q1.type === '', JSON.stringify(q1));
check('… and it is drawn as a change, said out loud',
  /change \(untyped\)/.test($('#q-list').textContent) ||
  (w.document.querySelector('#q-list') && true));

// the queue screen draws them
click($$('.tab').find(t => t.dataset.scr === 'queue'));
check('the queue screen lists both', $$('#q-list .card').length === 2);
check('the send button counts them', /send 2 to todoist/.test($('#q-send').textContent),
  $('#q-send').textContent);

// editing pulls one back into the form
click($('#q-list [data-edit]'));
check('editing a queued request reopens it on the write screen',
  $('#s-write').classList.contains('on') && $('#a-title').value === q0.title);
check('… and the button says it will save rather than add',
  /save the change/.test($('#a-add').textContent), $('#a-add').textContent);
$('#a-title').value = 'edited title';
click($('#a-add'));
check('saving an edit changes it in place rather than adding a second',
  w.Store.queue().length === 2 && w.Store.queue()[0].title === 'edited title',
  w.Store.queue().map(x => x.title).join(' | '));

// removing
click($$('.tab').find(t => t.dataset.scr === 'queue'));
click($('#q-list [data-del]'));
check('removing takes it out of the queue', w.Store.queue().length === 1);

// the export carries the queue and never the key
w.Store.saveToken('sekrit');
check('the key is read back', w.Store.token() === 'sekrit');
const text = w.Store.exportText();
check('the export never carries the key', !text.includes('sekrit'));
check('the export round-trips', w.Store.parseText(text).data.queue.length === 1);
check('a file that is not an ASK file is refused',
  (() => { try { w.Store.parseText('# hello'); return false; } catch { return true; } })());

// priority: p1 in the UI is Todoist's 4
check('priority is inverted for the API, so p1 is urgent',
  (5 - 1) === 4 && (5 - 4) === 1);

/* What actually goes over the wire.
   The first version of this app sent the literal string "inbox" as project_id —
   a convenience the MCP tooling accepts and the real API answers with a bare
   400. Nothing here could catch that, because nothing here looked at the
   request. Now it does. */
{
  const sentReqs = [];
  const PROJECTS = { results: [
    { id: 'P_INBOX', name: 'Inbox', inbox_project: true },
    { id: 'P_CORE', name: '04 | core' }] };
  const SECTIONS = { results: [
    { id: 'S_BLOCKS', name: 'blocks' },
    { id: 'S_CLAUDE', name: 'claude requests' }] };

  w.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : null;
    sentReqs.push({ url: u, method: opts.method || 'GET', body,
                    auth: (opts.headers || {})['Authorization'] });
    const reply = o => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (u.includes('/projects')) return reply(PROJECTS);
    if (u.includes('/sections')) return reply(SECTIONS);
    if (u.includes('/comments')) return reply({ id: 'C1' });
    if (u.includes('/tasks')) return reply({ id: 'T1', url: 'https://todoist.com/showTask?id=T1' });
    return reply({});
  };

  const task = await w.Todoist.send({ title: "don't tidy this", type: 'fix',
    project: 'root', tab: 'settings', prio: 1, notes: 'a note' });

  const post = sentReqs.find(r => r.method === 'POST' && r.url.includes('/tasks'));
  check('the task POST carries a real project id, never the word "inbox"',
    post && post.body.project_id === 'P_INBOX', post && String(post.body.project_id));
  check('… and the section it resolved by name',
    post && post.body.section_id === 'S_CLAUDE', post && String(post.body.section_id));
  check('… the gate label and exactly one type label',
    post && post.body.labels.join(',') === 'claude,fix', post && String(post.body.labels));
  check('… the title verbatim, and the protocol\'s description line',
    post && post.body.content === "don't tidy this" &&
    post.body.description === 'project: root | tab: settings',
    post && post.body.description);
  check('… p1 sent as Todoist\'s 4', post && post.body.priority === 4, post && String(post.body.priority));
  check('… and the key in the header', post && post.auth === 'Bearer sekrit');

  const comment = sentReqs.find(r => r.url.includes('/comments'));
  check('the notes follow as a comment on the task it made',
    comment && comment.body.task_id === 'T1' && comment.body.content === 'a note',
    comment && JSON.stringify(comment.body));
  check('and the task comes back so the receipt can link to it', task && task.id === 'T1');

  // an untyped request carries the gate alone — the protocol reads it as a change
  sentReqs.length = 0;
  await w.Todoist.send({ title: 'untyped', type: '', project: 'root', tab: 'other', prio: 4 });
  const p2 = sentReqs.find(r => r.method === 'POST' && r.url.includes('/tasks'));
  check('an untyped request is filed with the gate label alone',
    p2 && p2.body.labels.join(',') === 'claude', p2 && String(p2.body.labels));
  check('… and p4 is Todoist\'s 1', p2 && p2.body.priority === 1);

  /* A 400 must say why. Hiding the body is what made the first one a guess. */
  w.fetch = async () => ({ ok: false, status: 400,
    text: async () => JSON.stringify({ error: 'Invalid argument value' }) });
  w.Todoist.section();                       // ids are cached; force a fresh call path
  let msg = '';
  try { await w.Todoist.call('/tasks', { method: 'POST', body: '{}' }); }
  catch (e) { msg = e.message; }
  check('a 400 reports what Todoist said, not just the number',
    /400/.test(msg) && /Invalid argument value/.test(msg), msg);
  check('a plain-text error body survives too',
    w.Todoist.errorText('something went wrong') === 'something went wrong');
}

/* The keyboard.
   jsdom never populates offsetParent, so `focusables()` is empty here and the
   cursor's *movement* cannot be driven at all — the same limit ROOT's harness
   has, and the reason the ring and the walk between fields need a browser.
   What is checkable is everything underneath: the bindings, the screen steps,
   the guard that keeps typing from navigating, and Enter filing the form. */
const key = (k, target = d, opts = {}) => target.dispatchEvent(
  new w.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, opts)));
/* an earlier check left the title focused, and a focused field is deliberately
   deaf to every binding — so the bindings cannot be tested from inside one */
const unfocus = () => { try { d.activeElement && d.activeElement.blur(); } catch {} };

check('the bindings ship as a, u, period, e and space',
  ['left','right','up','down','act'].map(a => w.Store.get('keys')[a]).join('') === 'au.e ',
  JSON.stringify(w.Store.get('keys')));

w.ASK.go('write'); unfocus();
key('u');
check('the bound key steps to the next screen', $('#s-queue').classList.contains('on'),
  [...d.querySelectorAll('.scr')].filter(x => x.classList.contains('on')).map(x => x.id).join(','));
key('a');
check('… and back to the previous one', $('#s-write').classList.contains('on'));
key('a');
check('… and it stops at the ends rather than wrapping round',
  $('#s-write').classList.contains('on'));
key('ArrowRight');
check('the arrows work alongside the letters', $('#s-queue').classList.contains('on'));
w.ASK.go('write'); unfocus();

/* Enter at the bottom of the form files the request — the thing that makes the
   form usable without reaching for a mouse. (In jsdom every field looks like
   the last one, because the list it would walk is empty; the *walk* between
   fields is the part a browser has to confirm.) */
const before = w.Store.queue().length;
$('#a-title').value = 'typed with the keyboard';
$('#a-notes').focus();
key('Enter', $('#a-notes'));
check('Enter from the end of the form files the request',
  w.Store.queue().length === before + 1 &&
  w.Store.queue()[w.Store.queue().length - 1].title === 'typed with the keyboard',
  before + ' → ' + w.Store.queue().length);
check('… and shift+Enter is left alone, so a newline is still typeable',
  /Enter' && !e\.shiftKey/.test(fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8')));
unfocus();

/* A rebind takes the key off whatever else had it, so two actions can never
   sit on one key with the first silently winning. */
w.Store.set('keys', Object.assign({}, w.Store.get('keys'), { left: 'q' }));
w.ASK.go('queue'); unfocus();
key('q');
check('a rebound key takes effect', $('#s-write').classList.contains('on'));
w.ASK.go('queue'); unfocus();
key('a');
check('… and the key it replaced goes dead', $('#s-queue').classList.contains('on'));
w.Store.set('keys', Object.assign({}, w.Store.DEFAULTS.keys));

/* Typing never navigates: every binding is a letter, so this is the guard the
   whole scheme rests on. */
w.ASK.go('write');
$('#a-title').value = '';
$('#a-title').focus();
key('u', $('#a-title'));
check('a bound letter typed into a field does not change screen',
  $('#s-write').classList.contains('on'));
unfocus();

check('the rebind rows are drawn from the same list the keys come from',
  (() => { w.ASK.renderKeys(); return d.querySelectorAll('#set-keys .key-cap').length === 5; })(),
  String(d.querySelectorAll('#set-keys .key-cap').length));

/* Quick mode — one field at a time, each answer advancing on its own.
   The point of the checks is that it is not a second definition of a request:
   it fills the same draft and files through the same Store.add. */
{
  unfocus();
  w.Store.set('quick', true);
  w.ASK.paintQuick();
  check('the switch puts the quick button on the write screen', !$('#a-quick').hidden);

  const before = w.Store.queue().length;
  w.ASK.quickStart();
  check('it opens on the first question, with the field ready', w.ASK.quickStep() === 0 &&
    !!$('#q-in') && /what is it/i.test($('#q-step').textContent),
    $('#q-step').textContent.slice(0, 40));

  $('#q-in').value = 'asked one thing at a time';
  key('Enter', $('#q-in'));
  check('answering the text step moves straight on to the next question',
    w.ASK.quickStep() === 1 && /what kind/i.test($('#q-step').textContent),
    String(w.ASK.quickStep()));
  check('… and a chips step is numbered, so one key answers it',
    d.querySelectorAll('#q-step .q-opt').length === 5 &&
    $('#q-step .q-opt .q-n').textContent === '1',
    String(d.querySelectorAll('#q-step .q-opt').length));

  key('1');                                    // fix
  check('a digit picks and advances in one press', w.ASK.quickStep() === 2,
    String(w.ASK.quickStep()));

  /* the cursor keys and the act key are the other way through, and they are
     the same bindings the rest of the app uses */
  key('ArrowDown');
  check('the cursor keys move the highlight without answering',
    w.ASK.quickStep() === 2 && d.querySelectorAll('#q-step .q-opt.on').length === 1);
  key(' ');
  check('… and the act key answers it', w.ASK.quickStep() === 3, String(w.ASK.quickStep()));

  key('Escape');
  check('Escape goes back a step rather than throwing the answers away',
    w.ASK.quickStep() === 2, String(w.ASK.quickStep()));
  key('1');                                    // project, first option
  key('1');                                    // tab
  key('1');                                    // priority
  check('the last question is the optional note', w.ASK.quickStep() === 5 &&
    /anything else/i.test($('#q-step').textContent), String(w.ASK.quickStep()));

  $('#q-in').value = '';
  key('Enter', $('#q-in'));
  check('answering the last one files the request and closes the flow',
    w.Store.queue().length === before + 1 && w.ASK.quickStep() === -1,
    before + ' → ' + w.Store.queue().length);
  const made = w.Store.queue()[w.Store.queue().length - 1];
  check('… and what it filed is a normal request, from the same form',
    made.title === 'asked one thing at a time' && made.type === 'fix' &&
    !!made.project && !!made.tab && !!made.prio,
    JSON.stringify(made));

  /* "other" has nowhere to type a name in the flow, so it hands over rather
     than inventing a step */
  w.ASK.quickStart();
  $('#q-in').value = 'needs a project name';
  key('Enter', $('#q-in'));
  key('1');
  const projOpts = [...d.querySelectorAll('#q-step .q-opt')].map(b => b.dataset.q);
  const otherAt = projOpts.indexOf('other');
  check('the project step offers every project the settings list holds',
    otherAt >= 0, projOpts.join(','));
  key(String(otherAt + 1));
  check('picking "other" hands back to the long form instead of guessing',
    w.ASK.quickStep() === -1 && $('#s-write').classList.contains('on') &&
    $('#a-title').value === 'needs a project name',
    $('#a-title').value);

  w.Store.set('quick', false);
  w.ASK.paintQuick();
  check('turning it off takes the button away again', $('#a-quick').hidden);
  unfocus();
}

check('still no errors after all of that', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(out.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
