import { Badge } from '@/shared/ui/badge';

const TAGS_SHOWN = 3;

/** A contact's tags as the Contacts list shows them: three `Badge`s, then «+N» naming the rest. */
export function TagBadges({ tags }: { tags: readonly { id: string; name: string }[] }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, TAGS_SHOWN);
  const rest = tags.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((t) => (
        <Badge key={t.id} variant="secondary">
          {t.name}
        </Badge>
      ))}
      {rest > 0 ? (
        <Badge variant="outline" title={tags.map((t) => t.name).join(', ')}>
          +{rest}
        </Badge>
      ) : null}
    </div>
  );
}
