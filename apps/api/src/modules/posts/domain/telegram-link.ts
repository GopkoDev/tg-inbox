export function telegramLink(p: {
  username: string | null;
  chatId: bigint;
  messageId: number;
}): string | null {
  if (p.username) return `https://t.me/${p.username}/${p.messageId}`;
  const s = p.chatId.toString();
  if (!s.startsWith('-100')) return null;
  return `https://t.me/c/${s.slice(4)}/${p.messageId}`;
}
