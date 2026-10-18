import type { MessageKind, ThreadMessage } from '@tg/shared';
import { Download, FileText, Maximize2, MapPin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Skeleton } from '@/shared/ui/skeleton';
import { MediaViewer } from './MediaViewer';
import {
  failureState,
  fetchMedia,
  UNAVAILABLE_REASON_TEXT,
  useMessageMedia,
  type MediaState,
} from './media';
import { useInboxStore } from './store';

const KIND_LABEL: Partial<Record<MessageKind, string>> = {
  photo: 'Photo',
  video: 'Video',
  animation: 'Animation',
  voice: 'Voice message',
  audio: 'Audio',
  video_note: 'Video message',
  document: 'File',
  sticker: 'Sticker',
  dice: 'Dice',
};

function fileSize(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** An external map link built from the coordinates; nothing is loaded from it until it is clicked. */
const mapUrl = (lat: number, lon: number) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;

const Caption = ({ text }: { text: string | null }) =>
  text ? <p className="mt-1 break-words whitespace-pre-wrap">{text}</p> : null;

function Failure({ state, retry }: { state: MediaState; retry: () => void }) {
  if (state.status === 'unavailable')
    return (
      <p className="text-muted-foreground">
        Content unavailable — {UNAVAILABLE_REASON_TEXT[state.reason]}
      </p>
    );
  const text =
    state.status === 'not_responding'
      ? 'Telegram is not responding — try again'
      : 'Something went wrong — try again';
  return (
    <Alert variant="destructive">
      <AlertDescription className="flex items-center justify-between gap-2">
        {text}
        <Button type="button" size="sm" variant="outline" onClick={retry}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}

const isFailure = (s: MediaState) =>
  s.status === 'unavailable' || s.status === 'not_responding' || s.status === 'error';

/** Inline media (photo, video, animation, video note, voice, audio, sticker) fetched on render. */
function InlineMedia({
  message,
  workspaceId,
  contactName,
  at,
}: {
  message: ThreadMessage;
  workspaceId: string;
  contactName: string;
  at: string;
}) {
  const { kind } = message;
  const { state, retry } = useMessageMedia({
    workspaceId,
    conversationId: message.conversation_id,
    messageId: message.id,
  });
  const [viewing, setViewing] = useState(false);
  // A 401/403 handed to the guard means the inbox is being left: the viewer closes with it.
  useEffect(
    () =>
      useInboxStore.subscribe((s, prev) => {
        if (s.guardError && s.guardError !== prev.guardError) setViewing(false);
      }),
    [],
  );
  const inline = useRef<HTMLVideoElement>(null);
  const opener = useRef<HTMLElement>(null);
  const label = KIND_LABEL[kind] ?? 'Message';
  const mime = message.attachment?.mime_type ?? null;

  let media: React.ReactNode;
  if (state.status === 'loading')
    media = (
      <Skeleton
        data-testid="media-loading"
        className={kind === 'voice' || kind === 'audio' ? 'h-10 w-64' : 'h-48 w-64'}
      />
    );
  else if (isFailure(state))
    media = (
      <>
        <p className="font-medium">{label}</p>
        <Failure state={state} retry={retry} />
      </>
    );
  else if (state.status === 'ready') {
    const url = state.url;
    if (kind === 'voice' || kind === 'audio')
      media = <audio data-testid="media-audio" src={url} controls className="max-w-full" />;
    else if (kind === 'photo' || (kind === 'sticker' && mime === 'image/webp')) {
      const img = (
        <img
          src={url}
          alt={message.body ?? label}
          className={
            kind === 'sticker' ? 'size-32 object-contain' : 'max-h-72 max-w-full rounded-md'
          }
        />
      );
      media =
        kind === 'photo' ? (
          <button
            ref={opener as React.RefObject<HTMLButtonElement>}
            type="button"
            aria-label="Open photo"
            className="block cursor-zoom-in"
            onClick={() => setViewing(true)}
          >
            {img}
          </button>
        ) : (
          img
        );
    } else {
      const round = kind === 'video_note';
      const loops = kind === 'animation' || kind === 'sticker' || round;
      media = (
        <div className="relative">
          <video
            ref={inline}
            data-testid="media-video"
            src={url}
            controls={kind === 'video'}
            muted={loops}
            loop={loops}
            autoPlay={loops}
            playsInline
            className={
              round ? 'size-48 rounded-full object-cover' : 'max-h-72 max-w-full rounded-md'
            }
          />
          {kind === 'video' ? (
            <Button
              ref={opener as React.RefObject<HTMLButtonElement>}
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Open video"
              className="absolute top-1 right-1 bg-background/70"
              onClick={() => {
                inline.current?.pause();
                setViewing(true);
              }}
            >
              <Maximize2 aria-hidden />
            </Button>
          ) : null}
        </div>
      );
    }
  }

  const viewable = kind === 'photo' || kind === 'video';
  return (
    <>
      {media}
      <Caption text={message.body} />
      {viewable ? (
        <MediaViewer
          open={viewing}
          onOpenChange={setViewing}
          onRetry={retry}
          kind={kind as 'photo' | 'video'}
          media={state}
          contactName={contactName}
          at={at}
          caption={message.body}
          returnFocus={opener}
        />
      ) : null}
    </>
  );
}

/** A document: fetched only when Download is clicked, then saved under its captured name. */
function FileRow({ message, workspaceId }: { message: ThreadMessage; workspaceId: string }) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<MediaState | null>(null);
  const name = message.attachment?.file_name ?? 'File';
  const size = fileSize(message.attachment?.file_size ?? null);

  const download = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const { url } = await fetchMedia({
        workspaceId,
        conversationId: message.conversation_id,
        messageId: message.id,
      });
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setFailure(failureState(error, workspaceId));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <FileText aria-hidden className="size-5 shrink-0" />
        <div className="min-w-0">
          <p className="font-medium break-all">{name}</p>
          {size ? <p className="text-xs text-muted-foreground">{size}</p> : null}
        </div>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={download}>
          <Download aria-hidden />
          Download
        </Button>
      </div>
      {failure ? <Failure state={failure} retry={download} /> : null}
      <Caption text={message.body} />
    </>
  );
}

