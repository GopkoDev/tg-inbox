import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PostCrumb } from './PostCrumb';
import { usePostStore } from './post-store';

describe('PostCrumb', () => {
  it('says «Post» until the post is known', () => {
    render(<PostCrumb params={{ postId: 'p1' }} />);
    expect(screen.getByText('Post')).toBeInTheDocument();
  });

  it('is registered on the post routes', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(import.meta.dirname, '../../app/routes.tsx'), 'utf8');
    expect(src).toMatch(/Crumb:\s*PostCrumb/);
    expect(usePostStore).toBeDefined();
  });
});
