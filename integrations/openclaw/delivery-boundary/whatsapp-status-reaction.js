async function createWhatsAppStatusReactionController(params) {
	if (!params.msg.event.id) return null;
	if ((params.cfg.messages?.statusReactions)?.enabled !== true) return null;
	const eligibility = await resolveWhatsAppReactionEligibility({
		cfg: params.cfg,
		msg: params.msg,
		agentId: params.agentId,
		sessionKey: params.sessionKey,
		verbose: params.verbose
	});
	if (eligibility.status === "disabled") return null;
	const { chatId, messageId, emoji: initialEmoji, reactionOptions } = eligibility;
	// Amadeus: once a contextual emoji is chosen, every reaction write from the
	// controller's serialized chain lands that emoji, so the terminal state is
	// contextual and ordered after all queued stages (no ✅ or 👀 restore).
	let terminalEmoji;
	let terminal = false;
	const controller = createStatusReactionController({
		enabled: true,
		adapter: {
			setReaction: async (emoji) => {
				await sendReactionWhatsApp(chatId, messageId, terminalEmoji ?? emoji, reactionOptions);
				// A reaction is a message from us: WhatsApp clears our composing
				// indicator on receipt, so the reply plan re-asserts it at once.
				// Terminal writes (done/error/restore/contextual) never re-assert typing.
				if (!terminal) try { controller.onReactionSent?.(); } catch {}
			},
			clearReaction: async () => {
				await sendReactionWhatsApp(chatId, messageId, "", reactionOptions);
			}
		},
		initialEmoji,
		emojis: void 0,
		onError: (err) => {
			logVerbose(`WhatsApp status-reaction error for chat ${chatId}/${messageId}: ${String(err)}`);
		}
	});
	for (const name of ["setDone", "setError", "restoreInitial", "clear"]) {
		const native = controller[name];
		controller[name] = (...args) => { terminal = true; return native(...args); };
	}
	controller.finishWithContextual = (emoji) => {
		terminalEmoji = emoji;
		return controller.setDone();
	};
	return controller;
}
