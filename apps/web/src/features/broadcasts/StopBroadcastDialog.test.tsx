import { ErrorCode } from '@tg/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { ShellGuardContext } from '@/shared/ui/app-shell-context';
import { stubRadixDom } from '@/test/radix';

const api = vi.hoisted(() => ({ stopBroadcast: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  stopBroadcast: (...a: unknown[]) => api.stopBroadcast(...a),
}));

import { StopBroadcastDialog } from './StopBroadcastDialog';

stubRadixDom();

const WS = '0198f0c0-0000-7000-8000-000000000001';
const B = '0198f0c0-0000-7000-8000-000000000501';
const guard = vi.fn();
const handlers = { onClose: vi.fn(), onAnswered: vi.fn(), onOwnerOnly: vi.fn() };

function renderIt(waiting = 22) {
  return render(
    <ShellGuardContext.Provider value={guard}>
      <StopBroadcastDialog workspaceId={WS} broadcastId={B} waiting={waiting} open {...handlers} />
    </ShellGuardContext.Provider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  guard.mockResolvedValue('handled');
});

describe('SCR-29 StopBroadcastDialog (AC-18)', () => {
  it('default: the waiting count from the last read; Keep sending is focused', () => {
    renderIt();
    expect(
      screen.getByText(
        "22 recipients are still waiting. They will not get this message. Sends already on their way finish. A stop can't be undone.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep sending' })).toHaveFocus();
  });

  it('one recipient reads in the singular', () => {
    renderIt(1);
    expect(screen.getByText(/^1 recipient is still waiting\./)).toBeInTheDocument();
  });

  it('stopping: spinner, both disabled, Esc ignored; then the answer goes to the page', async () => {
    let resolve!: (v: unknown) => void;
    api.stopBroadcast.mockReturnValue(new Promise((r) => (resolve = r)));
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Stop broadcast' }));
    expect(api.stopBroadcast).toHaveBeenCalledWith(WS, B);
    expect(screen.getByTestId('dialog-spinner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep sending' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop broadcast' })).toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(handlers.onClose).not.toHaveBeenCalled();
    const answer = { outcome: 'stopped', broadcast: { id: B } };
    resolve(answer);
    await waitFor(() => expect(handlers.onAnswered).toHaveBeenCalledWith(answer));
  });

  it('owners only: closes and hides Stop', async () => {
    api.stopBroadcast.mockRejectedValue(new ApiError(403, ErrorCode.OWNER_ONLY, 'x'));
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Stop broadcast' }));
    await waitFor(() => expect(handlers.onOwnerOnly).toHaveBeenCalled());
    expect(guard).not.toHaveBeenCalled();
  });

  it("error: «Couldn't stop the broadcast» and the confirm enabled again", async () => {
    api.stopBroadcast.mockRejectedValueOnce(new Error('network'));
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Stop broadcast' }));
    expect(await screen.findByText("Couldn't stop the broadcast")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop broadcast' })).toBeEnabled();
  });

  it('access removed: closes and goes to the guard', async () => {
    const removed = new ApiError(403, ErrorCode.ACCESS_REMOVED, 'x');
    api.stopBroadcast.mockRejectedValue(removed);
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Stop broadcast' }));
    await waitFor(() => expect(guard).toHaveBeenCalledWith(removed, WS));
    expect(handlers.onClose).toHaveBeenCalled();
  });
});
