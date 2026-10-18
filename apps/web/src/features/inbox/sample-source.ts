import { SAMPLE_THREADS, type SampleMessage, type SampleThread } from './sample-data';

/**
 * The inbox preview's only data seam (ADR-0002): read-only, identical for every workspace.
 * Later steps replace these two functions with API calls.
 */
export type SampleConversation = {
  id: string;
  name: string;
  username: string;
  lastMessage: string;
  at: string;
  unread: number;
};

export type { SampleMessage };
export type SampleConversationThread = Pick<SampleThread, 'id' | 'name' | 'username' | 'messages'>;

export function listSampleConversations(): SampleConversation[] {
  return SAMPLE_THREADS.map((t) => ({
    id: t.id,
    name: t.name,
    username: t.username,
    lastMessage: t.messages[t.messages.length - 1]!.text,
    at: t.at,
    unread: t.unread,
  }));
}

export function getSampleConversation(id: string): SampleConversationThread | undefined {
  const t = SAMPLE_THREADS.find((x) => x.id === id);
  if (!t) return undefined;
  return {
    id: t.id,
    name: t.name,
    username: t.username,
    messages: t.messages.map((m) => ({ ...m })),
  };
}
