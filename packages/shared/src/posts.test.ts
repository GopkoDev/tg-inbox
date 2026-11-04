import { describe, expect, it } from 'vitest';
import * as shared from './index.js';
import { ErrorCode, LiveFrame } from './index.js';

const W = '0191a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b';
const P = '0191a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5c';

const NEW_CODES = [
  'POST_TEXT_INVALID',
  'POST_DRAFT_CHANGED',
  'POST_NOT_A_DRAFT',
  'POST_NOT_SCHEDULED',
  'POST_NOT_PUBLISHED',
  'POST_SCHEDULE_OUT_OF_RANGE',
  'POST_TIME_DOES_NOT_EXIST',
  'POST_DAILY_LIMIT_REACHED',
  'POST_SCHEDULED_LIMIT_REACHED',
  'POST_DELETE_WINDOW_PASSED',
  'POST_DELETE_REFUSED',
  'DESTINATION_UNAVAILABLE',
  'DESTINATION_LIMIT_REACHED',
  'POSTS_NEED_WORKING_BOT',
  'TIME_ZONE_REQUIRED',
  'TIME_ZONE_INVALID',
  'TIME_ZONE_CHANGED',
];

describe('post error codes', () => {
  it('declares the 17 new codes', () => {
    const declared = Object.values(ErrorCode as Record<string, string>);
    for (const code of NEW_CODES) expect(declared).toContain(code);
  });
});

describe('post live frames', () => {
  it('post.changed carries ids only', () => {
    const frame = { type: 'post.changed', v: 1, workspace_id: W, post_id: P };
    expect(LiveFrame.parse(frame)).toEqual(frame);
    expect(LiveFrame.safeParse({ ...frame, post_id: undefined }).success).toBe(false);
  });
  it('destinations.changed carries the workspace id only', () => {
    const frame = { type: 'destinations.changed', v: 1, workspace_id: W };
    expect(LiveFrame.parse(frame)).toEqual(frame);
  });
});

describe('post contracts', () => {
  const s = shared as unknown as Record<
    string,
    { safeParse: (v: unknown) => { success: boolean } }
  >;
  it('PostState lists the eight states', () => {
    for (const st of [
      'draft',
      'scheduled',
      'sending',
      'published',
      'failed',
      'missed',
      'not_confirmed',
      'deleted',
    ])
      expect(s.PostState?.safeParse(st).success).toBe(true);
    expect(s.PostState?.safeParse('queued').success).toBe(false);
  });
  it('PostSave requires expected_version >= 1', () => {
    expect(
      s.PostSave?.safeParse({ expected_version: 1, text: 'Hi', destination_id: null }).success,
    ).toBe(true);
    expect(s.PostSave?.safeParse({ text: 'Hi' }).success).toBe(false);
    expect(s.PostSave?.safeParse({ expected_version: 0 }).success).toBe(false);
  });
  it('PostCreate refuses text over 4096 UTF-16 units', () => {
    expect(s.PostCreate?.safeParse({ text: 'a'.repeat(4096), destination_id: P }).success).toBe(
      true,
    );
    expect(s.PostCreate?.safeParse({ text: 'a'.repeat(4097) }).success).toBe(false);
  });
});
