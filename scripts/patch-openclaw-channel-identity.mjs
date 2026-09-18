#!/usr/bin/env node

import { chmod, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const PATCH_MARKER = 'codex-amadeus-identity-metadata-v1';
const TELEGRAM_USERNAME_MARKER = 'codex-amadeus-telegram-username-v1';
const TELEGRAM_IDENTITY_USERNAME_TTL_MS = 24 * 60 * 60 * 1000;

function optionsFrom(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name.startsWith('--')) throw new Error(`unexpected argument: ${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    options[name.slice(2)] = value;
    index += 1;
  }
  return options;
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label} anchor count=${count}`);
  return source.replace(before, after);
}

async function writeAtomic(path, content, mode) {
  const temporary = `${path}.codex-tmp-${process.pid}`;
  await writeFile(temporary, content);
  await chmod(temporary, mode & 0o777);
  await rename(temporary, path);
}

async function patchFile(path, transform, marker = PATCH_MARKER) {
  const original = await readFile(path, 'utf8');
  if (original.includes(marker)) return false;
  const transformed = transform(original);
  if (transformed === original) throw new Error(`patch made no change: ${path}`);
  const fileMode = (await stat(path)).mode;
  await writeAtomic(path, transformed, fileMode);
  return true;
}

function telegramUsernameSupportSource() {
  return `// ${TELEGRAM_USERNAME_MARKER}
const telegramIdentityUsernameCache = new Map();
function normalizeTelegramIdentityUsername(value) {
	if (value == null) return void 0;
	const normalized = String(value).trim().replace(/^@/u, "").toLocaleLowerCase();
	return normalized || void 0;
}
function telegramIdentityUsernameKey(accountId, conversationId, username) {
	return String(accountId) + String.fromCharCode(0) + String(conversationId) + String.fromCharCode(0) + username;
}
function rememberTelegramIdentityUsername(accountId, conversationId, senderId, senderUsername) {
	const username = normalizeTelegramIdentityUsername(senderUsername);
	const platformUserId = senderId == null ? "" : String(senderId).trim();
	if (!username || !platformUserId) return;
	const cacheKey = telegramIdentityUsernameKey(accountId, conversationId, username);
	const previous = telegramIdentityUsernameCache.get(cacheKey);
	if (previous && previous.platformUserId !== platformUserId) {
		previous.ambiguous = true;
		previous.expiresAt = Date.now() + ${TELEGRAM_IDENTITY_USERNAME_TTL_MS};
		return;
	}
	telegramIdentityUsernameCache.set(cacheKey, {
		platformUserId,
		ambiguous: false,
		expiresAt: Date.now() + ${TELEGRAM_IDENTITY_USERNAME_TTL_MS}
	});
}
function lookupTelegramIdentityUsername(accountId, conversationId, username) {
	const cacheKey = telegramIdentityUsernameKey(accountId, conversationId, username);
	const entry = telegramIdentityUsernameCache.get(cacheKey);
	if (!entry || entry.expiresAt <= Date.now()) {
		telegramIdentityUsernameCache.delete(cacheKey);
		return void 0;
	}
	if (entry.ambiguous) return void 0;
	return entry.platformUserId;
}
function telegramMentionUsername(messageTextParts, entity) {
	if (entity.type !== "mention" || !Number.isInteger(entity.offset) || !Number.isInteger(entity.length)) return void 0;
	const raw = String(messageTextParts.text ?? "").slice(entity.offset, entity.offset + entity.length);
	return normalizeTelegramIdentityUsername(raw);
}
`;
}

function telegramResolverSource() {
  return `function resolveTelegramIdentityMentions(messageTextParts, accountId, conversationId, senderId, senderUsername) {
	rememberTelegramIdentityUsername(accountId, conversationId, senderId, senderUsername);
	return (messageTextParts.entities ?? []).flatMap((entity) => {
		let platformUserId;
		if (entity.type === "text_mention" && entity.user?.id != null) platformUserId = String(entity.user.id);
		if (!platformUserId && entity.type === "mention") {
			const username = telegramMentionUsername(messageTextParts, entity);
			if (username) platformUserId = lookupTelegramIdentityUsername(accountId, conversationId, username);
		}
		if (!platformUserId) return [];
		return [{
			channel: "telegram",
			accountId,
			conversationId,
			platformUserId
		}];
	});
}`;
}

