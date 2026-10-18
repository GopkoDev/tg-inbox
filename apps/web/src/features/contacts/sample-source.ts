import { SAMPLE_CONTACTS, type SampleHistoryEntry } from './sample-data';

/**
 * The contacts preview's only data seam (ADR-0002): read-only, identical for every workspace.
 * Later steps replace these two functions with API calls.
 */
export type SampleContact = {
  id: string;
  name: string;
  username: string;
  tags: string[];
  language: string;
  firstMessageAt: string;
  lastMessageAt: string;
};

export type { SampleHistoryEntry };
export type SampleContactProfile = SampleContact & { history: SampleHistoryEntry[] };

export function listSampleContacts(): SampleContact[] {
  return SAMPLE_CONTACTS.map((c) => ({
    id: c.id,
    name: c.name,
    username: c.username,
    tags: [...c.tags],
    language: c.language,
    firstMessageAt: c.firstMessageAt,
    lastMessageAt: c.lastMessageAt,
  }));
}

export function getSampleContact(id: string): SampleContactProfile | undefined {
  const c = SAMPLE_CONTACTS.find((x) => x.id === id);
  if (!c) return undefined;
  return { ...c, tags: [...c.tags], history: c.history.map((h) => ({ ...h })) };
}
