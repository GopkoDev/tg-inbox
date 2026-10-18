import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuthLayout } from './auth-layout';

describe('AuthLayout', () => {
  it('renders the product mark, an h1 title, the description and children', () => {
    const { container } = render(
      <AuthLayout title="Sign in to tg-inbox" description="Answer your customers' messages">
        <p>form goes here</p>
      </AuthLayout>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to tg-inbox' })).toBeVisible();
    expect(screen.getByText("Answer your customers' messages")).toBeVisible();
    expect(screen.getByText('form goes here')).toBeVisible();
    expect(container.querySelector('svg.lucide-messages-square')).not.toBeNull();
  });

  it('works without a description', () => {
    render(
      <AuthLayout title="Choose a workspace">
        <p>rows</p>
      </AuthLayout>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Choose a workspace' })).toBeVisible();
    expect(screen.getByText('rows')).toBeVisible();
  });
});
