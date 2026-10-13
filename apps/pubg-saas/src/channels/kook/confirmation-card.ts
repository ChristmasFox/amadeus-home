import type { KookTextPayload } from '../../application/kook-message-queue.js';

export interface ConfirmationCardInput {
  title: string;
  detail: string;
  confirmText: string;
  confirmationToken: string;
  actionScope?: 'team' | 'claim' | 'setup';
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

/** Public help controls carry no mutation token or tenant authority. */
export function createOnboardingCard(): KookTextPayload {
  return {
type: 'card', content: JSON.stringify([{
      type: 'card', theme: 'info', size: 'sm', modules: [
        { type: 'header', text: { type: 'plain-text', content: 'PUBG 队伍助手' } },
        { type: 'section', text: { type: 'plain-text', content: '服务器管理员可创建队伍或将当前频道绑定到已有队伍。玩家可在私信中声明关联自己的 PUBG 账号。' } },
        {
type: 'action-group', elements: [
            { type: 'button', theme: 'primary', click: 'return-val', value: 'ui:create', text: { type: 'plain-text', content: '创建队伍' } },
            { type: 'button', theme: 'secondary', click: 'return-val', value: 'ui:bind', text: { type: 'plain-text', content: '绑定已有队伍' } },
            { type: 'button', theme: 'info', click: 'return-val', value: 'ui:claim', text: { type: 'plain-text', content: '关联我的账号' } },
          ]
},
        { type: 'context', elements: [{ type: 'plain-text', content: '输入 /pubg help 查看命令；所有变更均需确认，账号关联不证明所有权。' }] },
      ],
    }])
};
}
