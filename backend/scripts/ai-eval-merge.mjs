// Combines the result files of `ai-eval.mjs --shard k/n` runs into one per-group table.
import { readFileSync } from 'node:fs';
const results = process.argv.slice(2).flatMap(file => JSON.parse(readFileSync(file, 'utf8')).results);
const groups = [...new Set(results.map(row => row.group || row.category))];
const byGroup = Object.fromEntries(groups.map(group => { const rows = results.filter(row => (row.group || row.category) === group && row.pass !== null), pass = rows.filter(row => row.pass).length; return [group, { pass, total: rows.length }]; }));
for (const row of results.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))) console.log(`${row.pass === null ? 'SKIP' : row.pass ? 'PASS' : 'FAIL'} ${row.id} ${row.group || row.category} ${row.reason}`);
const graded = results.filter(row => row.pass !== null), pass = graded.filter(row => row.pass).length;
console.log(`GROUP ${JSON.stringify(byGroup)}`);
console.log(`TOTAL ${pass}/${graded.length} (${(pass / graded.length * 100).toFixed(1)}%)`);
