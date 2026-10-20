import { unresolvedReport } from '@appflow/model';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHORTCUTS } from '../lib/shortcuts';
import { useExplorer } from '../store';
import { ReportPanel } from './ReportPanel';
import { ShortcutsHelp } from './ShortcutsHelp';
import { SourceChangesBanner } from './SourceChangesBanner';

const initial = useExplorer.getState();

afterEach(() => {
  cleanup();
  act(() => useExplorer.setState({ reportOpen: false, shortcutsOpen: false, sourceChanges: null, reanalyze: initial.reanalyze, selection: null, code: null }));
});

describe('ReportPanel', () => {
  beforeEach(() => act(() => useExplorer.getState().setReportOpen(true)));

  it('shows coverage and lists every unresolved flow', () => {
    render(<ReportPanel />);
    const panel = screen.getByTestId('report-panel');
    expect(within(panel).getByText('Coverage')).toBeInTheDocument();
    const { flows } = unresolvedReport(initial.project);
    expect(flows.length).toBeGreaterThan(0);
    expect(within(panel).getByText('Unresolved flows').parentElement).toHaveTextContent(String(flows.length));
    for (const f of flows) expect(panel).toHaveTextContent(f.reason);
  });

  it('jumps to an unresolved flow in the map and its code, then closes', () => {
    render(<ReportPanel />);
    const flow = unresolvedReport(initial.project).flows.find((f) => f.location)!;
    fireEvent.click(screen.getAllByText(flow.reason)[0]!);
    const state = useExplorer.getState();
    expect(state.selection).toMatchObject({ kind: 'edge' });
    expect(state.project.edges.find((e) => e.id === state.selection!.id)!.to).toBeNull();
    expect(state.reportOpen).toBe(false);
  });

  it('closes with Escape', () => {
    render(<ReportPanel />);
    fireEvent.keyDown(screen.getByTestId('report-panel'), { key: 'Escape' });
    expect(useExplorer.getState().reportOpen).toBe(false);
  });
});

describe('ShortcutsHelp', () => {
  it('lists every registered shortcut', () => {
    act(() => useExplorer.getState().setShortcutsOpen(true));
    render(<ShortcutsHelp />);
    const help = screen.getByTestId('shortcuts-help');
    for (const s of SHORTCUTS) expect(help).toHaveTextContent(s.description);
    fireEvent.click(screen.getByLabelText('Close keyboard shortcuts'));
    expect(useExplorer.getState().shortcutsOpen).toBe(false);
  });
});

describe('SourceChangesBanner', () => {
  const changes = { analysisId: 'a1', since: '2026-10-20T10:00:00.000Z', changed: true, counts: { added: 1, removed: 0, modified: 2 }, added: ['lib/new.dart'], removed: [], modified: ['lib/a.dart', 'lib/b.dart'] };

  it('stays hidden without changes', () => {
    render(<SourceChangesBanner />);
    expect(screen.queryByTestId('source-changes')).not.toBeInTheDocument();
  });

  it('summarizes changed files, lists them and offers a re-analysis', () => {
    const reanalyze = vi.fn(async () => {});
    act(() => useExplorer.setState({ sourceChanges: changes, reanalyze }));
    render(<SourceChangesBanner />);
    const banner = screen.getByTestId('source-changes');
    expect(banner).toHaveTextContent('3 files changed since this analysis (2 edited, 1 added)');
    fireEvent.click(screen.getByText('Show files'));
    expect(banner).toHaveTextContent('M lib/a.dart');
    expect(banner).toHaveTextContent('A lib/new.dart');
    fireEvent.click(screen.getByText('Re-analyze'));
    expect(reanalyze).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Dismiss'));
    expect(screen.queryByTestId('source-changes')).not.toBeInTheDocument();
  });
});
