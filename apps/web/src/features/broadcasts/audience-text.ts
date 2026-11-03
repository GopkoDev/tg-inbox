import type { LaunchedBroadcast } from '@tg/shared';

/** The audience as it was defined at launch, with the tag names then (SCR-28, SCR-30). */
export function audienceText(audience: LaunchedBroadcast['audience']): string {
  if (audience.kind === 'group') return 'Hand-picked group';
  if (audience.mode === 'none') return 'Contacts with no tags';
  const chosen = audience.tags.filter((t) => t.kind === 'include').map((t) => t.name);
  const left = audience.tags.filter((t) => t.kind === 'exclude').map((t) => t.name);
  const base =
    chosen.length === 0
      ? 'Every contact'
      : `${audience.mode === 'all' ? 'All of' : 'Any of'} ${chosen.join(', ')}`;
  return left.length > 0 ? `${base} · leaving out ${left.join(', ')}` : base;
}
