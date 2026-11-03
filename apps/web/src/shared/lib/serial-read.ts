/**
 * One read in flight and at most one more queued (screens.md, Shared states): a trigger during a
 * read schedules exactly one more read after it, however many triggers arrive meanwhile.
 */
export function serialRead(read: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let queued = false;
  const loop = async () => {
    do {
      queued = false;
      await read().catch(() => undefined);
    } while (queued);
    running = null;
  };
  return () => {
    if (running) {
      queued = true;
      return running;
    }
    running = loop();
    return running;
  };
}
