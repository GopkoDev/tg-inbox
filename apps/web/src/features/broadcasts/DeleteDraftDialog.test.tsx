import { ErrorCode } from '@tg/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({ deleteBroadcast: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  deleteBroadcast: (...a: unknown[]) => api.deleteBroadcast(...a),
}));

import { DeleteDraftDialog } from './DeleteDraftDialog';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const DRAFT = '0198f0c0-0000-7000-8000-000000000501';
const guard = vi.fn();
const handlers = {
  onClose: vi.fn(),
  onDeleted: vi.fn(),
  onLaunched: vi.fn(),
  onGone: vi.fn(),
};

function renderIt(audienceSize = 14) {
  return render(
    <ShellGuardContext.Provider value={guard}>
      <DeleteDraftDialog workspaceId={WS} draft={{ id: DRAFT, audienceSize }} {...handlers} />
    </ShellGuardContext.Provider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
});

describe('SCR-31 DeleteDraftDialog (AC-07)', () => {
  it('default: says what is deleted and that nothing is sent; Cancel is focused', () => {
    renderIt();
    expect(
      screen.getByText(
        "This draft and its audience of 14 contacts will be deleted. This can't be undone. Nothing is sent to anyone.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Delete draft' })).toBeInTheDocument();
  });

  it('deleting: a spinner, both buttons disabled; then deleted', async () => {
    let resolve!: (v: unknown) => void;
    api.deleteBroadcast.mockReturnValue(new Promise((r) => (resolve = r)));
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
    expect(api.deleteBroadcast).toHaveBeenCalledWith(WS, DRAFT);
    expect(screen.getByTestId('dialog-spinner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete draft' })).toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(handlers.onClose).not.toHaveBeenCalled();
    resolve({ workspace_id: WS, broadcast_id: DRAFT });
    await waitFor(() =>
      expect(handlers.onDeleted).toHaveBeenCalledWith({ workspace_id: WS, broadcast_id: DRAFT }),
    );
  });

  it('not the author: the explanation with only Close', async () => {
    api.deleteBroadcast.mockRejectedValue(
      new ApiError(
        403,
        ErrorCode.FORBIDDEN,
        'A draft is deleted by its author or a business owner.',
      ),
    );
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
    expect(
      await screen.findByText('A draft is deleted by its author or a business owner.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete draft' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(handlers.onClose).toHaveBeenCalled();
    expect(guard).not.toHaveBeenCalled();
  });

  it('launched meanwhile: closes to the broadcast page; gone: closes and re-reads', async () => {
    api.deleteBroadcast.mockRejectedValueOnce(
      new ApiError(409, ErrorCode.BROADCAST_NOT_A_DRAFT, 'launched', {
        broadcast_id: DRAFT,
        status: 'sending',
      }),
    );
    const { unmount } = renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
    await waitFor(() => expect(handlers.onLaunched).toHaveBeenCalled());
    unmount();
    api.deleteBroadcast.mockRejectedValueOnce(new ApiError(404, ErrorCode.NOT_FOUND, 'Not found'));
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
    await waitFor(() => expect(handlers.onGone).toHaveBeenCalled());
  });

  it("error: «Couldn't delete the draft», still open; access removed goes to the guard", async () => {
    api.deleteBroadcast.mockRejectedValueOnce(new Error('network'));
    renderIt(1);
    expect(screen.getByText(/its audience of 1 contact will/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
    expect(await screen.findByText("Couldn't delete the draft")).toBeInTheDocument();
    const removed = new ApiError(403, ErrorCode.ACCESS_REMOVED, 'removed');
    api.deleteBroadcast.mockRejectedValueOnce(removed);
    fireEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
    await waitFor(() => expect(guard).toHaveBeenCalledWith(removed, WS));
    expect(handlers.onClose).toHaveBeenCalled();
  });
});