function legacyTelegramResolverSource() {
  return `function resolveTelegramIdentityMentions(messageTextParts, accountId, conversationId) {
	return (messageTextParts.entities ?? []).flatMap((entity) => {
		if (entity.type !== "text_mention" || entity.user?.id == null) return [];
		return [{
			channel: "telegram",
			accountId,
			conversationId,
			platformUserId: String(entity.user.id)
		}];
	});
}`;
}

function patchTelegramCore(source) {
  let result = source;
  result = replaceOnce(
    result,
    'async function resolveStickerVisionSupport$1(params) {',
    `// ${PATCH_MARKER}\n${telegramUsernameSupportSource()}${telegramResolverSource()}\nasync function resolveStickerVisionSupport$1(params) {`,
    'Telegram identity helper',
  );
  result = replaceOnce(
    result,
    '\tconst messageTextParts = getTelegramTextParts(msg);\n',
    '\tconst messageTextParts = getTelegramTextParts(msg);\n\tconst trustedMentionIdentities = resolveTelegramIdentityMentions(messageTextParts, accountId ?? "default", String(chatId), senderId, senderUsername);\n',
    'Telegram mention extraction',
  );
  result = replaceOnce(
    result,
    '\t\tinboundEventKind,\n\t\tmentionFacts: resolveTelegramMentionFacts({',
    '\t\tinboundEventKind,\n\t\ttrustedMentionIdentities,\n\t\tmentionFacts: resolveTelegramMentionFacts({',
    'Telegram body result',
  );
  result = replaceOnce(
    result,
    'effectiveWasMentioned, inboundEventKind, groupRequireMention, mentionFacts, hasControlCommand',
    'effectiveWasMentioned, inboundEventKind, groupRequireMention, trustedMentionIdentities, mentionFacts, hasControlCommand',
    'Telegram context destructuring',
  );
  result = replaceOnce(
    result,
    '\t\tinboundEventKind: bodyResult.inboundEventKind,\n\t\tgroupRequireMention: Boolean(groupRequireMention),',
    '\t\tinboundEventKind: bodyResult.inboundEventKind,\n\t\tgroupRequireMention: Boolean(groupRequireMention),\n\t\ttrustedMentionIdentities: bodyResult.trustedMentionIdentities,',
    'Telegram context input',
  );
  result = replaceOnce(
    result,
    '\t\t\tmentions: mentionFacts\n',
    '\t\t\tmentions: {\n\t\t\t\t...mentionFacts,\n\t\t\t\tmentionedUserIds: trustedMentionIdentities.map((identity) => identity.platformUserId)\n\t\t\t}\n',
    'Telegram tool mention access',
  );
  result = replaceOnce(
    result,
    '\t\textra: {\n\t\t\tBotUsername:',
    '\t\textra: {\n\t\t\tGatewayRunToolBindings: trustedMentionIdentities.length > 0 ? { identity: { mentions: trustedMentionIdentities } } : void 0,\n\t\t\tBotUsername:',
    'Telegram tool bindings',
  );
  return result;
}

function patchTelegramUsernameSupport(source) {
  let result = source;
  result = replaceOnce(
    result,
    `// ${PATCH_MARKER}\n${legacyTelegramResolverSource()}`,
    `// ${PATCH_MARKER}\n${telegramUsernameSupportSource()}${telegramResolverSource()}`,
    'Telegram username identity upgrade',
  );
  result = replaceOnce(
    result,
    '\tconst messageTextParts = getTelegramTextParts(msg);\n\tconst trustedMentionIdentities = resolveTelegramIdentityMentions(messageTextParts, accountId ?? "default", String(chatId));\n',
    '\tconst messageTextParts = getTelegramTextParts(msg);\n\tconst trustedMentionIdentities = resolveTelegramIdentityMentions(messageTextParts, accountId ?? "default", String(chatId), senderId, senderUsername);\n',
    'Telegram username mention extraction upgrade',
  );
  return result;
}

