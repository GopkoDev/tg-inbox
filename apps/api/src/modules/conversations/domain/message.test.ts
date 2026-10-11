import { describe, expect, it } from 'vitest';
import { isMessageKind, MESSAGE_KINDS } from './message.js';

describe('MESSAGE_KINDS (AC-09)', () => {
  it('mirrors messages_kind_check, other last', () => {
    expect([...MESSAGE_KINDS]).toEqual([
      'text',
      'photo',
      'video',
      'animation',
      'voice',
      'audio',
      'video_note',
      'document',
      'sticker',
      'location',
      'venue',
      'contact',
      'poll',
      'dice',
      'other',
    ]);
  });

  it('recognises only the 15 kinds', () => {
    expect(isMessageKind('voice')).toBe(true);
    expect(isMessageKind('other')).toBe(true);
    expect(isMessageKind('story')).toBe(false);
  });
});
