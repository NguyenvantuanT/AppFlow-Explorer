import { describe, expect, it } from 'vitest';
import { shopliteProject } from '../mock/shoplite/project';
import { buildSearchItems, createSearcher } from './searchIndex';

const search = createSearcher(buildSearchItems(shopliteProject));

describe('project search', () => {
  it('finds screens by name', () => {
    expect(search('checkout')[0]).toMatchObject({ kind: 'screen', label: 'Checkout' });
  });

  it('finds routes', () => {
    const hit = search('/order-success').find((i) => i.kind === 'route');
    expect(hit?.target).toEqual({ type: 'screen', screenId: 'orderSuccess' });
  });

  it('finds files by path', () => {
    const hit = search('promo_banner').find((i) => i.kind === 'file');
    expect(hit?.detail).toBe('lib/features/home/widgets/promo_banner.dart');
  });

  it('finds widgets with their source location', () => {
    const hit = search('BottomNavigationBar').find((i) => i.kind === 'widget');
    expect(hit?.target).toMatchObject({
      type: 'screen',
      screenId: 'home',
      location: { fileId: 'lib/features/home/home_screen.dart' },
    });
  });

  it('finds navigation actions and reports their status', () => {
    const hit = search('Place order').find((i) => i.kind === 'navigation');
    expect(hit?.status).toBe('inferred');
  });

  it('lists screens for an empty query', () => {
    const results = search('');
    expect(results).toHaveLength(shopliteProject.screens.length);
    expect(results.every((r) => r.kind === 'screen')).toBe(true);
  });
});
