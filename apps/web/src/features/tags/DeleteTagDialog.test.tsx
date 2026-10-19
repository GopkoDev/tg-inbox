import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErrorCode, type TagWithCount } from '@tg/shared';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';

const api = vi.hoisted(() => ({ deleteTag: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  deleteTag: (...a: unknown[]) => api.deleteTag(...a),
}));

import { DeleteTagDialog } from './DeleteTagDialog';

const id = (n: number) => `0198f0c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const WS = id(1);
const OLD: TagWithCount = { id: id(301), name: 'Old promo', contact_count: 40 };
const guard = vi.fn();
const on = { deleted: vi.fn(), gone: vi.fn(), ownerOnly: vi.fn(), close: vi.fn() };
const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => Promise.resolve());
};

function Harness({ tag }: { tag: TagWithCount }) {
  const [open, setOpen] = useState<TagWithCount | null>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(tag)}>
        Delete
      </button>
      <DeleteTagDialog
        workspaceId={WS}
        tag={open}
        onClose={() => {
          on.close();
          setOpen(null);
        }}
        onDeleted={(answer, t) => {
          on.deleted(answer, t);
          setOpen(null);
        }}
        onGone={() => {
          on.gone();
          setOpen(null);
        }}
        onOwnerOnly={() => {
          on.ownerOnly();
          setOpen(null);
        }}
      />
    </>
  );
}
function openDialog(tag: TagWithCount = OLD) {
  render(
    <ShellGuardContext.Provider value={guard}>
      <Harness tag={tag} />
    </ShellGuardContext.Provider>,
  );
  const trigger = screen.getByRole('button', { name: 'Delete' });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}
const confirm = () => screen.getByRole('button', { name: 'Delete tag' });
const deleted = { workspace_id: WS, tag_id: OLD.id, removed_from_count: 40 };
const refusal = (status: number, code: ErrorCode, details?: unknown) =>
  new ApiError(status, code, code, details);

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
});

describe('SCR-23 delete tag (AC-09)', () => {
  it('default: the title, the count text, Cancel focused and Delete tag destructive', async () => {
    openDialog();
    expect(
      await screen.findByRole('alertdialog', { name: 'Delete «Old promo»?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'It will be removed from 40 contacts. Each of them keeps a note in its tag history. This cannot be undone.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
    expect(confirm()).toHaveAttribute('data-variant', 'destructive');
  });

  it('a tag on no contact says so', async () => {
    openDialog({ ...OLD, contact_count: 0 });
    expect(
      await screen.findByText('No contact carries it. This cannot be undone.'),
    ).toBeInTheDocument();
  });

  it('a tag on one contact says «1 contact»', async () => {
    openDialog({ ...OLD, contact_count: 1 });
    expect(await screen.findByText(/It will be removed from 1 contact\./)).toBeInTheDocument();
  });

  it('Cancel closes without a request and focus returns to the row Delete', async () => {
    const trigger = openDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(api.deleteTag).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it('pending: a spinner, both buttons disabled, Esc ignored', async () => {
    let finish: (v: unknown) => void = () => {};
    api.deleteTag.mockReturnValue(new Promise((r) => (finish = r)));
    openDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete tag' }));
    await flush();
    expect(screen.getByTestId('dialog-spinner')).toBeInTheDocument();
    expect(confirm()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await act(async () => finish(deleted));
  });

  it('success: sends the shown count and hands the answer back', async () => {
    api.deleteTag.mockResolvedValue(deleted);
    openDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete tag' }));
    await flush();
    expect(api.deleteTag).toHaveBeenCalledWith(WS, OLD.id, { expected_count: 40 });
    expect(on.deleted).toHaveBeenCalledWith(deleted, OLD);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('asks again on 409 TAG_COUNT_CHANGED with the new number, and sends it next', async () => {
    api.deleteTag.mockRejectedValueOnce(
      refusal(409, ErrorCode.TAG_COUNT_CHANGED, { tag: { ...OLD, contact_count: 41 } }),
    );
    api.deleteTag.mockResolvedValueOnce({ ...deleted, removed_from_count: 41 });
    openDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete tag' }));
    await flush();
    expect(screen.getByText(/It will be removed from 41 contacts\./)).toBeInTheDocument();
    expect(
      screen.getByText('The number of contacts changed since you opened this.'),
    ).toBeInTheDocument();
    expect(on.deleted).not.toHaveBeenCalled();
    fireEvent.click(confirm());
    await flush();
    expect(api.deleteTag).toHaveBeenLastCalledWith(WS, OLD.id, { expected_count: 41 });
    expect(on.deleted).toHaveBeenCalled();
  });

  it('404 TAG_NOT_FOUND closes and reports the tag gone', async () => {
    api.deleteTag.mockRejectedValue(refusal(404, ErrorCode.TAG_NOT_FOUND, { tag_id: OLD.id }));
    openDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete tag' }));
    await flush();
    expect(on.gone).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('403 OWNER_ONLY closes and reports the role lost', async () => {
    api.deleteTag.mockRejectedValue(refusal(403, ErrorCode.OWNER_ONLY));
    openDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete tag' }));
    await flush();
    expect(on.ownerOnly).toHaveBeenCalled();
    expect(guard).not.toHaveBeenCalled();
  });

  it('403 ACCESS_REMOVED goes to the shell guard', async () => {
    const error = refusal(403, ErrorCode.ACCESS_REMOVED);
    api.deleteTag.mockRejectedValue(error);
    openDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete tag' }));
    await flush();
    expect(guard).toHaveBeenCalledWith(error, WS);
  });

  it('network / 500: a destructive alert in the dialog, buttons enabled again', async () => {
    api.deleteTag.mockRejectedValue(new Error('offline'));
    openDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete tag' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't delete the tag — try again.");
    expect(confirm()).toBeEnabled();
  });
});
