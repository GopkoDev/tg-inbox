import { render, screen } from '@testing-library/react';
import type { ThreadBroadcastItem } from '@tg/shared';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { BroadcastItem } from './BroadcastItem';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const BC = '0198f0c0-0000-7000-8000-000000000301';

const item = (o: Partial<ThreadBroadcastItem> = {}): ThreadBroadcastItem => ({
  type: 'broadcast',
  id: '0198f0c0-0000-7000-8000-000000000401',
  workspace_id: WS,
  conversation_id: '0198f0c0-0000-7000-8000-000000000101',
  broadcast_id: BC,
  broadcast_name: 'Spring prices',
  text: 'Hello\nNew prices',
  launched_by: { account_id: '0198f0c0-0000-7000-8000-000000000501', display_name: 'Test User' },
  state: 'delivered',
  position_at: '2026-10-20T09:00:00.000Z',
  ...o,
});

const renderItem = (i: ThreadBroadcastItem) =>
  render(
    <MemoryRouter>
      <BroadcastItem item={i} at="09:00" />
    </MemoryRouter>,
  );

describe('BroadcastItem (SCR-02, AC-16)', () => {
  it('delivered: the name links to the broadcast, the launching owner, the text and the time', () => {
    renderItem(item());
    const block = screen.getByTestId('broadcast-item');
    expect(screen.getByRole('link', { name: 'Spring prices' })).toHaveAttribute(
      'href',
      `/w/${WS}/broadcasts/${BC}`,
    );
    expect(block.textContent).toContain('Broadcast');
    expect(block.textContent).toContain('sent by Test User');
    expect(block.textContent).toContain('09:00');
    expect(screen.queryByText('Not confirmed')).toBeNull();
    const text = screen.getByTestId('broadcast-item-text');
    expect(text.textContent).toBe('Hello\nNew prices');
    expect(text.className).toContain('whitespace-pre-wrap');
  });

  it('not confirmed: the badge and the send time', () => {
    renderItem(item({ state: 'not_confirmed' }));
    expect(screen.getByText('Not confirmed')).toBeInTheDocument();
    expect(screen.getByTestId('broadcast-item').textContent).toContain(
      'sent at 09:00 — Telegram did not answer',
    );
  });

  it('names a launcher deactivated since, and shows markup literally', () => {
    renderItem(
      item({
        launched_by: {
          account_id: '0198f0c0-0000-7000-8000-000000000502',
          display_name: 'Gone Owner',
        },
        text: '<b>bold</b> **stars**',
      }),
    );
    expect(screen.getByTestId('broadcast-item').textContent).toContain('sent by Gone Owner');
    expect(screen.getByTestId('broadcast-item-text').textContent).toBe('<b>bold</b> **stars**');
    expect(document.querySelector('[data-testid="broadcast-item-text"] b')).toBeNull();
  });
});
