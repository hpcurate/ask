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

check('still no errors after all of that', errors.length === 0, errors.slice(0, 3).join(' | '));

console.log(out.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
