import { describe, expect, it } from 'vitest';
import { editorUrl, parseOpenRequest } from './editor';

describe('editorUrl', () => {
  it('builds VS Code and Cursor URLs with a line and column', () => {
    expect(editorUrl('vscode', 'C:\\work\\shop app\\lib\\main.dart', 12, 5)).toBe('vscode://file/C:/work/shop%20app/lib/main.dart:12:5');
    expect(editorUrl('cursor', '/Users/me/app/lib/main.dart', 3)).toBe('cursor://file/Users/me/app/lib/main.dart:3');
    expect(editorUrl('vscode', '/Users/me/app/README.md')).toBe('vscode://file/Users/me/app/README.md');
  });

  it('encodes characters that would change the URL', () => {
    expect(editorUrl('vscode', '/p/a#b?c.dart', 1)).toBe('vscode://file/p/a%23b%3Fc.dart:1');
  });
});

describe('parseOpenRequest', () => {
  const ok = { projectId: 'abc-123', path: 'lib/main.dart', line: 4, editor: 'vscode' };

  it('accepts a well-formed request', () => {
    expect(parseOpenRequest(ok)).toEqual({ projectId: 'abc-123', path: 'lib/main.dart', line: 4, column: undefined, editor: 'vscode' });
  });

  it.each([
    ['no object', null],
    ['unknown editor', { ...ok, editor: 'notepad' }],
    ['bad project id', { ...ok, projectId: '../x' }],
    ['empty path', { ...ok, path: '' }],
    ['NUL in path', { ...ok, path: 'lib/a\0.dart' }],
    ['negative line', { ...ok, line: -1 }],
    ['fractional line', { ...ok, line: 1.5 }],
    ['string line', { ...ok, line: '4' }],
  ])('rejects %s', (_name, input) => {
    expect(parseOpenRequest(input)).toBeNull();
  });
});
