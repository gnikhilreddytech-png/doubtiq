'use strict';

/**
 * DoubtIQ — data export (PostgreSQL).
 * Dumps the entire content library (subjects, questions, answers, pages)
 * into human-readable files next to the data directory:
 *   data/doubtiq-content.md     (readable dump)
 *   data/doubtiq-content.json   (structured export)
 *
 * Usage: npm run export   (requires DATABASE_URL)
 */

const fs = require('fs');
const path = require('path');
const { q } = require('../data/db');

const OUT_MD = path.join(__dirname, '..', 'data', 'doubtiq-content.md');
const OUT_JSON = path.join(__dirname, '..', 'data', 'doubtiq-content.json');

(async () => {
  const subjects = await q('SELECT * FROM subjects ORDER BY position');
  const questions = await q('SELECT * FROM questions ORDER BY created_at DESC');
  const answers = await q('SELECT * FROM answers ORDER BY created_at ASC');
  const pages = await q('SELECT * FROM pages ORDER BY title ASC');

  const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
  const subjectMap = byId(subjects);
  const answersByQ = {};
  for (const a of answers) (answersByQ[a.question_id] = answersByQ[a.question_id] || []).push(a);

  const md = [];
  md.push('# DoubtIQ — Content Library Export');
  md.push('');
  md.push(`Generated: ${new Date().toISOString()}`);
  md.push('');
  md.push(`- Subjects: ${subjects.length}`);
  md.push(`- Questions: ${questions.length}`);
  md.push(`- Answers: ${answers.length}`);
  md.push(`- Pages: ${pages.length}`);
  md.push('');
  md.push('---');
  md.push('');
  md.push('## Subjects');
  md.push('');
  for (const s of subjects) {
    const qn = questions.filter((qq) => qq.subject_id === s.id).length;
    md.push(`### ${s.position}. ${s.name}  \`/subjects/${s.slug}\`  (${qn} questions)`);
    md.push('');
    md.push(`> ${s.tagline}`);
    md.push('');
    md.push(`${s.description}`);
    md.push('');
  }

  md.push('---');
  md.push('');
  md.push('## Pages');
  md.push('');
  for (const p of pages) {
    md.push(`### ${p.title}  \`/#/page/${p.slug}\``);
    md.push('');
    md.push(`- Status: ${p.status} · Updated: ${p.updated_at}`);
    md.push('');
    md.push(p.body);
    md.push('');
    md.push('---');
    md.push('');
  }

  md.push('## Questions & Answers');
  md.push('');
  for (const qq of questions) {
    const s = subjectMap[qq.subject_id];
    const qa = answersByQ[qq.id] || [];
    md.push(`### ${s ? s.name : '?'} — Q${qq.id}: ${qq.title}`);
    md.push('');
    md.push(`- Status: ${qq.status} · Views: ${qq.view_count} · Created: ${qq.created_at}`);
    md.push(`- URL: /#/questions/${qq.id}`);
    md.push('');
    if (qq.body) {
      md.push('**Question details:**');
      md.push('');
      md.push(qq.body);
      md.push('');
    }
    md.push(`**Answers (${qa.length}):**`);
    md.push('');
    for (const a of qa) {
      md.push(`${a.is_verified ? '✅ Verified' : '—'} **${a.author}** (${a.status}, ${a.created_at})`);
      md.push('');
      md.push(a.body);
      md.push('');
    }
    md.push('---');
    md.push('');
  }

  fs.writeFileSync(OUT_MD, md.join('\n'), 'utf8');
  fs.writeFileSync(OUT_JSON, JSON.stringify({ subjects, questions, answers, pages }, null, 2), 'utf8');

  console.log(`Exported ${subjects.length} subjects, ${questions.length} questions, ${answers.length} answers, ${pages.length} pages, →`);
  console.log(`  ${OUT_MD}`);
  console.log(`  ${OUT_JSON}`);
})().catch((e) => {
  console.error('Export failed:', e && e.message ? e.message : e);
  process.exit(1);
});
