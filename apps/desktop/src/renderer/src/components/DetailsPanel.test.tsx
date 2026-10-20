import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useExplorer } from '../store';
import { DetailsPanel } from './DetailsPanel';

const project = useExplorer.getState().project;
const edgeWhere = (from: string, to: string) => project.edges.find((e) => e.from === from && e.to === to)!;

describe('DetailsPanel', () => {
  beforeEach(() => act(() => useExplorer.setState({ selection: null, code: null })));
  afterEach(cleanup);

  it('shows a project overview with nothing selected', () => {
    render(<DetailsPanel />);
    expect(screen.getByText('Navigation confidence')).toBeInTheDocument();
  });

  it('marks static-only flows as not verified', () => {
    act(() => useExplorer.getState().select({ kind: 'edge', id: edgeWhere('checkout', 'orderSuccess').id }));
    render(<DetailsPanel />);
    expect(screen.getByText('Inferred from code')).toBeInTheDocument();
    expect(screen.getByText('not verified', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByText('Verified at runtime')).not.toBeInTheDocument();
  });

  it('shows runtime evidence for verified flows', () => {
    act(() => useExplorer.getState().select({ kind: 'edge', id: edgeWhere('cart', 'checkout').id }));
    render(<DetailsPanel />);
    expect(screen.getByText('Verified at runtime')).toBeInTheDocument();
    expect(screen.getByText('Runtime')).toBeInTheDocument();
  });

  it('lists screen navigation and opens source on click', () => {
    act(() => useExplorer.getState().select({ kind: 'screen', id: 'home' }));
    render(<DetailsPanel />);
    expect(screen.getByText('Navigation to')).toBeInTheDocument();
    expect(screen.getByText('Unknown destination')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Open in Code Editor'));
    expect(useExplorer.getState().code).toMatchObject({ fileId: 'lib/features/home/home_screen.dart' });
  });

  it('shows where a navigation lives in code and what is uncertain about it', () => {
    const unresolved = project.edges.find((e) => e.to === null)!;
    act(() => useExplorer.getState().select({ kind: 'edge', id: unresolved.id }));
    render(<DetailsPanel />);
    const source = screen.getByTestId('edge-source');
    expect(source).toHaveTextContent(/Event handler|Navigation call/);
    expect(source).toHaveTextContent(`${unresolved.trigger.location!.fileId}:${unresolved.trigger.location!.line}`);
    expect(source).toHaveTextContent('Unknown destination');
    expect(source).toHaveTextContent('Uncertain');
    expect(source).toHaveTextContent('No source location');
  });

  it('lists the UI states of a screen', () => {
    act(() => useExplorer.getState().select({ kind: 'screen', id: 'home' }));
    render(<DetailsPanel />);
    expect(screen.getByText('UI states')).toBeInTheDocument();
    expect(screen.getByTestId('screen-states')).toHaveTextContent('Mock illustration');
  });
});
