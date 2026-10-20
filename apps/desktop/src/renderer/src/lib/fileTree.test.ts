import type { SourceFile } from '@appflow/model';
import { describe, expect, it } from 'vitest';
import { buildFileTree, filterFileTree, folderPaths } from './fileTree';

const file = (path: string): SourceFile => ({ id: path, path, language: 'dart' });
const files = [file('lib/main.dart'), file('lib/app/routes.dart'), file('pubspec.yaml'), file('lib/a/z.dart')];

describe('buildFileTree', () => {
  it('nests files and sorts folders before files', () => {
    const tree = buildFileTree(files);
    expect(tree.children.map((c) => c.name)).toEqual(['lib', 'pubspec.yaml']);
    expect(tree.children[0]!.children.map((c) => c.name)).toEqual(['a', 'app', 'main.dart']);
  });

  it('filters by path and keeps ancestor folders', () => {
    const filtered = filterFileTree(buildFileTree(files), 'routes');
    expect(folderPaths(filtered!)).toEqual(['lib', 'lib/app']);
    expect(filtered!.children[0]!.children[0]!.children[0]!.path).toBe('lib/app/routes.dart');
  });
});
