# Gate Memory Human Acceptance and Privacy

This checklist is for a separately approved Gate-Local test using a dedicated
test Bot and consenting test account. It is not a deployment or M2 clearance.
Keep Gate M2 paused until the owner records the completed acceptance through
the separate local procedure. Do not use Lab accounts, production users, or
real personal facts in synthetic checks.

## Preconditions

- Confirm the Gate-Local candidate SHA, Gate Bot account ID, and database
  target through the Gate operator's protected configuration.
- Confirm memory read and write flags are enabled independently for the
  acceptance window. Confirm embedding status separately; lexical fallback is
  an acceptable explicit result when embeddings are unavailable.
- Use a consenting test account. Explain that Gate stores raw KOOK
  conversations and that memory deletion does not erase those transcripts or
  protected database backups.
- Do not enable Light/REM consent or operator auto-learning unless the test is
  specifically exercising that separate behavior. Never create a cron or
  long-running consolidation worker for acceptance.

## Private-message checks

1. In a DM with the Gate test Bot, ask `列出我的记忆`. Record the initial
   result without including private content in the release report.
2. Ask Gate to remember a harmless synthetic preference, for example
   `请记住，我喜欢用中文看 PUBG 周报。` Confirm the reply says it is scoped
   to the sender's private memory.
3. Ask the same fact in a different way. Confirm the relevant memory is
   available to the answer and that the result label reports `semantic` or
   the truthful lexical fallback reason.
4. Ask `更正我的周报偏好为简短中文摘要` and then `列出我的记忆`. Confirm
   the current revision is shown and the old revision no longer participates
   in recall.
5. Ask Gate to forget that preference. Ask the paraphrased question again and
   list memories. Confirm the forgotten value is not returned.
6. Repeat the same prompts from a second test user and, if available, a
   second test Bot. Confirm no first-user memory appears.
7. Send `/pubg memory light status`, `/pubg memory light on`, and
   `/pubg memory light off` in the test user's DM. Confirm consent status,
   explicit operator gating, and revocation behavior. Repeat for REM only if
   its low-frequency batch path has been separately approved. A group command
   must not grant personal DM consent.

## Group and history checks

1. In a bound test channel, ask about a harmless synthetic team note. Confirm
   only the current channel/team/binding scope can provide it.
2. Repeat from another channel or tenant. Confirm the first channel's note is
   absent. Rebind the original channel to a different test team and confirm
   its previous binding generation does not enter the new context.
3. Check a quoted message outside the recent working window and a large
   synthetic history. Confirm the quote remains scope-fenced and recent
   context stays within its documented estimate rather than truncating all
   historical retrieval to a newest-N memory list.
4. Confirm the agent continues ordinary chat when semantic search is
   unavailable and reports the actual fallback/degradation state.

For each check record only the test case ID, source SHA, result label, and
pass/fail. Do not copy user messages, memory content, tokens, or identifiers
into Git or a public issue.

## Privacy and deletion semantics

- Long-term memory is separate from the durable KOOK transcript. A memory
  `forget` immediately tombstones that memory and removes it from retrieval;
  queued indexing work observes revocation before it can restore a vector.
- Forget does **not** erase the original KOOK message, assistant transcript,
  idempotency receipt, or prior protected backup. Backups remain subject to the
  Gate operator's retention and access controls. A full transcript-erasure
  policy is a separate product and recovery decision.
- A user can list, correct, or forget their own private memories in a DM.
  Group messages do not become private memories. Long-term memory cannot
  grant Bot, tenant, PUBG team, or channel permissions.
- Light and REM are separate opt-ins. User consent alone does not enable
  operator auto-learning; operator enablement alone does not replace personal
  consent. Revoking consent invalidates queued admissions and unconfirmed
  candidates. Consolidation candidates require the owner's confirmation
  before becoming durable memory.
- Read, write, auto-learning, and embedding have independent operator flags.
  Every flag defaults off. A deploy does not enable them.

## Evidence record

Store the completed human acceptance reference outside Git with the protected
Gate-Local operator state. `pnpm devctl configure gate-m2-clear` records the
operator decision only after acceptance is complete; it does not modify a
running service. Keep `PROVIDER_PROBE_VERIFIED` and
`GATE_LOCAL_LIVE_VERIFIED` blocked until their separately authorized checks
have actually run.
