import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../../platform/clock.js';
import { newId } from '../../../platform/ids.js';
import { createPostDeactivation } from './deactivation.js';
import { basePost, fakePostRepo, fakeStore } from './test-fakes.js';

const NOW = new Date('2026-11-03T12:00:00Z');
const WS = newId();
const GONE = newId();
const OTHER = newId();

function setup() {
  const store = fakeStore();
  const deactivation = createPostDeactivation({
    posts: fakePostRepo(store),
    signals: {
      async postChanged(_tx, ws, id) {
        store.signals.push(`post:${ws}:${id}`);
      },
    },
    clock: fixedClock(NOW),
  });
  const seed = (o: Partial<ReturnType<typeof basePost>> = {}) => {
    const p = basePost({
      id: newId(),
      workspaceId: WS,
      state: 'scheduled',
      scheduledByAccountId: GONE,
      scheduledFor: new Date('2026-11-05T09:00:00Z'),
      scheduleKind: 'time',
      ...o,
    });
    store.posts.push(p);
    return p;
  };
  return { store, deactivation, seed };
}

describe('returnScheduledOfDeactivated (AC-11)', () => {
  it('returns every post the deactivated account scheduled to a draft with the notice, version plus one, and signals', async () => {
    const h = setup();
    const a = h.seed();
    const b = h.seed({ version: 3 });
    await h.deactivation.returnScheduledOfDeactivated({} as never, {
      workspaceId: WS,
      accountId: GONE,
    });
    for (const [p, v] of [
      [a, 2],
      [b, 4],
    ] as const) {
      expect(h.store.posts.find((x) => x.id === p.id)).toMatchObject({
        state: 'draft',
        version: v,
        draftNotice: 'owner_deactivated',
        scheduledFor: null,
        scheduledByAccountId: null,
      });
    }
    expect(h.store.signals.sort()).toEqual([`post:${WS}:${a.id}`, `post:${WS}:${b.id}`].sort());
  });

  it('leaves other accounts, other workspaces and non-scheduled posts alone', async () => {
    const h = setup();
    const others = [
      h.seed({ scheduledByAccountId: OTHER }),
      h.seed({ workspaceId: newId() }),
      h.seed({ state: 'published', publishedAt: NOW }),
    ];
    await h.deactivation.returnScheduledOfDeactivated({} as never, {
      workspaceId: WS,
      accountId: GONE,
    });
    expect(h.store.posts.map((p) => p.state)).toEqual(others.map((p) => p.state));
    expect(h.store.signals).toEqual([]);
  });
});
