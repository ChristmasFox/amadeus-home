import { Static, Type } from 'typebox';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import {
  identityAddAlias,
  identityBindChannel,
  identityConfirmCandidate,
  identityGetPerson,
  identityLinkAccount,
  identityListCandidates,
  identityResolve,
  type IdentityAddAliasInput,
  type IdentityBindChannelInput,
  type IdentityConfirmCandidateInput,
  type IdentityGetPersonInput,
  type IdentityLinkAccountInput,
  type IdentityListCandidatesInput,
  type IdentityResolveInput,
} from '../../identity.js';
import { configFor } from '../../config.js';
import { registerTool } from '../../shared/register-tool.js';

const IdentityResolveParameters = Type.Object({
  reference: Type.Union([
    Type.Literal('self'), Type.Literal('alias'), Type.Literal('person'), Type.Literal('mention'), Type.Literal('reply_sender'),
  ]),
  alias: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  personId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  scope: Type.Optional(Type.Union([Type.Literal('global'), Type.Literal('group')])),
  mentionIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 64 })),
}, { additionalProperties: false });

const IdentityGetPersonParameters = Type.Object({
  personId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
}, { additionalProperties: false });

const IdentityBindChannelParameters = Type.Object({
  personId: Type.String({ minLength: 1, maxLength: 128 }),
  target: Type.Optional(Type.Union([Type.Literal('current_sender'), Type.Literal('mention'), Type.Literal('reply_sender')])),
  mentionIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 64 })),
}, { additionalProperties: false });

const IdentityAddAliasParameters = Type.Object({
  personId: Type.String({ minLength: 1, maxLength: 128 }),
  alias: Type.String({ minLength: 1, maxLength: 128 }),
  scope: Type.Union([Type.Literal('global'), Type.Literal('group')]),
  source: Type.Union([Type.Literal('confirmed'), Type.Literal('observed')]),
  confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  evidenceSummary: Type.Optional(Type.String({ maxLength: 512 })),
}, { additionalProperties: false });

const IdentityLinkAccountParameters = Type.Object({
  personId: Type.String({ minLength: 1, maxLength: 128 }),
  provider: Type.String({ minLength: 1, maxLength: 128 }),
  externalId: Type.String({ minLength: 1, maxLength: 256 }),
  label: Type.Optional(Type.String({ maxLength: 256 })),
}, { additionalProperties: false });

const IdentityListCandidatesParameters = Type.Object({
  scope: Type.Optional(Type.Union([Type.Literal('global'), Type.Literal('group')])),
}, { additionalProperties: false });

const IdentityConfirmCandidateParameters = Type.Object({
  candidateId: Type.String({ minLength: 1, maxLength: 128 }),
}, { additionalProperties: false });

export function registerIdentity(api: OpenClawPluginApi): void {
  registerTool(api, 'identity_resolve', 'MANDATORY FIRST ROUTE for identity questions: before any memory_search or memory_get, call this once for every named alias with reference=alias and alias=X, and for 我/我的/本人 with reference=self. Never use USER.md to answer 我是谁, never substitute Arthur/owner for an unbound sender, and never treat a tool failure as not_found. Scoped facts stay in the current direct or group session; never widen recall across conversations, and missing scope means unavailable. Only when an alias is not_found and the question is about past conversation may you call same-session sessions_search then sessions_history; retrieval failure is unknown, not absence. Resolve a canonical Person from trusted sender metadata, a preloaded/confirmed alias, or a person id. Alias resolution checks group aliases before global presets. This tool never treats a channel display name, phone number, or JID as a PUBG account.', IdentityResolveParameters, async (params, context) => identityResolve(configFor(api), params as Static<typeof IdentityResolveParameters> as IdentityResolveInput, context));
  registerTool(api, 'identity_get_person', 'Read one canonical Person, including confirmed aliases, channel bindings, and provider-neutral external accounts.', IdentityGetPersonParameters, async (params) => identityGetPerson(configFor(api), params as Static<typeof IdentityGetPersonParameters> as IdentityGetPersonInput));
  registerTool(api, 'identity_bind_channel', 'Owner-confirm a trusted current sender, mention, or replied sender as a canonical Person. Channel identity comes only from OpenClaw metadata, never from tool text.', IdentityBindChannelParameters, async (params, context) => identityBindChannel(configFor(api), params as Static<typeof IdentityBindChannelParameters> as IdentityBindChannelInput, context));
  registerTool(api, 'identity_add_alias', 'Add a confirmed alias or a group-scoped observed alias candidate. Observed candidates never become reliable without confirmation.', IdentityAddAliasParameters, async (params, context) => identityAddAlias(configFor(api), params as Static<typeof IdentityAddAliasParameters> as IdentityAddAliasInput, context));
  registerTool(api, 'identity_link_account', 'Owner-confirm a provider-neutral external account for a Person, such as a PUBG account. The provider and external id are explicit structured values.', IdentityLinkAccountParameters, async (params, context) => identityLinkAccount(configFor(api), params as Static<typeof IdentityLinkAccountParameters> as IdentityLinkAccountInput, context));
  registerTool(api, 'identity_list_candidates', 'List persisted observed nickname candidates for the current conversation or requested scope; this does not resolve them as reliable identities.', IdentityListCandidatesParameters, async (params, context) => identityListCandidates(configFor(api), params as Static<typeof IdentityListCandidatesParameters> as IdentityListCandidatesInput, context));
  registerTool(api, 'identity_confirm_candidate', 'Owner-confirm one persisted observed nickname candidate so it becomes an authoritative alias.', IdentityConfirmCandidateParameters, async (params, context) => identityConfirmCandidate(configFor(api), params as Static<typeof IdentityConfirmCandidateParameters> as IdentityConfirmCandidateInput, context));
}
