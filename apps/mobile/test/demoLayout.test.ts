import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { showDemoDetails } from '../src/modules/hike/ui/demoLayout.ts';

test('danger banners take priority over expanded demo controls', () => {
  assert.equal(showDemoDetails(true, false), true);
  assert.equal(showDemoDetails(false, false), false);
  assert.equal(showDemoDetails(true, true), false);
});
