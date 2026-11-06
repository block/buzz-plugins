import { readFileSync } from 'node:fs';
import { validateIndex, validateListings } from './schema.ts';

const file = process.argv[2];
if (!file) {
  console.error('usage: validate.ts <index.json|listings.json>');
  process.exit(2);
}
const data = JSON.parse(readFileSync(file, 'utf8'));
const errors = 'rankings' in data ? validateIndex(data) : validateListings(data);
if (errors.length > 0) {
  for (const e of errors) console.error(e);
  process.exit(1);
}
console.log(`${file}: valid`);
