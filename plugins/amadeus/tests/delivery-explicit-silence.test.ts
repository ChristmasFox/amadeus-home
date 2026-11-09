import assert from 'node:assert/strict';
import test from 'node:test';
import { deliveryRuns } from '../src/delivery-runs.js';

const start = (runId: string, origin: 'external_user' | 'heartbeat' = 'external_user') => deliveryRuns.start({ runId, sessionKey: `s-${runId}`, channel: 'whatsapp', origin });

test('only a deliberate silent reply on an ordinary user turn counts as explicit silence; empty, failed and spoken turns do not', () => {
  start('silent-run');
  deliveryRuns.decode('silent-run', JSON.stringify({ version: 2, silent: true, parts: [] }));
  assert.equal(deliveryRuns.explicitSilenceFor('silent-run'), true, 'the model chose not to speak: the host must not add a canned fallback');

  start('spoken-run');
  deliveryRuns.decode('spoken-run', JSON.stringify({ version: 2, silent: false, parts: [{ kind: 'text', text: 'hi' }] }));
  assert.equal(deliveryRuns.explicitSilenceFor('spoken-run'), false);

  start('never-decoded');
  assert.equal(deliveryRuns.explicitSilenceFor('never-decoded'), false, 'a run that produced nothing still gets the host fallback');
  assert.equal(deliveryRuns.explicitSilenceFor('unknown-run'), false);

  start('malformed-run');
  deliveryRuns.decode('malformed-run', '{"version": }');
  assert.equal(deliveryRuns.explicitSilenceFor('malformed-run'), false);

  start('internal-run', 'heartbeat');
  deliveryRuns.decode('internal-run', JSON.stringify({ version: 2, silent: true, parts: [] }));
  assert.equal(deliveryRuns.explicitSilenceFor('internal-run'), false, 'internal silence is not a user turn');
});
