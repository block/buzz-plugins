import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseListingYaml } from './listing.ts';
import { parseManifest } from './manifest.ts';

const read = (name: string) => readFileSync(new URL(`../template/${name}`, import.meta.url), 'utf8');

test('the author template has a listable manifest and a valid buzz-listing.yaml', () => {
  const manifest = parseManifest(read('manifest.json'));
  assert.ok('manifest' in manifest, JSON.stringify(manifest));
  assert.equal(manifest.manifest.id, 'com.example.my-plugin');
  const listing = parseListingYaml(read('buzz-listing.yaml'));
  assert.ok('listing' in listing, JSON.stringify(listing));
  assert.equal(listing.listing.category, 'productivity');
});
