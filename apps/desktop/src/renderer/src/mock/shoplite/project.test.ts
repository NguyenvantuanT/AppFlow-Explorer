import { buildProjectIndex, validateProject } from '@appflow/model';
import { describe, expect, it } from 'vitest';
import { shopliteProject } from './project';

describe('ShopLite mock project', () => {
  it('is internally consistent', () => {
    expect(validateProject(shopliteProject)).toEqual([]);
  });

  it('exercises every navigation status and an uncaptured screen', () => {
    const { statusCounts } = buildProjectIndex(shopliteProject);
    expect(statusCounts.verified).toBeGreaterThan(0);
    expect(statusCounts.inferred).toBeGreaterThan(0);
    expect(statusCounts.unresolved).toBeGreaterThan(0);
    expect(shopliteProject.screens.some((s) => s.states.length === 0)).toBe(true);
  });

  it('points screen locations at their widget class declaration', () => {
    for (const screen of shopliteProject.screens) {
      const file = shopliteProject.files.find((f) => f.id === screen.location.fileId);
      const line = file?.content?.split('\n')[screen.location.line - 1];
      expect(line).toContain(`class ${screen.widgetClass} `);
    }
  });

  it('never labels mock previews as runtime captures', () => {
    for (const state of shopliteProject.screens.flatMap((s) => s.states)) {
      expect(state.provenance).toBe('mock');
    }
  });
});