function patchWhatsAppMonitor(source) {
  let result = source;
  result = replaceOnce(
    result,
    'const wasMentioned = params.msg.groupMention?.wasMentioned ?? params.msg.wasMentioned;\n',
    `// ${PATCH_MARKER}\n\tconst wasMentioned = params.msg.groupMention?.wasMentioned ?? params.msg.wasMentioned;\n\tconst trustedMentionIdentities = (params.msg.group?.mentions?.jids ?? []).filter((jid) => typeof jid === "string" && jid.trim()).map((platformUserId) => ({\n\t\tchannel: "whatsapp",\n\t\taccountId: params.route.accountId,\n\t\tconversationId,\n\t\tplatformUserId\n\t}));\n\tconst mentionAccess = wasMentioned !== void 0 || trustedMentionIdentities.length > 0 ? {\n\t\tcanDetectMention: conversationKind === "group",\n\t\twasMentioned,\n\t\tmentionedUserIds: trustedMentionIdentities.map((identity) => identity.platformUserId),\n\t\trequireMention: params.msg.groupMention?.requireMention\n\t} : void 0;\n`,
    'WhatsApp mention extraction',
  );
  result = replaceOnce(
    result,
    '\t\tmentions: wasMentioned !== void 0 ? {\n\t\t\tcanDetectMention: conversationKind === "group",\n\t\t\twasMentioned,\n\t\t\trequireMention: params.msg.groupMention?.requireMention\n\t\t} : void 0,\n',
    '\t\tmentions: mentionAccess,\n\t\tidentityMentions: trustedMentionIdentities,\n',
    'WhatsApp tool mention access',
  );
  result = replaceOnce(
    result,
    '\t\t\textra: {\n\t\t\t\tTranscript:',
    '\t\t\t\textra: {\n\t\t\t\tGatewayRunToolBindings: inbound.identityMentions?.length ? { identity: { mentions: inbound.identityMentions } } : void 0,\n\t\t\t\tTranscript:',
    'WhatsApp tool bindings',
  );
  result = replaceOnce(
    result,
    '\t\t\tid: getPrimaryIdentityId(sender) ?? void 0,\n',
    '\t\t\tid: params.msg.platform.senderJid ?? getPrimaryIdentityId(sender) ?? void 0,\n',
    'WhatsApp stable sender identity',
  );
  return result;
}

async function findFile(root, pattern, requiredText) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isFile() && pattern.test(entry.name)) {
      const content = await readFile(path, 'utf8');
      if (content.includes(requiredText)) return path;
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      const nested = await findFile(path, pattern, requiredText);
      if (nested) return nested;
    }
  }
  return undefined;
}

async function main() {
  const options = optionsFrom(process.argv.slice(2));
  let patched = 0;
  if (options['core-root']) {
    const corePath = join(options['core-root'], 'bot-message-nRw-6GtF.mjs');
    if (await patchFile(corePath, (source) => source.includes(PATCH_MARKER) ? patchTelegramUsernameSupport(source) : patchTelegramCore(source), TELEGRAM_USERNAME_MARKER)) {
      patched += 1;
      console.log(`PATCHED=telegram:${corePath}`);
    } else {
      console.log(`ALREADY_PATCHED=telegram:${corePath}`);
    }
  }
  if (options['whatsapp-root']) {
    const monitorPath = await findFile(options['whatsapp-root'], /^monitor-.*\.js$/u, 'function prepareWhatsAppInboundContext');
    if (!monitorPath) throw new Error(`WhatsApp monitor not found below ${options['whatsapp-root']}`);
    if (await patchFile(monitorPath, patchWhatsAppMonitor)) {
      patched += 1;
      console.log(`PATCHED=whatsapp:${monitorPath}`);
    } else {
      console.log(`ALREADY_PATCHED=whatsapp:${monitorPath}`);
    }
  }
  if (!options['core-root'] && !options['whatsapp-root']) throw new Error('provide --core-root or --whatsapp-root');
  console.log(`PATCH_COUNT=${patched}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
