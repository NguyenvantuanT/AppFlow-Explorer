import { anchorOf, buildProjectIndex, type AppProject } from '@appflow/model';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useExplorer } from '../store';
import { CodePanel } from './CodePanel';

const original = ['class HomeScreen extends StatelessWidget {', '  Widget build(BuildContext c) {', '    return ListTile(', '      onTap: () => Navigator.pushNamed(c, "/details"),', '    );', '  }', '}', '', 'class DetailsScreen {}'];
const at = (line: number) => ({ fileId: 'lib/home.dart', line, anchor: anchorOf(original[line - 1]!) });

const project: AppProject = {
  id: 'p',
  name: 'p',
  framework: 'flutter',
  rootPath: '/p',
  source: 'analysis',
  files: [{ id: 'lib/home.dart', path: 'lib/home.dart', language: 'dart', contentHash: 'analyzed' }],
  screens: [
    { id: 'home', name: 'Home', kind: 'page', widgetClass: 'HomeScreen', location: { ...at(1), endLine: 7 }, isEntryPoint: true, keyWidgets: [], states: [] },
    { id: 'details', name: 'Details', kind: 'page', widgetClass: 'DetailsScreen', location: at(9), isEntryPoint: false, keyWidgets: [], states: [] },
  ],
  edges: [{ id: 'home->details:push', from: 'home', to: 'details', kind: 'push', trigger: { label: 'Tap', description: 'onTap', handler: 'onTap', location: at(4) }, evidence: [{ source: 'static', detail: 'pushNamed', location: at(4) }] }],
};

function show(content: string, hash: string, line = 4) {
  act(() =>
    useExplorer.setState({
      project,
      baseProject: project,
      index: buildProjectIndex(project),
      workspace: { status: 'ready', hasResult: true, projectId: 'p' },
      fileContents: { 'lib/home.dart': { status: 'ready', content, hash } },
      code: { fileId: 'lib/home.dart', line, anchor: anchorOf(original[line - 1] ?? '') },
      selection: null,
    }),
  );
  render(<CodePanel />);
}

describe('CodePanel — source-linked viewing', () => {
  afterEach(cleanup);

  it('highlights the analyzed line when the file is unchanged', () => {
    show(original.join('\n'), 'analyzed');
    expect(screen.queryByTestId('stale-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('code-highlight').dataset['status']).toBe('exact');
  });

  it('follows code that moved after analysis and says so', () => {
    show(['// added', '// lines', ...original].join('\n'), 'edited');
    expect(screen.getByTestId('stale-banner')).toHaveTextContent('moved from line 4 to line 6');
    expect(screen.getByTestId('code-highlight').dataset['status']).toBe('moved');
    // Markers follow the code too: the navigation call is now on line 6.
    expect(screen.getByTestId('marker-6')).toBeInTheDocument();
    expect(screen.queryByTestId('marker-4')).not.toBeInTheDocument();
  });

  it('warns when the analyzed code is gone instead of silently pointing elsewhere', () => {
    show(original.filter((_, i) => i !== 3).join('\n'), 'edited');
    expect(screen.getByTestId('stale-banner')).toHaveTextContent('no longer there');
    expect(screen.getByTestId('code-highlight').dataset['status']).toBe('stale');
  });

  it('goes from source to canvas: markers and line numbers select the map element', () => {
    show(original.join('\n'), 'analyzed');
    fireEvent.click(screen.getByTestId('marker-4'));
    expect(useExplorer.getState().selection).toEqual({ kind: 'edge', id: 'home->details:push' });
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    expect(useExplorer.getState().selection).toEqual({ kind: 'screen', id: 'home' });
    fireEvent.click(screen.getByRole('button', { name: '9' }));
    expect(useExplorer.getState().selection).toEqual({ kind: 'screen', id: 'details' });
  });

  it('explains files outside the analysis and files that cannot be read', () => {
    act(() => useExplorer.setState({ code: { fileId: 'lib/elsewhere.dart', line: 1 } }));
    render(<CodePanel />);
    expect(screen.getByText(/not part of the analyzed project/)).toBeInTheDocument();
    cleanup();

    act(() =>
      useExplorer.setState({
        project,
        index: buildProjectIndex(project),
        fileContents: { 'lib/home.dart': { status: 'error', error: 'Refusing to read a sensitive file' } },
        code: { fileId: 'lib/home.dart', line: 4 },
      }),
    );
    render(<CodePanel />);
    expect(screen.getByText(/Could not load this file: Refusing to read a sensitive file/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
