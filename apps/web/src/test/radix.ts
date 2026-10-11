import { fireEvent, screen } from '@testing-library/react';

/** jsdom lacks the browser APIs Radix menus touch; call once per test file. */
export function stubRadixDom() {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
}

/** Open a Radix dropdown from its trigger with the keyboard (reliable under fireEvent). */
export function openMenu(name: string | RegExp) {
  fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' });
}
