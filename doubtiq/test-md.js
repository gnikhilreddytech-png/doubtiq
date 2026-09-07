'use strict';
/* Unit test for the markdown-lite renderer + escaping.
 * Content checks are run against PostgreSQL via DATABASE_URL when set;
 * otherwise only the pure renderer tests run. */
const fs = require('fs');
const vm = require('vm');
const { q } = require('./data/db');

const ctx = {
  console,
  document: { querySelector: () => null, createElement: () => ({ className: '', innerHTML: '', style: {}, appendChild() {}, remove() {} }), body: { appendChild() {} } },
  setTimeout, clearTimeout
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('public/js/icons.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('public/js/components.js', 'utf8'), ctx);
const run = (code) => vm.runInContext(code, ctx);

let ok = true;
const check = (name, pass) => { console.log((pass ? 'PASS' : 'FAIL') + ': ' + name); if (!pass) ok = false; };

(async () => {
  const sample = '<script>alert(1)</script> **bold** *it*\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- x\n- y\n\n1. one\n2. two';
  const html = run('renderMd(' + JSON.stringify(sample) + ')');
  check('xss escaped', !html.includes('<script>alert'));
  check('table rendered', html.includes('<table>'));
  check('separator row skipped', !html.includes('<td>---</td>'));
  check('ul rendered', html.includes('<ul>'));
  check('ol rendered', html.includes('<ol>'));
  check('strong', html.includes('<strong>bold</strong>'));
  check('em', html.includes('<em>it</em>'));

  if (!process.env.DATABASE_URL) {
    console.log('(content checks skipped — DATABASE_URL not set)');
    process.exit(ok ? 0 : 1);
  }

  try {
    const rows = await q("SELECT body FROM answers WHERE body LIKE '%Mitosis%' LIMIT 1");
    if (rows.length) {
      const h = run('renderMd(' + JSON.stringify(rows[0].body) + ')');
      check('mitosis table', h.includes('<table>'));
      check('no separator row in mitosis', !h.includes('<td>---</td>'));
      check('header cells', h.includes('<th>Feature</th>') && h.includes('<th>Meiosis</th>'));
      check('data cells', h.includes('<td>Gamete formation</td>'));
      check('bold in mitosis', h.includes('<strong>Mitosis</strong>'));
    }
    const hindi = await q("SELECT body FROM answers WHERE body LIKE '%संधि%' LIMIT 1");
    if (hindi.length) {
      const h = run('renderMd(' + JSON.stringify(hindi[0].body) + ')');
      check('hindi text preserved', h.includes('संधि') && h.includes('विद्यालय'));
    }
  } catch (e) {
    console.log('(content checks skipped — database error: ' + e.message + ')');
  }

  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('test-md crashed:', e); process.exit(1); });
