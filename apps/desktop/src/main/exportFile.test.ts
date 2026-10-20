import { describe, expect, it } from 'vitest';
import { parseSaveRequest, safeFileName } from './exportFile';

describe('parseSaveRequest', () => {
  const ok = { suggestedName: 'shop-flow-map.json', content: '{}', extension: 'json' };

  it('accepts a well-formed request', () => {
    expect(parseSaveRequest(ok)).toEqual(ok);
  });

  it.each([
    ['no object', null],
    ['unknown extension', { ...ok, extension: 'exe' }],
    ['prototype key', { ...ok, extension: 'toString' }],
    ['non-string content', { ...ok, content: 42 }],
    ['missing name', { ...ok, suggestedName: undefined }],
  ])('rejects %s', (_label, input) => {
    expect(parseSaveRequest(input)).toBeNull();
  });
});

describe('safeFileName', () => {
  it('keeps only a file name with the expected extension', () => {
    expect(safeFileName('../../etc/passwd', 'md')).toBe('passwd.md');
    expect(safeFileName('C:\\Users\\x\\map.sh', 'json')).toBe('map.json');
    expect(safeFileName('..', 'json')).toBe('flow-map.json');
    expect(safeFileName('', 'mmd')).toBe('flow-map.mmd');
    expect(safeFileName('my app: flows', 'svg')).toBe('my app- flows.svg');
  });
});
