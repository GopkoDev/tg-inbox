import { beforeEach, expect, it } from 'vitest';
import { useAuthStore } from './store';

beforeEach(() => useAuthStore.getState().clear());

it('clear() drops account and returnTo', () => {
  useAuthStore.getState().setAccount({ id: 'a', email: 'o@x.io', display_name: 'O' });
  useAuthStore.getState().setReturnTo('/x');
  useAuthStore.getState().clear();
  expect(useAuthStore.getState()).toMatchObject({ account: null, returnTo: null });
});
