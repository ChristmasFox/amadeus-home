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
	const controller = createStatusReactionController({
		enabled: true,
		adapter: {
			setReaction: async (emoji) => {
				await sendReactionWhatsApp(chatId, messageId, terminalEmoji ?? emoji, reactionOptions);
			},
			clearReaction: async () => {
				await sendReactionWhatsApp(chatId, messageId, "", reactionOptions);
			}
		},
		initialEmoji,
		emojis: void 0,
		// Flush tool/thinking stages on the next macrotask so short SearXNG /
		// pubg tool calls still paint 🔎/🌐/🛠️ before finalize replaces them.
		timing: { debounceMs: 0 },
		onError: (err) => {
			logVerbose(`WhatsApp status-reaction error for chat ${chatId}/${messageId}: ${String(err)}`);
		}
	});
	controller.finishWithContextual = (emoji) => {
		terminalEmoji = emoji;
		return controller.setDone();
	};
	return controller;
}
