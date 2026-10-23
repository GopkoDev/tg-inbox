// Copying a broadcast into a new draft (sad.md §4 Duplicates; AC-07, AC-13).
import { copyName } from '@tg/shared';

export type DuplicateChoice = 'same' | 'same_tags' | 'all_recipients' | 'not_reached';

/** "Copy of …" within 80 graphemes by the shared name rule. */
export const duplicateName = (sourceName: string): string => copyName(sourceName);

/**
 * Whether a copy audience fits its source: `same` for a draft; `same_tags` for a launched tag
 * audience; `all_recipients` for a launched broadcast; `not_reached` once it has ended.
 */
export const checkDuplicateChoice = (o: {
  status: 'draft' | 'sending' | 'sent' | 'stopped';
  audienceKind: 'tags' | 'group';
  choice: DuplicateChoice;
}): { ok: true } | { ok: false; error: 'invalid' | 'not_ended' } => {
  const launched = o.status !== 'draft';
  switch (o.choice) {
    case 'same':
      return launched ? { ok: false, error: 'invalid' } : { ok: true };
    case 'same_tags':
      return launched && o.audienceKind === 'tags' ? { ok: true } : { ok: false, error: 'invalid' };
    case 'all_recipients':
      return launched ? { ok: true } : { ok: false, error: 'invalid' };
    case 'not_reached':
      if (!launched) return { ok: false, error: 'invalid' };
      return o.status === 'sending' ? { ok: false, error: 'not_ended' } : { ok: true };
  }
};
