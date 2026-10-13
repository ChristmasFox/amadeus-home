import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { AccountClaimService, migratePublicDatabase, parseTrustedKookDirectMessage } from '../src/index.js';

const databaseUrl = process.env.PUBG_SAAS_TEST_DATABASE_URL;

function directEvent(userId: string, botId: string) {
  return parseTrustedKookDirectMessage({
    s: 0,
    d: {
      channel_type: 'PERSON',
      type: 1,
      target_id: botId,
      author_id: userId,
      content: 'claim account',
      msg_id: randomUUID(),
      msg_timestamp: Date.now(),
      extra: { author: { id: userId, bot: false } },
    },
  }, botId)!;
}

test('account claim confirmations are private, one-use, self-declared and conflict-safe', { skip: !databaseUrl }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  const suffix = randomUUID();
  const botId = `bot-${suffix}`;
  const userA = `user-a-${suffix}`;
  const userB = `user-b-${suffix}`;
  const userC = `user-c-${suffix}`;
  const accountA = `account-a-${suffix}`;
  const accountB = `account-b-${suffix}`;
  const service = new AccountClaimService(pool);
  const eventA = directEvent(userA, botId);
  const eventB = directEvent(userB, botId);
  const eventC = directEvent(userC, botId);
  assert.ok(eventA && eventB && eventC);

  try {
    await migratePublicDatabase(pool);
    const claimA = await service.prepareClaim(eventA, { pubgShard: 'steam', pubgAccountId: accountA });
    await assert.rejects(service.confirm(eventB, claimA.confirmationToken), /account_claim_confirmation_unavailable/u);
    assert.equal(await service.getMyClaim(eventA), null);
    assert.deepEqual(await service.confirm(eventA, claimA.confirmationToken), {
      kind: 'claim',
      claim: { pubgShard: 'steam', pubgAccountId: accountA, claimStatus: 'self_declared' },
    });
    assert.deepEqual(await service.getMyClaim(eventA), { pubgShard: 'steam', pubgAccountId: accountA, claimStatus: 'self_declared' });
    await assert.rejects(service.confirm(eventA, claimA.confirmationToken), /account_claim_confirmation_unavailable/u);
    await assert.rejects(service.prepareClaim(eventA, { pubgShard: 'steam', pubgAccountId: accountB }), /account_claim_already_bound/u);

    const unclaimFirst = await service.prepareUnclaim(eventA);
    const unclaimStale = await service.prepareUnclaim(eventA);
    assert.deepEqual(await service.confirm(eventA, unclaimFirst.confirmationToken), { kind: 'unclaim', removed: true });
    const claimB = await service.prepareClaim(eventA, { pubgShard: 'steam', pubgAccountId: accountB });
    await service.confirm(eventA, claimB.confirmationToken);
    await assert.rejects(service.confirm(eventA, unclaimStale.confirmationToken), /account_claim_confirmation_unavailable/u);
    assert.deepEqual(await service.getMyClaim(eventA), { pubgShard: 'steam', pubgAccountId: accountB, claimStatus: 'self_declared' });

    const accountAClaim = await service.prepareClaim(eventB, { pubgShard: 'steam', pubgAccountId: accountA });
    await service.confirm(eventB, accountAClaim.confirmationToken);
    const hijack = await service.prepareClaim(eventC, { pubgShard: 'steam', pubgAccountId: accountA });
    await assert.rejects(service.confirm(eventC, hijack.confirmationToken), /account_claim_conflict/u);
    assert.equal(await service.getMyClaim(eventC), null);
  } finally {
    await pool.query('DELETE FROM pending_account_claims WHERE bot_account_id=$1', [botId]).catch(() => undefined);
    await pool.query('DELETE FROM account_claims WHERE bot_account_id=$1', [botId]).catch(() => undefined);
    await pool.query('DELETE FROM channel_identities WHERE platform=$1 AND bot_account_id=$2 AND user_id = ANY($3::text[])', ['kook', botId, [userA, userB, userC]]).catch(() => undefined);
    await pool.end();
  }
});
