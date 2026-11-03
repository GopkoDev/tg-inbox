import { describe, expect, it } from 'vitest';
import { TelegramUnavailableError } from '../../../platform/errors.js';
import { createDeletePost } from './delete-post.js';

describe('deletePost (AC-15)', () => {
  it('no answer from Telegram is TelegramUnavailableError, not a refusal', async () => {
    const del = createDeletePost({
      bots: {
        async findByWorkspace() {
          return { id: 'b', state: 'connected', telegramBotId: 1n };
        },
        async findForCheck() {
          return { token: 'tok' };
        },
      },
      telegram: {
        async deletePost() {
          return { outcome: 'no_answer' };
        },
      },
      markNeedsToken: async () => {},
    } as never);
    await expect(
      del.deletePost({ workspaceId: 'w', telegramBotId: 1n, chatId: '-1', messageId: 5n }),
    ).rejects.toBeInstanceOf(TelegramUnavailableError);
  });
});
