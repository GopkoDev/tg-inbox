import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErrorCode, type TagWithCount } from '@tg/shared';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';

const api = vi.hoisted(() => ({ renameTag: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  renameTag: (...a: unknown[]) => api.renameTag(...a),
}));

import { RenameTagDialog } from './RenameTagDialog';

const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const WS = id(1);
const LOYAL: TagWithCount = { id: id(301), name: 'Loyal', contact_count: 3 };
const VIP: TagWithCount = { id: id(302), name: 'VIP', contact_count: 12 };
const VIP_GOLD: TagWithCount = { id: id(303), name: 'vip', contact_count: 5 };
const guard = vi.fn();
const on = { done: vi.fn(), gone: vi.fn(), ownerOnly: vi.fn(), close: vi.fn() };
const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => Promise.resolve());
};
const refusal = (status: number, code: ErrorCode, details?: unknown) =>
  new ApiError(status, code, code, details);
const result = (
  outcome: 'renamed' | 'merged' | 'unchanged',
  tag: TagWithCount,
  merged: string | null = null,
) => ({ workspace_id: WS, outcome, tag, merged_tag_id: merged });

function Harness({ tag }: { tag: TagWithCount }) {
  const [open, setOpen] = useState<TagWithCount | null>(null);
  const shut = () => setOpen(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(tag)}>
        Rename
      </button>
      <RenameTagDialog
        workspaceId={WS}
        tag={open}
        onClose={() => {
          on.close();
          shut();
        }}
        onDone={(answer, t) => {
          on.done(answer, t);
          shut();
        }}
        onGone={() => {
          on.gone();
          shut();
        }}
        onOwnerOnly={() => {
          on.ownerOnly();
          shut();
        }}
      />
    </>
  );
}
async function openDialog(tag: TagWithCount = LOYAL) {
  render(
    <ShellGuardContext.Provider value={guard}>
      <Harness tag={tag} />
    </ShellGuardContext.Provider>,
  );
  const trigger = screen.getByRole('button', { name: 'Rename' });
  trigger.focus();
  fireEvent.click(trigger);
  await screen.findByRole('dialog');
  return trigger;
}
const nameField = () => screen.getByLabelText('Name') as HTMLInputElement;
const typeName = (text: string) => fireEvent.change(nameField(), { target: { value: text } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
const RULES = 'A tag name must be 1 to 32 characters';
const MERGE_TEXT =
  "A tag named «VIP» already exists (12 contacts). Merging moves the 3 contacts of «Loyal» to «VIP» — a contact that has both keeps one — and «Loyal» is gone. Each of those contacts' tag history records the merge. This cannot be undone.";

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
});

