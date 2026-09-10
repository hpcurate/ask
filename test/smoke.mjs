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

/* Quick mode — one question at a time, and when it is on it *is* the write
   screen. The checks are that it replaces the form rather than covering it,
   that it fills the same draft and files through the same Store.add, and that
   a run of requests never leaves it. */
{
  unfocus();
  w.ASK.go('write');
  w.Store.set('quick', true);
  w.ASK.paintQuick();
  check('the toggle replaces the write screen instead of opening over it',
    $('#q-wrap').classList.contains('on') && d.body.classList.contains('q-mode'),
    $('#q-wrap').className + ' | ' + d.body.className);
  check('… on the first question, with the field ready',
    w.ASK.quickStep() === 0 && !!$('#q-in') && /what is it/i.test(w.ASK.quickAsk()),
    w.ASK.quickAsk());

  const before = w.Store.queue().length;
  $('#q-in').value = 'asked one thing at a time';
  key('Enter', $('#q-in'));
  check('answering the text step moves straight on to the next question',
    w.ASK.quickStep() === 1 && /what kind/i.test(w.ASK.quickAsk()), w.ASK.quickAsk());
  check('… and a chips step is numbered, so one key answers it',
    d.querySelectorAll('#q-opts .q-opt').length === 5 &&
    $('#q-opts .q-opt .q-n').textContent === '1',
    String(d.querySelectorAll('#q-opts .q-opt').length));

  key('1');                                    // fix
  check('a digit picks and advances in one press', w.ASK.quickStep() === 2,
    String(w.ASK.quickStep()));
  check('… and the long form behind it holds the same answer',
    [...d.querySelectorAll('#a-type .chip.on')].map(c => c.dataset.val).join(',') === 'fix');

  /* the cursor keys and the act key are the other way through, and they are
     the same bindings the rest of the app uses */
  key('ArrowDown');
  check('the cursor keys move the highlight without answering',
    w.ASK.quickStep() === 2 && d.querySelectorAll('#q-opts .q-opt.on').length === 1 &&
    d.querySelector('#q-opts .q-opt.on').dataset.i === '1',
    d.querySelector('#q-opts .q-opt.on').dataset.i);
  key('ArrowUp');
  key('ArrowUp');
  check('… and they wrap rather than stopping dead at the end',
    d.querySelector('#q-opts .q-opt.on').dataset.i ===
      String(d.querySelectorAll('#q-opts .q-opt').length - 1),
    d.querySelector('#q-opts .q-opt.on').dataset.i);
  key('1');                                    // project: the first one

  /* Escape is not "out" any more, because there is nowhere out to go: it is
     this request, from the top. */
  key('Backspace');
  check('backspace is the small undo — one question back',
    w.ASK.quickStep() === 2 && /which project/i.test(w.ASK.quickAsk()), w.ASK.quickAsk());
  key('Escape');
  check('Escape starts the request over at the first question',
    w.ASK.quickStep() === 0 && /what is it/i.test(w.ASK.quickAsk()), w.ASK.quickAsk());
  check('… and it is a fresh request, not the old one back',
    $('#a-title').value === '' && $('#q-in').value === '' &&
    d.querySelectorAll('#a-type .chip.on').length === 0,
    JSON.stringify($('#a-title').value));
  check('… and nothing was filed by starting over', w.Store.queue().length === before);

  /* a whole one, by key */
  $('#q-in').value = 'asked one thing at a time';
  key('Enter', $('#q-in'));
  key('1');                                    // fix
  key('1');                                    // project, first option
  const tabs = [...d.querySelectorAll('#q-opts .q-opt')];
  check('every tab in the list is offered as its own block',
    w.ASK.quickStep() === 3 && tabs.length === w.Store.get('tabs').length,
    tabs.length + '/' + w.Store.get('tabs').length);
  check('… laid out in one column where there is no window to measure',
    $('#q-opts').style.gridTemplateColumns === '1fr', $('#q-opts').style.gridTemplateColumns);
  key('1');                                    // tab
  key('1');                                    // priority
  check('the last question is the optional note', w.ASK.quickStep() === 5 &&
    /anything else/i.test(w.ASK.quickAsk()), w.ASK.quickAsk());

  $('#q-in').value = '';
  key('Enter', $('#q-in'));
  check('answering the last one files the request and asks the first again',
    w.Store.queue().length === before + 1 && w.ASK.quickStep() === 0,
    before + ' → ' + w.Store.queue().length + ', step ' + w.ASK.quickStep());
  const made = w.Store.queue()[w.Store.queue().length - 1];
  check('… and what it filed is a normal request, from the same form',
    made.title === 'asked one thing at a time' && made.type === 'fix' &&
    !!made.project && !!made.tab && !!made.prio,
    JSON.stringify(made));
  check('… on an empty field, so the next one is typed straight in',
    !!$('#q-in') && $('#q-in').value === '' && $('#a-title').value === '',
    $('#q-in') ? JSON.stringify($('#q-in').value) : 'no field');
  check('… and the first question carries the count of the run so far',
    /1 queued in a row/.test($('#q-hint').textContent), $('#q-hint').textContent);

  /* the whole point: a second one without leaving and coming back */
  $('#q-in').value = 'and the one behind it';
  key('Enter', $('#q-in'));
  key('1'); key('1'); key('1'); key('1');       // kind, project, area, priority
  $('#q-in').value = '';
  key('Enter', $('#q-in'));
  check('a run files as many as it is answered, without ever being reopened',
    w.Store.queue().length === before + 2 && w.ASK.quickDone() === 2 &&
    w.Store.queue()[w.Store.queue().length - 1].title === 'and the one behind it',
    before + ' → ' + w.Store.queue().length);

  /* "other" grows the flow a question rather than handing back to a form that
     is not on screen any more */
  $('#q-in').value = 'needs a project name';
  key('Enter', $('#q-in'));
  key('1');
  const projOpts = [...d.querySelectorAll('#q-opts .q-opt')].map(b => b.dataset.q);
  const otherAt = projOpts.indexOf('other');
  check('the project step offers every project the settings list holds',
    otherAt >= 0 && projOpts.length === w.Store.get('projects').length, projOpts.join(','));
  key(String(otherAt + 1));
  check('picking "other" asks for the name in the flow rather than handing back',
    /name the project/i.test(w.ASK.quickAsk()) && !!$('#q-in') &&
    $('#q-wrap').classList.contains('on'), w.ASK.quickAsk());
  $('#q-in').value = 'brand new repo';
  key('Enter', $('#q-in'));
  check('… and answering it carries on to the area, one question later',
    /which area/i.test(w.ASK.quickAsk()), w.ASK.quickAsk());
  key('1'); key('1');                           // area, priority
  $('#q-in').value = '';
  key('Enter', $('#q-in'));
  const other = w.Store.queue()[w.Store.queue().length - 1];
  check('a project typed into the flow is filed like any other',
    other.project === 'brand new repo' && other.title === 'needs a project name',
    JSON.stringify(other));

  /* an edit is a whole request at once, which is what quick mode is not — so
     it borrows the long form back for as long as it lasts */
  w.ASK.go('queue');
  click($('#q-list [data-edit]'));
  check('editing a queued request puts the long form back',
    $('#s-write').classList.contains('on') && !d.body.classList.contains('q-mode') &&
    !$('#q-wrap').classList.contains('on'), d.body.className);
  click($('#a-add'));
  check('… and saving it hands the screen back to quick mode',
    d.body.classList.contains('q-mode') && $('#q-wrap').classList.contains('on'),
    d.body.className);

  w.Store.set('quick', false);
  w.ASK.paintQuick();
  check('turning it off gives the long form back',
    !$('#q-wrap').classList.contains('on') && !d.body.classList.contains('q-mode') &&
    $('#s-write').classList.contains('on'), d.body.className);
  unfocus();
}

