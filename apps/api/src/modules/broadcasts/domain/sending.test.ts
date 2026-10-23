import { describe, expect, it } from 'vitest';
import {
  LINK_MS,
  MAX_IN_FLIGHT,
  PACE_PER_SECOND,
  REPORT_COALESCE_MS,
  ReportCoalescer,
  SEND_TIMEOUT_MS,
  START_SPACING_MS,
  nextTurn,
} from './sending.js';

describe('pace constants (ADR-0008, AC-15)', () => {
  it('25 per second at 40 ms start slots, 8 in flight, a 20 s link, 1 s report coalescing', () => {
    expect(PACE_PER_SECOND).toBe(25);
    expect(START_SPACING_MS).toBe(40);
    expect(1000 / START_SPACING_MS).toBe(PACE_PER_SECOND);
    expect(MAX_IN_FLIGHT).toBe(8);
    expect(LINK_MS).toBe(20_000);
    expect(SEND_TIMEOUT_MS).toBe(10_000);
    expect(REPORT_COALESCE_MS).toBe(1_000);
  });
});

describe('round-robin turns (AC-15)', () => {
  const sending = ['b-oldest', 'b-middle', 'b-newest'];
  it('starts with the oldest launch and serves each sending broadcast in turn', () => {
    const served: string[] = [];
    let last: string | null = null;
    for (let i = 0; i < 7; i++) {
      last = nextTurn(sending, last);
      served.push(last!);
    }
    expect(served).toEqual([
      'b-oldest',
      'b-middle',
      'b-newest',
      'b-oldest',
      'b-middle',
      'b-newest',
      'b-oldest',
    ]);
  });
  it('keeps serving one broadcast alone; none when nothing sends', () => {
    expect(nextTurn(['only'], null)).toBe('only');
    expect(nextTurn(['only'], 'only')).toBe('only');
    expect(nextTurn([], null)).toBeNull();
    expect(nextTurn([], 'gone')).toBeNull();
  });
  it('a last-served broadcast that ended meanwhile hands the turn to the next by launch order', () => {
    expect(nextTurn(['b-oldest', 'b-newest'], 'b-middle')).toBe('b-oldest');
  });
});

describe('report coalescing (events.md assumption 3)', () => {
  it('publishes at most once per second per broadcast and owes a trailing publish', () => {
    const c = new ReportCoalescer();
    expect(c.shouldPublish('a', 0)).toBe(true);
    expect(c.shouldPublish('a', 400)).toBe(false);
    expect(c.shouldPublish('b', 400)).toBe(true);
    expect(c.flushDue(999)).toEqual([]);
    expect(c.flushDue(1000)).toEqual(['a']);
    expect(c.flushDue(1000)).toEqual([]);
    expect(c.shouldPublish('a', 1500)).toBe(false);
    expect(c.shouldPublish('a', 2000)).toBe(true);
    expect(c.flushDue(5000)).toEqual([]);
  });
  it('pending lists the broadcasts that still owe a publish', () => {
    const c = new ReportCoalescer();
    c.shouldPublish('a', 0);
    c.shouldPublish('a', 10);
    expect(c.pending()).toEqual(['a']);
  });
});
