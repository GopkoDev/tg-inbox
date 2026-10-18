import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubRadixDom } from '@/test/radix';
import { MediaViewer } from './MediaViewer';
import type { MediaState } from './media';

beforeEach(() => stubRadixDom());

const show = (media: MediaState, over: Partial<React.ComponentProps<typeof MediaViewer>> = {}) => {
  const onOpenChange = vi.fn();
  const onRetry = vi.fn();
  render(
    <MediaViewer
      open
      onOpenChange={onOpenChange}
      onRetry={onRetry}
      kind="photo"
      media={media}
      contactName="Ada Lovelace"
      at="10:00"
      caption="new bouquet?"
      {...over}
    />,
  );
  return { onOpenChange, onRetry };
};

describe('MediaViewer (SCR-03)', () => {
  it('default photo: image on our origin, header with name and time, caption', () => {
    show({ status: 'ready', url: 'blob:http://localhost/1', contentType: 'image/jpeg' });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Ada Lovelace');
    expect(dialog).toHaveTextContent('10:00');
    expect(dialog).toHaveTextContent('new bouquet?');
    expect(screen.getByRole('img').getAttribute('src')).toBe('blob:http://localhost/1');
  });

  it('default video: a player with controls', () => {
    show(
      { status: 'ready', url: 'blob:http://localhost/2', contentType: 'video/mp4' },
      { kind: 'video' },
    );
    const video = screen.getByTestId('viewer-video');
    expect(video).toHaveAttribute('controls');
    expect(video.getAttribute('src')).toBe('blob:http://localhost/2');
  });

  it('closes with the close button and with Escape', () => {
    const { onOpenChange } = show({ status: 'ready', url: 'blob:x', contentType: 'image/png' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it('loading: a skeleton', () => {
    show({ status: 'loading' });
    expect(screen.getByTestId('viewer-loading')).toBeInTheDocument();
  });

  it('error 503/416: Telegram is not responding with Try again', () => {
    const { onRetry } = show({ status: 'not_responding' });
    expect(screen.getByText('Telegram is not responding — try again')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('error 409: the same unavailable text as the thread', () => {
    show({ status: 'unavailable', reason: 'file_gone' });
    expect(
      screen.getByText('Content unavailable — Telegram no longer keeps this file'),
    ).toBeInTheDocument();
  });
});
