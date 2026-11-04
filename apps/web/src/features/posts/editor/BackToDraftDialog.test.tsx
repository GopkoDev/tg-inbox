import { ErrorCode } from '@tg/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({ movePostBackToDraft: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  movePostBackToDraft: (...a: unknown[]) => api.movePostBackToDraft(...a),
}));

import { BackToDraftDialog } from './BackToDraftDialog';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const POST = '0198f0c0-0000-7000-8000-000000000701';
const guard = vi.fn();
const handlers = { onClose: vi.fn(), onMoved: vi.fn(), onTooLate: vi.fn() };

const renderIt = () =>
  render(
    <ShellGuardContext.Provider value={guard}>
      <BackToDraftDialog workspaceId={WS} postId={POST} version={7} {...handlers} />
    </ShellGuardContext.Provider>,
  );

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
});

describe('SCR-44 BackToDraftDialog (AC-11)', () => {
  it('default: says it only goes out when an owner schedules or publishes it again', () => {
    renderIt();
    expect(screen.getByText('Move back to drafts?')).toBeInTheDocument();
    expect(
      screen.getByText("It won't go out unless a business owner schedules or publishes it again."),
    ).toBeInTheDocument();
  });

  it('pending: spinner, then moved with the expected version', async () => {
    let resolve!: (v: unknown) => void;
    api.movePostBackToDraft.mockReturnValue(new Promise((r) => (resolve = r)));
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Move to drafts' }));
    expect(api.movePostBackToDraft).toHaveBeenCalledWith(WS, POST, { expected_version: 7 });
    expect(screen.getByTestId('dialog-spinner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    resolve({ ok: true });
    await waitFor(() => expect(handlers.onMoved).toHaveBeenCalled());
  });

  it('too late: POST_NOT_SCHEDULED says it already went out and the page refreshes', async () => {
    api.movePostBackToDraft.mockRejectedValue(
      new ApiError(409, ErrorCode.POST_NOT_SCHEDULED, 'went out'),
    );
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Move to drafts' }));
    expect(await screen.findByText('It already went out')).toBeInTheDocument();
    expect(handlers.onTooLate).toHaveBeenCalled();
  });

  it('error: an alert in the dialog', async () => {
    api.movePostBackToDraft.mockRejectedValue(new Error('network'));
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Move to drafts' }));
    expect(await screen.findByText("Couldn't move the post to drafts")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to drafts' })).toBeEnabled();
  });
});
