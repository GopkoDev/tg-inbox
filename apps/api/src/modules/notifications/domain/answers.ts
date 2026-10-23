/** What the bot answers in a private chat with a member (TG-02). Plain text, links on their own line. */
export type AnswerKind =
  | 'connected'
  | 'already_connected'
  | 'cannot_connect'
  | 'link_expired'
  | 'notifications_off'
  | 'chat_only_notifications';

export type CannotConnectReason = 'telegram_linked_to_teammate' | 'member_linked_elsewhere';

export interface AnswerContext {
  workspaceName: string;
  workspaceId: string;
  /** The panel's base address, with or without a trailing slash. */
  panelUrl: string;
  /** Required for `cannot_connect`. */
  reason?: CannotConnectReason;
}

export function answerText(kind: AnswerKind, ctx: AnswerContext): string {
  const base = `${ctx.panelUrl.replace(/\/+$/, '')}/w/${ctx.workspaceId}`;
  const name = ctx.workspaceName;
  switch (kind) {
    case 'connected':
      return `You're connected to ${name}. I'll message you here when customers are waiting for a reply.\nTo stop, disconnect Telegram in the panel:\n${base}/settings/notifications`;
    case 'already_connected':
      return `You're already connected to ${name} with this Telegram account.`;
    case 'cannot_connect':
      if (ctx.reason === 'telegram_linked_to_teammate') {
        return `This Telegram account can't be connected: it already receives notifications for another member of ${name}.`;
      }
      if (ctx.reason === 'member_linked_elsewhere') {
        return `This Telegram account can't be connected: you're already connected from another Telegram account — disconnect it in the panel first.\n${base}/settings/notifications`;
      }
      throw new Error('cannot_connect needs a reason');
    case 'link_expired':
      // No workspace detail and no link: the sender may not be a member.
      return 'This connect link has expired. Get a new one in the panel, in Settings → Notifications.';
    case 'notifications_off':
      return `Notifications from ${name} are off. You can connect again in the panel at any time.`;
    case 'chat_only_notifications':
      return `This chat only sends notifications from ${name}. Replies to customers are written in the panel:\n${base}/inbox`;
  }
}