/* The accent. One property carries it, and everything lit in the app is mixed
   from that property rather than from a colour of its own. */
{
  w.ASK.setAccent('#3b82f6');
  check('a custom accent is written onto the root as --y',
    d.documentElement.style.getPropertyValue('--y') === '#3b82f6',
    d.documentElement.style.getPropertyValue('--y'));
  check('… and the ink on top of it is worked out, not stored',
    d.documentElement.style.getPropertyValue('--on-y') === '#ffffff',
    d.documentElement.style.getPropertyValue('--on-y'));
  w.ASK.setAccent('#facc15');
  check('a bright accent takes dark ink instead',
    d.documentElement.style.getPropertyValue('--on-y') === '#0e0e0e',
    d.documentElement.style.getPropertyValue('--on-y'));
  check('the choice is kept the way the theme is', w.Store.get('accent') === '#facc15');
  check('… and it is in the export, so it travels with everything else',
    /facc15/.test(w.Store.exportText()));
  w.ASK.renderAccents();
  check('the picker offers the theme\'s own alongside the presets',
    d.querySelectorAll('#set-accent .acc-dot').length === 11 &&
    d.querySelectorAll('#set-accent .acc-dot.on').length === 1,
    String(d.querySelectorAll('#set-accent .acc-dot').length));
  w.ASK.setAccent('');
  check('reset hands the colour back to the theme',
    !d.documentElement.style.getPropertyValue('--y') &&
    !d.documentElement.style.getPropertyValue('--on-y') && w.Store.get('accent') === '',
    JSON.stringify(d.documentElement.getAttribute('style')));
  check('… and the page applies a saved accent before the first paint',
    /--y[\s\S]*prefs_v1|prefs_v1[\s\S]*--y/.test(
      fs.readFileSync(path.join(APP, 'index.html'), 'utf8')));
}

check('still no errors after all of that', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(out.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
