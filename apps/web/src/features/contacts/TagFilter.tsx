import type { TagFilterMode, TagWithCount } from '@tg/shared';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Label } from '@/shared/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import type { ContactsAddress } from './address';

type Value = Pick<ContactsAddress, 'mode' | 'tagIds'>;

function buttonLabel({ mode, tagIds }: Value): string {
  if (mode === 'none') return 'No tags';
  if (tagIds.length === 0) return 'Tags';
  if (mode === 'all') return `All of ${tagIds.length} ${tagIds.length === 1 ? 'tag' : 'tags'}`;
  return `Tags · ${tagIds.length}`;
}

/**
 * The Contacts list's tag filter (SCR-18): one popover behind a **Tags** button with the mode
 * (any of / all of / no tags) and one checkbox per workspace tag with its contact count. «No tags»
 * is a mode of its own: it clears the chosen tags and disables the checkboxes.
 */
export function TagFilter({
  tags,
  mode,
  tagIds,
  onChange,
}: {
  tags: TagWithCount[];
  mode: TagFilterMode;
  tagIds: string[];
  onChange: (next: Value) => void;
}) {
  const chooseMode = (next: string) => {
    if (next === 'none') onChange({ mode: 'none', tagIds: [] });
    else onChange({ mode: next as TagFilterMode, tagIds });
  };
  const toggle = (id: string, checked: boolean) => {
    const rest = tagIds.filter((t) => t !== id);
    // checking a tag while «No tags» is chosen switches to «Any of»
    onChange({
      mode: mode === 'none' ? 'any' : mode,
      tagIds: checked ? [...rest, id] : rest,
    });
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline">
          {buttonLabel({ mode, tagIds })}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex w-(--radix-popover-trigger-width) min-w-70 flex-col gap-3"
      >
        <RadioGroup value={mode} onValueChange={chooseMode} aria-label="Tag filter mode">
          {tags.length > 0 ? (
            <>
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="any" />
                Any of these tags
              </Label>
              <Label className="flex items-center gap-2 font-normal">
                <RadioGroupItem value="all" />
                All of these tags
              </Label>
            </>
          ) : null}
          <Label className="flex items-center gap-2 font-normal">
            <RadioGroupItem value="none" />
            No tags
          </Label>
        </RadioGroup>
        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tags yet — tags are added on a contact</p>
        ) : (
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto border-t pt-3">
            {tags.map((tag) => (
              <Label
                key={tag.id}
                className="flex items-center gap-2 font-normal aria-disabled:opacity-50"
                aria-disabled={mode === 'none'}
              >
                <Checkbox
                  checked={tagIds.includes(tag.id)}
                  disabled={mode === 'none'}
                  onCheckedChange={(v) => toggle(tag.id, v === true)}
                />
                <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                <span className="text-xs text-muted-foreground">{tag.contact_count}</span>
              </Label>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
