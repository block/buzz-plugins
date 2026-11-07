import { readFileSync } from 'node:fs';
import { validateIndex } from './schema.ts';

const file = process.argv[2];
if (!file) {
  console.error('usage: validate.ts <index.json>');
  process.exit(2);
}
const errors = validateIndex(JSON.parse(readFileSync(file, 'utf8')));
if (errors.length > 0) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
console.log(`${file}: valid`);
