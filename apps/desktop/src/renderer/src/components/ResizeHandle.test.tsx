import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clampPanelSize, loadPanelSizes, PANEL_LIMITS } from '../lib/panelSizes';
import { ResizeHandle } from './ResizeHandle';

describe('panel sizes', () => {
  beforeEach(() => localStorage.clear());

  it('falls back to defaults and clamps saved values', () => {
    expect(loadPanelSizes()).toEqual({ left: 264, right: 328, code: 0.38 });
    localStorage.setItem('appflow:panels:v1', JSON.stringify({ left: 9999, right: 'wide', code: 0.01 }));
    expect(loadPanelSizes()).toEqual({ left: PANEL_LIMITS.left.max, right: 328, code: PANEL_LIMITS.code.min });
    localStorage.setItem('appflow:panels:v1', '{not json');
    expect(loadPanelSizes().right).toBe(328);
    expect(clampPanelSize('right', Number.NaN)).toBe(328);
  });
});

describe('ResizeHandle', () => {
  afterEach(cleanup);

  // jsdom has no pointer capture.
  beforeEach(() => {
    Element.prototype.setPointerCapture = () => {};
  });

  it('widens a right-hand panel when dragged left', () => {
    const onChange = vi.fn();
    render(<ResizeHandle axis="x" label="Resize details panel" value={328} min={280} max={760} invert onChange={onChange} onReset={() => {}} />);
    const handle = screen.getByRole('separator', { name: 'Resize details panel' });
    fireEvent.pointerDown(handle, { button: 0, clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(428);
    expect(document.body.dataset['resizing']).toBe('x');
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(document.body.dataset['resizing']).toBeUndefined();
  });

  it('grows the code panel as a share of the height when dragged up, and resets on double-click', () => {
    const onChange = vi.fn();
    const onReset = vi.fn();
    render(<ResizeHandle axis="y" label="Resize code panel" value={0.4} min={0.15} max={0.85} scale={1000} invert onChange={onChange} onReset={onReset} />);
    const handle = screen.getByRole('separator');
    expect(handle).toHaveAttribute('aria-valuenow', '40');
    fireEvent.pointerDown(handle, { button: 0, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 400, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith(expect.closeTo(0.6, 5));
    fireEvent.doubleClick(handle);
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('resizes from the keyboard', () => {
    const onChange = vi.fn();
    render(<ResizeHandle axis="x" label="Resize project files" value={264} min={200} max={520} onChange={onChange} onReset={() => {}} />);
    const handle = screen.getByRole('separator');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith(288);
    fireEvent.keyDown(handle, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(520);
  });
});
