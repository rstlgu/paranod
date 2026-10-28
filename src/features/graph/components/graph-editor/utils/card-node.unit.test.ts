import { describe, expect, it } from 'vitest';
import {
  CARD_WIDTH,
  cardFieldLabel,
  cardFields,
  cardImage,
  cardSize,
  cardTitle,
  formatCardText,
  isCardNode
} from './card-node';

describe('card nodes', () => {
  it('shows a card only when the plugin asked for it on an entity type', () => {
    const metadata = { nodeView: 'card' };
    expect(isCardNode({ type: 'social', metadata })).toBe(true);
    expect(isCardNode({ type: 'breach', metadata })).toBe(true);
    expect(isCardNode({ type: 'note', metadata })).toBe(false);
    expect(isCardNode({ type: 'pdf', metadata })).toBe(false);
    expect(isCardNode({ type: 'social', metadata: {} })).toBe(false);
  });

  it('lists every data field but no rendering or provenance keys', () => {
    expect(
      cardFields({
        nodeView: 'card',
        customTitle: 'GitHub',
        customColor: '#000000',
        image: 'https://example.com/a.png',
        logoDomain: 'github.com',
        value: 'ada',
        provider: 'OSINT Industries',
        module: 'github',
        _autoEdit: true,
        Name: 'Ada Lovelace',
        followers: 12,
        verified: true,
        Tags: ['Registered', 2, { nested: true }],
        Empty: '  ',
        Raw: { nested: true },
        Missing: null
      })
    ).toEqual([
      ['Name', 'Ada Lovelace'],
      ['followers', 12],
      ['Tags', ['Registered', '2']]
    ]);
  });

  it('accepts only http images without credentials', () => {
    expect(cardImage({ image: 'https://i.example.com/a.jpg' })).toBe(
      'https://i.example.com/a.jpg'
    );
    expect(cardImage({ image: 'javascript:alert(1)' })).toBeUndefined();
    expect(cardImage({ image: 'https://user:pass@example.com/a.jpg' })).toBeUndefined();
    expect(cardImage({ image: 'not a url' })).toBeUndefined();
    expect(cardImage(undefined)).toBeUndefined();
  });

  it('drops the platform prefix the header already shows', () => {
    expect(
      cardTitle({
        label: 'GitHub · Ada Lovelace',
        metadata: { customTitle: 'GitHub' }
      })
    ).toBe('Ada Lovelace');
    expect(cardTitle({ label: 'Renamed by hand', metadata: { customTitle: 'GitHub' } })).toBe(
      'Renamed by hand'
    );
    expect(cardTitle({ label: 'Stewart-Roberts', metadata: {} })).toBe('Stewart-Roberts');
  });

  it('formats keys and timestamps for reading', () => {
    expect(cardFieldLabel('Creation Date')).toBe('Creation Date');
    expect(cardFieldLabel('learning_language')).toBe('Learning language');
    expect(cardFieldLabel('lastSeen')).toBe('Last Seen');
    expect(formatCardText('2019-03-05T15:34:38')).toBe('2019-03-05 15:34:38');
    expect(formatCardText('2019-03-05T15:34:38.000Z')).toBe('2019-03-05 15:34:38');
    expect(formatCardText('Joined 2019-03-05T15:34')).toBe('Joined 2019-03-05T15:34');
  });

  it('sizes new cards from their row count within bounds', () => {
    const rows = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`Field ${index}`, 'x'])
      );
    expect(cardSize({})).toEqual({ width: CARD_WIDTH, height: 160 });
    expect(cardSize(rows(4)).height).toBe(238);
    expect(cardSize(rows(40)).height).toBe(414);
  });
});
