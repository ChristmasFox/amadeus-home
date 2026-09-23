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
  registerTool(api, 'identity_resolve', 'Resolve a canonical Person from trusted current sender/mention metadata, a preloaded or confirmed alias, or a person id. For any natural-language question about who a name/nickname refers to or whether it is known, call with reference=alias before answering; a tool failure is not a not-found result. If not_found and the question asks about a past conversation, use sessions_search; use memory_search only for durable memory files, and never use filesystem listing as a retrieval fallback. Alias resolution checks a group alias first and falls back to the global preset unless global-only scope is requested. For a person-specific PUBG request, pass the resolved personId to the PUBG tool. This tool never treats a channel display name, phone number, or JID as a PUBG account.', IdentityResolveParameters, async (params, context) => identityResolve(configFor(api), params as Static<typeof IdentityResolveParameters> as IdentityResolveInput, context));
  registerTool(api, 'identity_get_person', 'Read one canonical Person, including confirmed aliases, channel bindings, and provider-neutral external accounts.', IdentityGetPersonParameters, async (params) => identityGetPerson(configFor(api), params as Static<typeof IdentityGetPersonParameters> as IdentityGetPersonInput));
  registerTool(api, 'identity_bind_channel', 'Owner-confirm a trusted current sender, mention, or replied sender as a canonical Person. Channel identity comes only from OpenClaw metadata, never from tool text.', IdentityBindChannelParameters, async (params, context) => identityBindChannel(configFor(api), params as Static<typeof IdentityBindChannelParameters> as IdentityBindChannelInput, context));
  registerTool(api, 'identity_add_alias', 'Add a confirmed alias or a group-scoped observed alias candidate. Observed candidates never become reliable without confirmation.', IdentityAddAliasParameters, async (params, context) => identityAddAlias(configFor(api), params as Static<typeof IdentityAddAliasParameters> as IdentityAddAliasInput, context));
  registerTool(api, 'identity_link_account', 'Owner-confirm a provider-neutral external account for a Person, such as a PUBG account. The provider and external id are explicit structured values.', IdentityLinkAccountParameters, async (params, context) => identityLinkAccount(configFor(api), params as Static<typeof IdentityLinkAccountParameters> as IdentityLinkAccountInput, context));
  registerTool(api, 'identity_list_candidates', 'List persisted observed nickname candidates for the current conversation or requested scope; this does not resolve them as reliable identities.', IdentityListCandidatesParameters, async (params, context) => identityListCandidates(configFor(api), params as Static<typeof IdentityListCandidatesParameters> as IdentityListCandidatesInput, context));
  registerTool(api, 'identity_confirm_candidate', 'Owner-confirm one persisted observed nickname candidate so it becomes an authoritative alias.', IdentityConfirmCandidateParameters, async (params, context) => identityConfirmCandidate(configFor(api), params as Static<typeof IdentityConfirmCandidateParameters> as IdentityConfirmCandidateInput, context));
}
