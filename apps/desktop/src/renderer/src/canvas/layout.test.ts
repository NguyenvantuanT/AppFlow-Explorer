import { describe, expect, it } from 'vitest';
import { shopliteProject } from '../mock/shoplite/project';
import { computeAutoLayout, mergeLayout, PHONE_NODE_SIZE, unresolvedNodeId, UNRESOLVED_NODE_SIZE } from './layout';

describe('computeAutoLayout', () => {
  it('positions every screen and unresolved placeholder without overlaps', async () => {
    const positions = await computeAutoLayout(shopliteProject);
    const ids = [
      ...shopliteProject.screens.map((s) => s.id),
      ...shopliteProject.edges.filter((e) => e.to === null).map((e) => unresolvedNodeId(e.id)),
    ];
    expect(Object.keys(positions).sort()).toEqual([...ids].sort());

    const boxes = ids.map((id) => {
      const size = id.startsWith('unresolved:') ? UNRESOLVED_NODE_SIZE : PHONE_NODE_SIZE;
      return { id, ...positions[id]!, ...size };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it('places entry points in the first column', async () => {
    const positions = await computeAutoLayout(shopliteProject);
    const minX = Math.min(...Object.values(positions).map((p) => p.x));
    expect(positions['splash']!.x).toBe(minX);
  });
});

describe('mergeLayout', () => {
  it('prefers pinned positions and drops stale ones', () => {
    const merged = mergeLayout(
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { b: { x: 99, y: 99 }, gone: { x: 1, y: 1 } },
    );
    expect(merged).toEqual({ a: { x: 0, y: 0 }, b: { x: 99, y: 99 } });
  });
});
