import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import type { BroadcastSignals, Executor } from '../app/ports.js';
import { createReportSignals } from './signals.js';

const tx = {} as Executor;

function setup() {
  const clock = fixedClock(new Date('2026-10-23T09:00:00Z'));
  const sent: string[] = [];
  const signals: BroadcastSignals = {
    async broadcastChanged(_tx, workspaceId, broadcastId, change) {
      sent.push(`${change}:${workspaceId}:${broadcastId}`);
    },
  };
  return { clock, sent, reports: createReportSignals(signals, clock) };
}

describe('coalesced report signals (events.md assumption 3, ADR-0011)', () => {
  it('publishes the first report at once and owes the rest of the second, flushed once it is due', async () => {
    const { clock, sent, reports } = setup();
    await reports.report(tx, 'w1', 'b1');
    clock.advance(300);
    await reports.report(tx, 'w1', 'b1');
    await reports.flush(tx, 'w1');
    expect(sent).toEqual(['report:w1:b1']);
    expect(reports.msUntilDue('w1', clock.now())).toBe(700);
    clock.advance(700);
    await reports.flush(tx, 'w1');
    expect(sent).toEqual(['report:w1:b1', 'report:w1:b1']);
    expect(reports.msUntilDue('w1', clock.now())).toBe(0);
  });

  it("keeps each workspace's broadcasts apart: a flush publishes only its own workspace", async () => {
    const { clock, sent, reports } = setup();
    await reports.report(tx, 'w1', 'b1');
    await reports.report(tx, 'w2', 'b2');
    clock.advance(100);
    await reports.report(tx, 'w1', 'b1');
    await reports.report(tx, 'w2', 'b2');
    clock.advance(1_000);
    await reports.flush(tx, 'w1');
    expect(sent).toEqual(['report:w1:b1', 'report:w2:b2', 'report:w1:b1']);
    expect(reports.msUntilDue('w2', clock.now())).toBe(0);
    await reports.flush(tx, 'w2');
    expect(sent.at(-1)).toBe('report:w2:b2');
  });
});