describe('SCR-22 rename (AC-09)', () => {
  it('default: «Rename tag», the Name field prefilled and selected, Cancel / Save', async () => {
    await openDialog();
    expect(screen.getByRole('dialog', { name: 'Rename tag' })).toBeInTheDocument();
    expect(nameField()).toHaveValue('Loyal');
    await waitFor(() => expect(nameField()).toHaveFocus());
    expect(nameField().selectionStart).toBe(0);
    expect(nameField().selectionEnd).toBe(5);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it.each([
    ['empty', '   '],
    ['33 characters', 'x'.repeat(33)],
  ])('validation (%s): the rule in place, nothing sent', async (_label, text) => {
    await openDialog();
    typeName(text);
    save();
    expect(screen.getByText(RULES)).toBeInTheDocument();
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(api.renameTag).not.toHaveBeenCalled();
  });

  it('a server TAG_NAME_INVALID shows the same rule', async () => {
    api.renameTag.mockRejectedValue(refusal(400, ErrorCode.TAG_NAME_INVALID));
    await openDialog();
    typeName('Loyal friends');
    save();
    await flush();
    expect(screen.getByText(RULES)).toBeInTheDocument();
  });

  it('pending: a spinner on Save, both buttons disabled, Esc ignored', async () => {
    let finish: (v: unknown) => void = () => {};
    api.renameTag.mockReturnValue(new Promise((r) => (finish = r)));
    await openDialog();
    typeName('Loyal friends');
    save();
    await flush();
    expect(screen.getByTestId('dialog-spinner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => finish(result('renamed', { ...LOYAL, name: 'Loyal friends' })));
  });

  it('renamed: sends the name, closes and hands the answer back; focus returns to Rename', async () => {
    const answer = result('renamed', { ...LOYAL, name: 'Loyal friends' });
    api.renameTag.mockResolvedValue(answer);
    const trigger = await openDialog();
    typeName('Loyal friends');
    save();
    await flush();
    expect(api.renameTag).toHaveBeenCalledWith(WS, LOYAL.id, { name: 'Loyal friends' });
    expect(on.done).toHaveBeenCalledWith(answer, LOYAL);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('unchanged: closes, nothing else', async () => {
    api.renameTag.mockResolvedValue(result('unchanged', LOYAL));
    await openDialog();
    save();
    await flush();
    expect(on.done).toHaveBeenCalledWith(result('unchanged', LOYAL), LOYAL);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Cancel closes without a request', async () => {
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.renameTag).not.toHaveBeenCalled();
    expect(on.close).toHaveBeenCalled();
  });
});

describe('SCR-22 merge step (AC-09)', () => {
  async function toMergeStep() {
    api.renameTag.mockRejectedValueOnce(refusal(409, ErrorCode.TAG_NAME_TAKEN, { tag: VIP }));
    await openDialog();
    typeName('vip');
    save();
    await flush();
  }

  it('TAG_NAME_TAKEN turns the dialog into the merge offer with both counts', async () => {
    await toMergeStep();
    expect(screen.getByRole('dialog', { name: 'Merge into «VIP»?' })).toBeInTheDocument();
    expect(screen.getByText(MERGE_TEXT)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge tags' })).toHaveAttribute(
      'data-variant',
      'destructive',
    );
    expect(screen.queryByLabelText('Name')).toBeNull();
  });

  it('Back returns to the name field with the typed name kept', async () => {
    await toMergeStep();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('dialog', { name: 'Rename tag' })).toBeInTheDocument();
    expect(nameField()).toHaveValue('vip');
  });

  it('Merge tags sends merge_into_tag_id from the refusal and hands the merged answer back', async () => {
    await toMergeStep();
    const answer = result('merged', { ...VIP, contact_count: 14 }, LOYAL.id);
    api.renameTag.mockResolvedValueOnce(answer);
    fireEvent.click(screen.getByRole('button', { name: 'Merge tags' }));
    await flush();
    expect(api.renameTag).toHaveBeenLastCalledWith(WS, LOYAL.id, {
      name: 'vip',
      merge_into_tag_id: VIP.id,
    });
    expect(on.done).toHaveBeenCalledWith(answer, LOYAL);
  });

  it('merge target changed, with a holder: step 2 again naming it, with the notice', async () => {
    await toMergeStep();
    api.renameTag.mockRejectedValueOnce(
      refusal(409, ErrorCode.TAG_MERGE_TARGET_CHANGED, { name_holder: VIP_GOLD }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Merge tags' }));
    await flush();
    expect(screen.getByRole('dialog', { name: 'Merge into «vip»?' })).toBeInTheDocument();
    expect(screen.getByText(/A tag named «vip» already exists \(5 contacts\)/)).toBeInTheDocument();
    expect(screen.getByText('The tag to merge into changed — check again.')).toBeInTheDocument();
    api.renameTag.mockResolvedValueOnce(result('merged', VIP_GOLD, LOYAL.id));
    fireEvent.click(screen.getByRole('button', { name: 'Merge tags' }));
    await flush();
    expect(api.renameTag).toHaveBeenLastCalledWith(WS, LOYAL.id, {
      name: 'vip',
      merge_into_tag_id: VIP_GOLD.id,
    });
  });

  it('merge target changed, no holder: step 1 with the notice; Save renames plainly', async () => {
    await toMergeStep();
    api.renameTag.mockRejectedValueOnce(
      refusal(409, ErrorCode.TAG_MERGE_TARGET_CHANGED, { name_holder: null }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Merge tags' }));
    await flush();
    expect(screen.getByRole('dialog', { name: 'Rename tag' })).toBeInTheDocument();
    expect(screen.getByText('The tag to merge into changed — check again.')).toBeInTheDocument();
    api.renameTag.mockResolvedValueOnce(result('renamed', { ...LOYAL, name: 'vip' }));
    save();
    await flush();
    expect(api.renameTag).toHaveBeenLastCalledWith(WS, LOYAL.id, { name: 'vip' });
  });
});

describe('SCR-22 refusals (AC-11, AC-14)', () => {
  it('404 TAG_NOT_FOUND closes and reports the tag gone', async () => {
    api.renameTag.mockRejectedValue(refusal(404, ErrorCode.TAG_NOT_FOUND, { tag_id: LOYAL.id }));
    await openDialog();
    typeName('New');
    save();
    await flush();
    expect(on.gone).toHaveBeenCalled();
  });

  it('403 OWNER_ONLY closes and reports the role lost', async () => {
    api.renameTag.mockRejectedValue(refusal(403, ErrorCode.OWNER_ONLY));
    await openDialog();
    typeName('New');
    save();
    await flush();
    expect(on.ownerOnly).toHaveBeenCalled();
    expect(guard).not.toHaveBeenCalled();
  });

  it('network / 500: a destructive alert, buttons enabled again', async () => {
    api.renameTag.mockRejectedValue(new Error('offline'));
    await openDialog();
    typeName('New');
    save();
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't rename the tag — try again.");
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