/**
 * The content of a customer message in the thread (SCR-02 content rows). Everything is plain
 * text; media comes only from our own media route, through the API client.
 */
export function MessageContent({
  message,
  workspaceId,
  contactName,
  at,
}: {
  message: ThreadMessage;
  workspaceId: string;
  contactName: string;
  at: string;
}) {
  const { kind } = message;
  switch (kind) {
    case 'text':
      return <p className="break-words whitespace-pre-wrap">{message.body}</p>;
    case 'document':
      return <FileRow message={message} workspaceId={workspaceId} />;
    case 'photo':
    case 'video':
    case 'animation':
    case 'video_note':
    case 'voice':
    case 'audio':
      return (
        <InlineMedia
          message={message}
          workspaceId={workspaceId}
          contactName={contactName}
          at={at}
        />
      );
    case 'sticker': {
      const mime = message.attachment?.mime_type;
      if (mime === 'image/webp' || mime === 'video/webm')
        return (
          <InlineMedia
            message={message}
            workspaceId={workspaceId}
            contactName={contactName}
            at={at}
          />
        );
      return (
        <>
          <p className="font-medium">Sticker</p>
          <Caption text={message.body} />
        </>
      );
    }
    case 'location':
    case 'venue': {
      const loc = message.location;
      return (
        <>
          <p className="flex items-center gap-1 font-medium">
            <MapPin aria-hidden className="size-4" />
            Location
          </p>
          {loc?.venue ? (
            <>
              <p className="break-words">{loc.venue.title}</p>
              <p className="break-words text-muted-foreground">{loc.venue.address}</p>
            </>
          ) : null}
          {loc ? (
            <>
              <p>
                {loc.latitude}, {loc.longitude}
              </p>
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <a
                  href={mapUrl(loc.latitude, loc.longitude)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in map
                </a>
              </Button>
            </>
          ) : null}
          <Caption text={message.body} />
        </>
      );
    }
    case 'contact': {
      const c = message.shared_contact;
      return (
        <>
          <p className="font-medium">Contact</p>
          {c ? (
            <>
              <p className="break-words">{[c.first_name, c.last_name].filter(Boolean).join(' ')}</p>
              <p className="break-words">{c.phone_number}</p>
            </>
          ) : null}
        </>
      );
    }
    case 'poll':
      return (
        <>
          <p className="font-medium">Poll</p>
          {message.poll ? (
            <>
              <p className="break-words">{message.poll.question}</p>
              <ul className="list-disc pl-5">
                {message.poll.options.map((option, i) => (
                  <li key={i} className="break-words">
                    {option}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      );
    case 'dice':
      return <p className="font-medium">Dice</p>;
    default:
      return (
        <p className="text-muted-foreground">
          Unsupported message — tg-inbox cannot show this kind yet
        </p>
      );
  }
}
