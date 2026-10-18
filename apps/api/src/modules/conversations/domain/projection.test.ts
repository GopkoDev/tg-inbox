import { describe, expect, it } from 'vitest';
import { mediaFileOf, projectMessage } from './projection.js';

describe('projectMessage', () => {
  it('projects a photo attachment from its largest size, never exposing the file id', () => {
    const p = projectMessage('photo', {
      photo: [
        { file_id: 'small', width: 90, height: 90, file_size: 1000 },
        { file_id: 'big', width: 800, height: 800, file_size: 183402 },
      ],
    });
    expect(p).toEqual({
      attachment: { fileName: null, mimeType: 'image/jpeg', fileSize: 183402 },
      location: null,
      sharedContact: null,
      poll: null,
    });
    expect(JSON.stringify(p)).not.toContain('big');
  });

  it('projects a document with its name, type and size', () => {
    const p = projectMessage('document', {
      document: { file_id: 'f', file_name: 'a.pdf', mime_type: 'application/pdf', file_size: 12 },
    });
    expect(p.attachment).toEqual({ fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 12 });
  });

  it('projects a location, a venue, a contact and a poll', () => {
    expect(
      projectMessage('location', { location: { latitude: 50.45, longitude: 30.52 } }),
    ).toMatchObject({
      location: { latitude: 50.45, longitude: 30.52, venue: null },
    });
    expect(
      projectMessage('venue', {
        venue: { location: { latitude: 1, longitude: 2 }, title: 'Shop', address: 'Main 1' },
      }).location,
    ).toEqual({ latitude: 1, longitude: 2, venue: { title: 'Shop', address: 'Main 1' } });
    expect(
      projectMessage('contact', { contact: { first_name: 'Ann', phone_number: '+1' } })
        .sharedContact,
    ).toEqual({ firstName: 'Ann', lastName: null, phoneNumber: '+1' });
    expect(
      projectMessage('poll', { poll: { question: 'Q?', options: [{ text: 'a' }, { text: 'b' }] } })
        .poll,
    ).toEqual({ question: 'Q?', options: ['a', 'b'] });
  });

  it('projects nothing for a text, and tolerates a malformed object', () => {
    expect(projectMessage('text', { text: 'hi' }).attachment).toBeNull();
    expect(projectMessage('photo', {}).attachment).toBeNull();
    expect(projectMessage('location', { location: 'x' }).location).toBeNull();
  });
});

describe('mediaFileOf', () => {
  it('returns the largest photo size as the file reference', () => {
    expect(
      mediaFileOf('photo', {
        photo: [
          { file_id: 'small', width: 1, height: 1 },
          { file_id: 'big', width: 9, height: 9, file_size: 5 },
        ],
      }),
    ).toEqual({ fileReference: 'big', fileSize: 5, fileName: null, mimeType: 'image/jpeg' });
  });

  it('returns the file of a voice note, and null for kinds with no file', () => {
    expect(mediaFileOf('voice', { voice: { file_id: 'v', mime_type: 'audio/ogg' } })).toEqual({
      fileReference: 'v',
      fileSize: null,
      fileName: null,
      mimeType: 'audio/ogg',
    });
    for (const kind of ['text', 'location', 'poll', 'contact', 'venue', 'dice', 'other'] as const) {
      expect(mediaFileOf(kind, { location: { file_id: 'x' } })).toBeNull();
    }
    expect(mediaFileOf('document', {})).toBeNull();
  });
});
