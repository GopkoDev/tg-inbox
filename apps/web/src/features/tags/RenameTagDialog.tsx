import { ErrorCode, checkTagName, type TagRenameResult, type TagWithCount } from '@tg/shared';
import { Loader2 } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useDialogFocus } from '@/features/inbox/StateChangedDialog';
import { ApiError } from '@/shared/api/client';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { useShellGuard } from '@/shared/ui/app-shell-context';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field, FieldError } from '@/shared/ui/field';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { renameTag } from './api';
import { contactsText } from './DeleteTagDialog';

const NAME_RULES = 'A tag name must be 1 to 32 characters';
const TARGET_CHANGED = 'The tag to merge into changed — check again.';

interface Form {
  tagId: string;
  name: string;
  /** Step 2: the tag that holds the name (from `TAG_NAME_TAKEN` / `TAG_MERGE_TARGET_CHANGED`). */
  target: TagWithCount | null;
  step: 'name' | 'merge';
  nameError: boolean;
  targetChanged: boolean;
  failed: boolean;
}

const fresh = (tag: TagWithCount): Form => ({
  tagId: tag.id,
  name: tag.name,
  target: null,
  step: 'name',
  nameError: false,
  targetChanged: false,
  failed: false,
});

/**
 * SCR-22: rename a tag; renaming into an existing name turns the dialog into step 2, the merge
 * offer (`409 TAG_NAME_TAKEN`), confirmed with `merge_into_tag_id`. A merge target that changed
 * meanwhile asks again. Gone and owners-only refusals are the host's (SCR-21).
 */
export function RenameTagDialog({
  workspaceId,
  tag,
  onClose,
  onDone,
  onGone,
  onOwnerOnly,
}: {
  workspaceId: string;
  /** The tag to rename, as the list shows it; null = closed. */
  tag: TagWithCount | null;
  onClose: () => void;
  onDone: (answer: TagRenameResult, tag: TagWithCount) => void;
  onGone: () => void;
  onOwnerOnly: () => void;
}) {
  const guard = useShellGuard();
  const focus = useDialogFocus();
  const fieldId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [pending, setPending] = useState(false);

  // A newly opened tag starts from its own name (state adjusted while rendering).
  if (tag && form?.tagId !== tag.id) setForm(fresh(tag));
  const shown = tag && form?.tagId === tag.id ? form : tag ? fresh(tag) : null;
  const patch = (next: Partial<Form>) => setForm((f) => (f ? { ...f, ...next } : f));

  const send = async (mergeInto: TagWithCount | null) => {
    if (!tag || !shown) return;
    setPending(true);
    patch({ failed: false, nameError: false });
    try {
      const answer = await renameTag(
        workspaceId,
        tag.id,
        mergeInto ? { name: shown.name, merge_into_tag_id: mergeInto.id } : { name: shown.name },
      );
      setForm(null);
      onDone(answer, tag);
    } catch (error) {
      if (!(error instanceof ApiError)) patch({ failed: true });
      else if (error.code === ErrorCode.TAG_NAME_INVALID) patch({ step: 'name', nameError: true });
      else if (error.code === ErrorCode.TAG_NAME_TAKEN) {
        const holder = (error.details as { tag?: TagWithCount } | undefined)?.tag ?? null;
        patch({ step: 'merge', target: holder, targetChanged: false });
      } else if (error.code === ErrorCode.TAG_MERGE_TARGET_CHANGED) {
        const holder =
          (error.details as { name_holder?: TagWithCount | null } | undefined)?.name_holder ?? null;
        patch(
          holder
            ? { step: 'merge', target: holder, targetChanged: true }
            : { step: 'name', target: null, targetChanged: true },
        );
      } else if (error.code === ErrorCode.TAG_NOT_FOUND) {
        setForm(null);
        onGone();
      } else if (error.code === ErrorCode.OWNER_ONLY) {
        setForm(null);
        onOwnerOnly();
      } else if (error.status === 401 || error.status === 403) {
        setForm(null);
        onClose();
        void guard(error, workspaceId).catch(() => undefined);
      } else patch({ failed: true });
    } finally {
      setPending(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!shown || pending) return;
    if (!checkTagName(shown.name).ok) return patch({ nameError: true, failed: false });
    void send(null);
  };

  const close = () => {
    setForm(null);
    onClose();
  };

  const spinner = pending ? (
    <Loader2 data-testid="dialog-spinner" className="animate-spin" aria-hidden />
  ) : null;
  const notices = shown ? (
    <>
      {shown.targetChanged ? (
        <Alert>
          <AlertDescription>{TARGET_CHANGED}</AlertDescription>
        </Alert>
      ) : null}
      {shown.failed ? (
        <Alert variant="destructive">
          <AlertDescription>Couldn&apos;t rename the tag — try again.</AlertDescription>
        </Alert>
      ) : null}
    </>
  ) : null;

  const merging = shown?.step === 'merge' && shown.target !== null && tag !== null;

  return (
    <Dialog
      open={tag !== null}
      onOpenChange={(next) => {
        if (!next && !pending) close();
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          focus.onOpenAutoFocus();
          event.preventDefault();
          input.current?.focus();
          input.current?.select();
        }}
        onCloseAutoFocus={focus.onCloseAutoFocus}
      >
        {merging && shown.target && tag ? (
          <>
            <DialogHeader>
              <DialogTitle>{`Merge into «${shown.target.name}»?`}</DialogTitle>
              <DialogDescription>
                {`A tag named «${shown.target.name}» already exists (${contactsText(shown.target.contact_count)}). Merging moves the ${contactsText(tag.contact_count)} of «${tag.name}» to «${shown.target.name}» — a contact that has both keeps one — and «${tag.name}» is gone. Each of those contacts' tag history records the merge. This cannot be undone.`}
              </DialogDescription>
            </DialogHeader>
            {notices}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => patch({ step: 'name', targetChanged: false, failed: false })}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={() => void send(shown.target)}
              >
                {spinner}
                Merge tags
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={save} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Rename tag</DialogTitle>
              <DialogDescription className="sr-only">
                The new name of the tag, 1 to 32 characters.
              </DialogDescription>
            </DialogHeader>
            <Field data-invalid={shown?.nameError || undefined}>
              <Label htmlFor={fieldId}>Name</Label>
              <Input
                ref={input}
                id={fieldId}
                value={shown?.name ?? ''}
                aria-invalid={shown?.nameError || undefined}
                onChange={(event) => patch({ name: event.target.value, nameError: false })}
              />
              {shown?.nameError ? <FieldError>{NAME_RULES}</FieldError> : null}
            </Field>
            {notices}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={pending} onClick={close}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {spinner}
                Save
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
