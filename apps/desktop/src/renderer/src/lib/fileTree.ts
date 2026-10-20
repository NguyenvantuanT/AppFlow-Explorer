import type { SourceFile } from '@appflow/model';

export interface FileTreeNode {
  name: string;
  /** Folder path or file id. */
  path: string;
  kind: 'folder' | 'file';
  file?: SourceFile;
  children: FileTreeNode[];
}

function sortTree(node: FileTreeNode): void {
  node.children.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1,
  );
  node.children.forEach(sortTree);
}

export function buildFileTree(files: SourceFile[]): FileTreeNode {
  const root: FileTreeNode = { name: '', path: '', kind: 'folder', children: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');
      let child = current.children.find((c) => c.name === part && c.kind === (isFile ? 'file' : 'folder'));
      if (!child) {
        child = isFile
          ? { name: part, path: file.id, kind: 'file', file, children: [] }
          : { name: part, path, kind: 'folder', children: [] };
        current.children.push(child);
      }
      current = child;
    });
  }
  sortTree(root);
  return root;
}

/** Keeps files whose path matches `query` (case-insensitive) and the folders leading to them. */
export function filterFileTree(node: FileTreeNode, query: string): FileTreeNode | null {
  const q = query.trim().toLowerCase();
  if (!q) return node;
  if (node.kind === 'file') return node.file?.path.toLowerCase().includes(q) ? node : null;
  const children = node.children
    .map((c) => filterFileTree(c, q))
    .filter((c): c is FileTreeNode => c !== null);
  return children.length > 0 || node.path === '' ? { ...node, children } : null;
}

/** All folder paths, for expanding everything (e.g. while filtering). */
export function folderPaths(node: FileTreeNode): string[] {
  if (node.kind === 'file') return [];
  return [...(node.path ? [node.path] : []), ...node.children.flatMap(folderPaths)];
}
