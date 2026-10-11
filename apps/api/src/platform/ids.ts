import { v7 } from 'uuid';

/** UUIDv7 — every primary key is generated here, never by a DB default. */
export function newId(): string {
  return v7();
}
