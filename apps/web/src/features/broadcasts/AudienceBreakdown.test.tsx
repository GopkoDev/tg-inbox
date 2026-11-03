import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AudienceBreakdown } from './AudienceBreakdown';

const n = new Intl.NumberFormat();

function renderIt(props: Parameters<typeof AudienceBreakdown>[0]) {
  return render(
    <MemoryRouter>
      <AudienceBreakdown {...props} />
    </MemoryRouter>,
  );
}

const line = (label: string) => screen.getByText(label).closest('[data-line]') as HTMLElement;

describe('AudienceBreakdown (Decision 7; AC-01, AC-10)', () => {
  it('a draft breakdown: four lines with «Would reach» emphasised', () => {
    renderIt({
      breakdown: {
        audience_size: 38,
        reach: { blocked_count: 2, never_wrote_count: 0, reachable_count: 36 },
      },
    });
    expect(line('Audience')).toHaveTextContent('Audience38 contacts');
    expect(line('Left out — blocked the bot')).toHaveTextContent('2');
    expect(line('Left out — never wrote to the current bot')).toHaveTextContent('0');
    expect(line('Would reach')).toHaveTextContent('36');
    expect(screen.getByText('36').tagName).toBe('STRONG');
  });

  it('a launch breakdown reads «Sent to» on the broadcast page', () => {
    renderIt({
      breakdown: {
        audience_size: 10_420,
        blocked_count: 20,
        never_wrote_count: 400,
        recipient_count: 10_000,
      },
      reachLabel: 'Sent to',
    });
    expect(line('Audience')).toHaveTextContent(`${n.format(10_420)} contacts`);
    expect(line('Sent to')).toHaveTextContent(n.format(10_000));
    expect(screen.queryByText('Would reach')).toBeNull();
  });

  it('no bot: only the audience size and that reach is known once a bot is connected', () => {
    renderIt({ breakdown: { audience_size: 1, reach: null } });
    expect(line('Audience')).toHaveTextContent('1 contact');
    expect(screen.getByText('Reach is known once a bot is connected.')).toBeInTheDocument();
    expect(screen.queryByText('Would reach')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open bot settings' })).toBeNull();
  });

  it('no bot, for an owner: the way to the bot settings', () => {
    renderIt({
      breakdown: { audience_size: 3, reach: null },
      botSettingsHref: '/w/x/settings/bot',
    });
    expect(screen.getByRole('link', { name: 'Open bot settings' })).toHaveAttribute(
      'href',
      '/w/x/settings/bot',
    );
  });
});
