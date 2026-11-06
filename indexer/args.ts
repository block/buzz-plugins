import { parseArgs } from 'node:util';

export function cli<T extends Record<string, { type: 'string' | 'boolean' }>>(
  options: T,
  argv: string[] = process.argv.slice(2),
) {
  return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
}
