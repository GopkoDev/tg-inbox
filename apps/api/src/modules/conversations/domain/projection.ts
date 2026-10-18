import type { MessageKind } from './message.js';

export interface Attachment {
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
}

export interface MessageLocation {
  latitude: number;
  longitude: number;
  venue: { title: string; address: string } | null;
}

export interface SharedContact {
  firstName: string;
  lastName: string | null;
  phoneNumber: string;
}

export interface MessagePoll {
  question: string;
  options: string[];
}

export interface MessageProjection {
  attachment: Attachment | null;
  location: MessageLocation | null;
  sharedContact: SharedContact | null;
  poll: MessagePoll | null;
}

/** A stored file the media route can open; `fileReference` is Telegram's file id and never leaves the API. */
export interface MediaFile extends Attachment {
  fileReference: string;
}

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Kinds whose Telegram object carries a downloadable file, by the field that holds it. */
const FILE_FIELDS: Partial<Record<MessageKind, string>> = {
  video: 'video',
  animation: 'animation',
  voice: 'voice',
  audio: 'audio',
  video_note: 'video_note',
  document: 'document',
  sticker: 'sticker',
};

/** The largest size of a photo (Telegram lists the sizes of one photo). */
function largestPhoto(raw: Raw): Raw | null {
  if (!Array.isArray(raw.photo)) return null;
  let best: Raw | null = null;
  let bestArea = -1;
  for (const size of raw.photo) {
    if (!isObject(size) || typeof size.file_id !== 'string') continue;
    const area = (num(size.width) ?? 0) * (num(size.height) ?? 0);
    if (area > bestArea) {
      best = size;
      bestArea = area;
    }
  }
  return best;
}

/** The file of a message, or null for a kind with none (text, location, poll, …) or a malformed object. */
export function mediaFileOf(kind: MessageKind, raw: Raw): MediaFile | null {
  if (kind === 'photo') {
    const size = largestPhoto(raw);
    if (!size) return null;
    return {
      fileReference: size.file_id as string,
      fileSize: num(size.file_size),
      fileName: null,
      mimeType: 'image/jpeg',
    };
  }
  const field = FILE_FIELDS[kind];
  if (!field) return null;
  const file = raw[field];
  if (!isObject(file) || typeof file.file_id !== 'string' || file.file_id === '') return null;
  return {
    fileReference: file.file_id,
    fileSize: num(file.file_size),
    fileName: str(file.file_name),
    mimeType: str(file.mime_type),
  };
}

function locationOf(kind: MessageKind, raw: Raw): MessageLocation | null {
  if (kind === 'venue' && isObject(raw.venue) && isObject(raw.venue.location)) {
    const { latitude, longitude } = raw.venue.location;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    return {
      latitude,
      longitude,
      venue: { title: str(raw.venue.title) ?? '', address: str(raw.venue.address) ?? '' },
    };
  }
  if (kind === 'location' && isObject(raw.location)) {
    const { latitude, longitude } = raw.location;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    return { latitude, longitude, venue: null };
  }
  return null;
}

/** What the thread shows of a message beyond its text: attachment, location, shared contact, poll. */
export function projectMessage(kind: MessageKind, raw: Raw): MessageProjection {
  const file = mediaFileOf(kind, raw);
  let sharedContact: SharedContact | null = null;
  if (kind === 'contact' && isObject(raw.contact)) {
    const c = raw.contact;
    const firstName = str(c.first_name);
    const phoneNumber = str(c.phone_number);
    if (firstName !== null && phoneNumber !== null) {
      sharedContact = { firstName, lastName: str(c.last_name), phoneNumber };
    }
  }
  let poll: MessagePoll | null = null;
  if (kind === 'poll' && isObject(raw.poll) && Array.isArray(raw.poll.options)) {
    poll = {
      question: str(raw.poll.question) ?? '',
      options: raw.poll.options.map((o) => (isObject(o) ? (str(o.text) ?? '') : '')),
    };
  }
  return {
    attachment: file && {
      fileName: file.fileName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
    },
    location: locationOf(kind, raw),
    sharedContact,
    poll,
  };
}
