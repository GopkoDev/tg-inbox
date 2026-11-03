import { ErrorCode } from '@tg/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({ deletePostDraft: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  deletePostDraft: (...a: unknown[]) => api.deletePostDraft(...a),
}));

import { DeletePostDialog } from './DeletePostDialog';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const POST = '0198f0c0-0000-7000-8000-000000000701';
const guard = vi.fn();
const handlers = { onClose: vi.fn(), onDeleted: vi.fn(), onNotADraft: vi.fn() };

const renderIt = () =>
  render(
    <ShellGuardContext.Provider value={guard}>
      <DeletePostDialog workspaceId={WS} postId={POST} {...handlers} />
    </ShellGuardContext.Provider>,
  );

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
});

describe('SCR-42 DeletePostDialog (AC-18)', () => {
  it('default: asks Delete this draft? with Cancel / Delete', () => {
    renderIt();
    expect(screen.getByText('Delete this draft?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('pending: spinner, buttons disabled; then deleted', async () => {
    let resolve!: (v: unknown) => void;
    api.deletePostDraft.mockReturnValue(new Promise((r) => (resolve = r)));
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(api.deletePostDraft).toHaveBeenCalledWith(WS, POST);
    expect(screen.getByTestId('dialog-spinner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    resolve({ ok: true });
    await waitFor(() => expect(handlers.onDeleted).toHaveBeenCalled());
  });

  it('refused AC-18: only the author or a business owner can delete', async () => {
    api.deletePostDraft.mockRejectedValue(new ApiError(403, ErrorCode.FORBIDDEN, 'no'));
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByText('Only the author or a business owner can delete this draft'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(guard).not.toHaveBeenCalled();
  });

  it('not a draft anymore: tells the host', async () => {
    api.deletePostDraft.mockRejectedValue(new ApiError(409, ErrorCode.POST_NOT_A_DRAFT, 'x'));
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(handlers.onNotADraft).toHaveBeenCalled());
  });

  it('failed: an alert and the dialog stays; access removed goes to the guard', async () => {
    api.deletePostDraft.mockRejectedValueOnce(new Error('network'));
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText("Couldn't delete the draft")).toBeInTheDocument();
    const removed = new ApiError(403, ErrorCode.ACCESS_REMOVED, 'removed');
    api.deletePostDraft.mockRejectedValueOnce(removed);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(guard).toHaveBeenCalledWith(removed, WS));
  });
});
