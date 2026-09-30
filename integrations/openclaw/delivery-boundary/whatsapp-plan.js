// Canonical typed integration boundary, OpenClaw/@openclaw/whatsapp 2026.9.4.
// This replaces the entire native reply-plan function, not media/TTS bundles.
function createWhatsAppReplyPlan(params) {
  const boundary = globalThis.__amadeusDeliveryBoundaryV2_20260930;
  if (!boundary || boundary.version !== 2) throw new Error('amadeus_delivery_boundary_unavailable');
  const sessionKey = params.route.sessionKey;
  const messageId = params.inbound.event.id;
  const inboundVoice = params.inbound.media?.some((media) => media.kind === 'audio' || String(media.contentType ?? '').startsWith('audio/')) === true;
  let typingStop;
  let voiceLease;
  const sendComposing = params.transport.sendComposing ?? params.context?.sendComposing ?? (() => Promise.resolve());
  const quote = () => buildQuotedMessageOptions({
    messageId, remoteJid: params.transport.chatJid, fromMe: false,
    participant: params.transport.senderJid, messageText: '',
  });
  const receipt = (result) => {
    if (!result?.providerAccepted) throw new Error('whatsapp_provider_not_accepted');
    const id = listWhatsAppSendResultMessageIds(result)[0];
    return id ? { messageId: id } : {};
  };
  const plan = boundary.createWhatsAppPlan({
    sessionKey, messageId, inboundVoice,
    accountId: params.route.accountId,
    conversationId: params.inbound.conversation.id,
    start: () => {
      if (inboundVoice) voiceLease ??= startAmadeusVoiceReplyLease({ sessionKey, messageId, sendComposing });
      else typingStop ??= startAmadeusWhatsAppTypingIndicator(sendComposing);
    },
    stop: () => { typingStop?.(); typingStop = undefined; closeAmadeusVoiceReplyLeaseForTurn(sessionKey, messageId); },
    sendText: async (text) => {
      const chunks = markdownToWhatsAppChunks(text, params.maxMediaTextChunkLimit ?? resolveTextChunkLimit(params.cfg, 'whatsapp'), resolveMarkdownTableMode$1({ cfg: params.cfg, channel: 'whatsapp', accountId: params.route.accountId }), resolveChunkMode(params.cfg, 'whatsapp', params.route.accountId));
      let sent;
      for (const chunk of chunks) sent = receipt(await params.transport.reply(chunk, quote()));
      if (!sent) throw new Error('whatsapp_text_not_sent');
      return sent;
    },
    sendVoice: async ({ audio, mimeType }) => {
      const native = await prepareWhatsAppOutboundMedia({ buffer: audio, contentType: mimeType, fileName: 'kurisu.mp3' });
      return receipt(await params.transport.sendMedia({ audio: native.buffer, ptt: true, mimetype: native.mimetype }, quote()));
    },
    sendImage: async (asset, caption) => receipt(await params.transport.sendMedia({ image: asset.bytes, mimetype: asset.mimeType, ...(caption ? { caption } : {}) }, quote())),
    // Image MIME cannot affect this payload: no image key/optimizer or fallback.
    sendDocument: async (asset) => receipt(await params.transport.sendMedia({ document: asset.bytes, mimetype: asset.mimeType, fileName: asset.fileName }, quote())),
  });
  const statusReactionController = params.statusReactionController ?? null;
  const replyPolicy = resolveWhatsAppInboundReplyPolicy({
    cfg: params.cfg, ctx: params.context,
    blockStreamingEnabled: resolveChannelStreamingBlockEnabled(params.cfg.channels?.whatsapp),
  });
  plan.afterRecord = () => { if (statusReactionController) statusReactionController.setThinking(); };
  plan.dispatcherOptions = { ...params.replyPipeline, ...plan.dispatcherOptions };
  if (!plan.delivery || plan.delivery.observeMessageSent !== true) throw new Error('delivery_adapter_contract_invalid');
  plan.replyOptions = {
    ...plan.replyOptions,
    ...(params.turnAdoptionLifecycle ? { turnAdoptionLifecycle: params.turnAdoptionLifecycle } : {}),
    onModelSelected: params.onModelSelected,
    suppressTyping: replyPolicy.suppressTyping,
    disableBlockStreaming: true,
    ...(replyPolicy.sourceReplyDeliveryMode ? { sourceReplyDeliveryMode: replyPolicy.sourceReplyDeliveryMode } : {}),
    ...(statusReactionController ? {
      onToolStart: async (payload) => { if (payload.name?.trim()) await statusReactionController.setTool(payload.name.trim()); return false; },
      onCompactionStart: async () => { await statusReactionController.setCompacting(); return false; },
      onCompactionEnd: async () => { statusReactionController.cancelPending(); await statusReactionController.setThinking(); return false; },
    } : {}),
  };
  const settleNativeStatus = plan.finalize;
  plan.finalize = (dispatchResult) => {
    const visible = settleNativeStatus(dispatchResult);
    if (statusReactionController) void finalizeWhatsAppStatusReaction({ controller: statusReactionController, outcome: readAgentRunTerminalOutcome(dispatchResult) === 'failed' || !visible ? 'error' : 'done' });
    if (params.shouldClearGroupHistory) params.groupHistories.set(params.groupHistoryKey, []);
    return visible;
  };
  plan.replyResolver = params.replyResolver;
  return plan;
}
