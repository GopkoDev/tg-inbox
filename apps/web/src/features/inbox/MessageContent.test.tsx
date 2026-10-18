import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ThreadMessage } from '@tg/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubRadixDom } from '@/test/radix';
import { MessageContent } from './MessageContent';

const WS = '0198f0c0-0000-7000-8000-000000000001';
const CONV = '0198f0c0-0000-7000-8000-000000000101';
const MSG = '0198f0c0-0000-7000-8000-000000000501';
const MEDIA_PATH = `/api/workspaces/${WS}/inbox/conversations/${CONV}/messages/${MSG}/media`;

const message = (over: Partial<ThreadMessage> = {}): ThreadMessage => ({
  type: 'message',
  id: MSG,
  workspace_id: WS,
  conversation_id: CONV,
  kind: 'photo',
  body: null,
  sent_at: '2026-10-18T10:00:00.000Z',
  received_at: '2026-10-18T10:00:00.000Z',
  edited_at: null,
  attachment: { file_name: null, mime_type: 'image/jpeg', file_size: 1000 },
  location: null,
  shared_contact: null,
  poll: null,
  ...over,
});

const bytes = (type: string) =>
  new Response(new Blob(['x'], { type }), { status: 200, headers: { 'content-type': type } });
const problem = (status: number, code: string, details?: unknown) =>
  new Response(JSON.stringify({ error: { code, message: code, details } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const fetchMock = vi.fn();
const revoke = vi.fn();
let created = 0;

beforeEach(() => {
  stubRadixDom();
  fetchMock.mockReset();
  revoke.mockReset();
  created = 0;
  vi.stubGlobal('fetch', fetchMock);
  URL.createObjectURL = vi.fn(() => `blob:http://localhost/${++created}`);
  URL.revokeObjectURL = revoke;
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
});
afterEach(() => vi.unstubAllGlobals());

const show = (m: ThreadMessage, name = 'Ada Lovelace') =>
  render(<MessageContent workspaceId={WS} message={m} contactName={name} at="10:00" />);

describe('MessageContent: media kinds (AC-04)', () => {
  it('shows a photo fetched through the API client with cookies, and its caption', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(bytes('image/jpeg')));
    show(message({ body: 'new bouquet?' }));
    const img = await screen.findByRole('img');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(MEDIA_PATH);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: 'same-origin' });
    expect(img.getAttribute('src')).toMatch(/^blob:/);
    expect(screen.getByText('new bouquet?')).toBeInTheDocument();
  });

  it('shows a loading skeleton while the bytes are in flight', () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    show(message());
    expect(screen.getByTestId('media-loading')).toBeInTheDocument();
  });

  it('revokes the object URL on unmount', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(bytes('image/jpeg')));
    const view = show(message());
    await screen.findByRole('img');
    view.unmount();
    expect(revoke).toHaveBeenCalledWith('blob:http://localhost/1');
  });

  it('shows a webp sticker as an image, a webm sticker as a muted looping video', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(bytes('image/webp')));
    const first = show(
      message({
        kind: 'sticker',
        attachment: { file_name: null, mime_type: 'image/webp', file_size: 10 },
      }),
    );
    expect(await screen.findByRole('img')).toBeInTheDocument();
    first.unmount();
    fetchMock.mockImplementation(() => Promise.resolve(bytes('video/webm')));
    show(
      message({
        kind: 'sticker',
        attachment: { file_name: null, mime_type: 'video/webm', file_size: 10 },
      }),
    );
    const video = await screen.findByTestId('media-video');
    expect(video).toHaveProperty('muted', true);
    expect(video).toHaveProperty('loop', true);
  });

  it('shows an animated .tgs sticker as the kind label, without fetching', () => {
    show(
      message({
        kind: 'sticker',
        body: 'hello',
        attachment: { file_name: null, mime_type: 'application/x-tgsticker', file_size: 10 },
      }),
    );
    expect(screen.getByText('Sticker')).toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a sticker with no type as the kind label', () => {
    show(message({ kind: 'sticker', attachment: null }));
    expect(screen.getByText('Sticker')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('plays an animation as a muted looping video and a video note as a round video', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(bytes('video/mp4')));
    const first = show(message({ kind: 'animation' }));
    const gif = await screen.findByTestId('media-video');
    expect(gif).toHaveProperty('muted', true);
    expect(gif).toHaveProperty('loop', true);
    first.unmount();
    show(message({ kind: 'video_note' }));
    expect((await screen.findByTestId('media-video')).className).toContain('rounded-full');
  });

  it('shows a video with controls and a caption', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(bytes('video/mp4')));
    show(message({ kind: 'video', body: 'watch' }));
    const video = await screen.findByTestId('media-video');
    expect(video).toHaveAttribute('controls');
    expect(video.getAttribute('src')).toMatch(/^blob:/);
    expect(screen.getByText('watch')).toBeInTheDocument();
  });

  it.each(['voice', 'audio'] as const)('plays a %s in an inline audio player', async (kind) => {
    fetchMock.mockImplementation(() => Promise.resolve(bytes('audio/ogg')));
    show(message({ kind, body: 'listen' }));
    const audio = await screen.findByTestId('media-audio');
    expect(audio).toHaveAttribute('controls');
    expect(audio.getAttribute('src')).toMatch(/^blob:/);
    expect(screen.getByText('listen')).toBeInTheDocument();
  });

  it('shows a file row and downloads it under its captured name only on click', async () => {
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(`${this.download}|${this.getAttribute('href')}`);
    });
    fetchMock.mockImplementation(() => Promise.resolve(bytes('application/pdf')));
    show(
      message({
        kind: 'document',
        body: 'the invoice',
        attachment: { file_name: 'invoice.pdf', mime_type: 'application/pdf', file_size: 2048 },
      }),
    );
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.getByText('the invoice')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(names).toHaveLength(1));
    expect(names[0]).toMatch(/^invoice\.pdf\|blob:/);
    expect(fetchMock.mock.calls[0]![0]).toBe(MEDIA_PATH);
  });

  it('calls a nameless file «File» and renders a hostile name as text', () => {
    const first = show(
      message({
        kind: 'document',
        attachment: { file_name: null, mime_type: null, file_size: null },
      }),
    );
    expect(screen.getByText('File')).toBeInTheDocument();
    first.unmount();
    const { container } = show(
      message({
        kind: 'document',
        attachment: { file_name: '<img src=x onerror=alert(1)>', mime_type: null, file_size: 5 },
      }),
    );
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('a file that cannot be opened says so after Download is clicked', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(problem(409, 'MEDIA_UNAVAILABLE', { reason: 'file_too_large' })),
    );
    show(
      message({
        kind: 'document',
        attachment: { file_name: 'big.zip', mime_type: null, file_size: 30_000_000 },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(
      await screen.findByText(/Content unavailable — the file is too large to open in tg-inbox/),
    ).toBeInTheDocument();
  });
});

describe('MessageContent: no media (AC-04)', () => {
  it('shows a location as coordinates with an Open in map link, loading nothing', () => {
    show(
      message({
        kind: 'location',
        attachment: null,
        location: { latitude: 50.45, longitude: 30.52, venue: null },
      }),
    );
    expect(screen.getByText('Location')).toBeInTheDocument();
    expect(screen.getByText(/50\.45/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Open in map' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link.getAttribute('href')).toContain('50.45');
    expect(link.getAttribute('href')).toContain('30.52');
    expect(document.querySelector('img, iframe, video, audio')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a venue with its title and address first', () => {
    show(
      message({
        kind: 'venue',
        attachment: null,
        location: {
          latitude: 1,
          longitude: 2,
          venue: { title: 'Acme Flowers', address: '1 Rose St' },
        },
      }),
    );
    expect(screen.getByText('Acme Flowers')).toBeInTheDocument();
    expect(screen.getByText('1 Rose St')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in map' })).toBeInTheDocument();
  });

  it('shows a shared contact, a poll, a dice and an unsupported message', () => {
    const contact = show(
      message({
        kind: 'contact',
        attachment: null,
        shared_contact: { first_name: 'Grace', last_name: 'Hopper', phone_number: '+380501112233' },
      }),
    );
    expect(screen.getByText('Contact')).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText('+380501112233')).toBeInTheDocument();
    contact.unmount();

    const poll = show(
      message({
        kind: 'poll',
        attachment: null,
        poll: { question: 'Roses or tulips?', options: ['Roses', 'Tulips'] },
      }),
    );
    expect(screen.getByText('Poll')).toBeInTheDocument();
    expect(screen.getByText('Roses or tulips?')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Roses',
      'Tulips',
    ]);
    poll.unmount();

    const dice = show(message({ kind: 'dice', attachment: null }));
    expect(screen.getByText('Dice')).toBeInTheDocument();
    dice.unmount();

    show(message({ kind: 'other', attachment: null }));
    expect(
      screen.getByText('Unsupported message — tg-inbox cannot show this kind yet'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders text and captions as plain text', () => {
    const { container } = show(message({ kind: 'text', attachment: null, body: '<b>hi</b>' }));
    expect(screen.getByText('<b>hi</b>')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });
});

describe('MessageContent: errors (AC-05)', () => {
  it.each([
    ['bot_not_connected', 'the bot is disconnected'],
    ['bot_not_working', 'the bot is not working — it needs a new token'],
    ['file_too_large', 'the file is too large to open in tg-inbox'],
    ['file_gone', 'Telegram no longer keeps this file'],
  ])('409 %s says why, keeping the kind and caption', async (reason, text) => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(problem(409, 'MEDIA_UNAVAILABLE', { reason })),
    );
    show(message({ kind: 'voice', body: 'a caption' }));
    expect(await screen.findByText(`Content unavailable — ${text}`)).toBeInTheDocument();
    expect(screen.getByText('Voice message')).toBeInTheDocument();
    expect(screen.getByText('a caption')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('503 says Telegram is not responding and Try again fetches that message again', async () => {
    fetchMock.mockResolvedValueOnce(problem(503, 'TELEGRAM_UNAVAILABLE'));
    show(message());
    expect(await screen.findByText('Telegram is not responding — try again')).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(bytes('image/jpeg'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('img')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('416 is treated like 503', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(problem(416, 'RANGE_NOT_SATISFIABLE')));
    show(message());
    expect(await screen.findByText('Telegram is not responding — try again')).toBeInTheDocument();
  });

  it('a network failure shows a generic retry', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network'));
    show(message());
    expect(await screen.findByText('Something went wrong — try again')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('MessageContent: every media source stays on our origin (DoD)', () => {
  it.each(['photo', 'video', 'voice', 'animation', 'video_note'] as const)(
    '%s uses only blob: sources',
    async (kind) => {
      fetchMock.mockImplementation(() => Promise.resolve(bytes('image/jpeg')));
      show(message({ kind }));
      await waitFor(() =>
        expect(document.querySelector('img, video, audio')?.getAttribute('src')).toBeTruthy(),
      );
      for (const el of document.querySelectorAll('[src], [href]'))
        expect(el.getAttribute('src') ?? el.getAttribute('href')).toMatch(/^blob:/);
    },
  );
});

describe('MessageContent: opening the viewer', () => {
  it('opens SCR-03 from a photo, pauses nothing, closes on Escape and returns focus', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(bytes('image/jpeg')));
    show(message({ body: 'caption' }), 'Ada Lovelace');
    const open = await screen.findByRole('button', { name: 'Open photo' });
    open.focus();
    fireEvent.click(open);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Ada Lovelace');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(open).toHaveFocus());
  });

  it('opens from a video and pauses the inline player', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(bytes('video/mp4')));
    show(message({ kind: 'video' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open video' }));
    await screen.findByRole('dialog');
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });
});
