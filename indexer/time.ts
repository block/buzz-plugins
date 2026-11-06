export function isoSeconds(value: number | Date): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
