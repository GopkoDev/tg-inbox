import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { turnOff, turnOn } from './desktop';

const WS = '0198f0c0-0000-7000-8000-000000000001';

beforeEach(() => {
  localStorage.clear();
  const Fake = function () {} as unknown as typeof Notification;
  Object.defineProperty(Fake, 'permission', { get: () => 'granted' });
  vi.stubGlobal('Notification', Fake);
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register: vi.fn(async () => ({})), getRegistration: vi.fn(async () => undefined) },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('desktop opt-in (W1)', () => {
  it('turnOn refuses an empty account id and stores nothing', async () => {
    await expect(turnOn('', WS)).rejects.toThrow(/account/);
    expect(localStorage.length).toBe(0);
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled();
  });

  it('turnOff refuses an empty account id', async () => {
    await expect(turnOff('', WS)).rejects.toThrow(/account/);
  });
});
