import type { KookTextPayload } from '../../application/kook-message-queue.js';

export interface ConfirmationCardInput {
  title: string;
  detail: string;
  confirmText: string;
  confirmationToken: string;
  actionScope?: 'team' | 'claim';
}

function requiredText(value: string, key: string, maxLength: number): string {
  if (typeof value !== 'string') throw new Error(`kook_card_${key}_invalid`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) throw new Error(`kook_card_${key}_invalid`);
  return normalized;
}

/** Builds the small fixed card shape used for one-use confirmation actions. */
export function createConfirmationCard(input: ConfirmationCardInput): KookTextPayload {
  const title = requiredText(input.title, 'title', 100);
  const detail = requiredText(input.detail, 'detail', 1000);
  const confirmText = requiredText(input.confirmText, 'confirm_text', 40);
  const token = requiredText(input.confirmationToken, 'token', 64);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) throw new Error('kook_card_token_invalid');

  const card = [{
    type: 'card',
    theme: 'warning',
    size: 'sm',
    modules: [
      { type: 'header', text: { type: 'plain-text', content: title } },
      { type: 'section', text: { type: 'plain-text', content: detail } },
      {
        type: 'action-group',
        elements: [{
          type: 'button',
          theme: 'danger',
          text: { type: 'plain-text', content: confirmText },
          click: 'return-val',
          value: input.actionScope ? `${input.actionScope}:${token}` : token,
        }],
      },
    ],
  }];
  return { type: 'card', content: JSON.stringify(card) };
}
