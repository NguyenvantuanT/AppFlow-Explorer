import { describe, expect, it } from 'vitest';
import { labelOf } from '../canvas/CodePreview';
import { objectFit, rnStyleToCss } from './rnStyle';

describe('rnStyleToCss', () => {
  it('turns points into pixels and keeps unitless properties', () => {
    expect(rnStyleToCss({ width: 40, height: '50%', opacity: 0.5, zIndex: 2, fontWeight: '600' })).toEqual({ width: '40px', height: '50%', opacity: 0.5, zIndex: 2, fontWeight: '600' });
  });

  it('applies margins like React Native: one side over horizontal/vertical over the shorthand', () => {
    expect(rnStyleToCss({ margin: 4, marginHorizontal: 8, marginLeft: 2, paddingVertical: 6 })).toEqual({ marginTop: '4px', marginBottom: '4px', marginLeft: '2px', marginRight: '8px', paddingTop: '6px', paddingBottom: '6px' });
  });

  it('expands flex the React Native way', () => {
    expect(rnStyleToCss({ flex: 1 })).toEqual({ flexGrow: 1, flexShrink: 1, flexBasis: '0%' });
    expect(rnStyleToCss({ flex: 0 })).toEqual({ flexGrow: 0, flexShrink: 0 });
  });

  it('maps text, shadows, transforms and line clamping', () => {
    expect(rnStyleToCss({ fontFamily: 'NotoSansJP-Medium', lineHeight: 20, textDecorationLine: 'underline' })).toMatchObject({ fontWeight: 500, lineHeight: '20px', textDecoration: 'underline' });
    expect(rnStyleToCss({ shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: [{ width: 0, height: 2 }] }).boxShadow).toBe('0px 2px 4px rgba(0,0,0,0.2)');
    expect(rnStyleToCss({ transform: [{ rotate: '180deg' }, { scale: 2 }] }).transform).toBe('rotate(180deg) scale(2)');
    expect(rnStyleToCss({ numberOfLines: 2 })).toMatchObject({ WebkitLineClamp: 2, overflow: 'hidden' });
    expect(objectFit('stretch')).toBe('fill');
  });
});

describe('labels for runtime data', () => {
  it.each([
    ['streamer?.name', 'name'],
    ['item.start_date', 'start_date'],
    ["num?.toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',')", 'num'],
    ['formatMeetingTime(item.start_time, item?.end_time).formattedDate', 'start_time'],
    ['date.getFullYear()', 'date'],
  ])('%s → %s', (expression, label) => {
    expect(labelOf(expression)).toBe(label);
  });
});
