# Source-linked exploration

Every screen and navigation on the map points to the code it comes from. You can open that code in the built-in viewer or in a local editor, and go back from a line of code to the map. All locations are real paths and lines recorded by the analysis. When a location is not known, or the file changed since the analysis, the app says so.

- Model: [`packages/model/src/source.ts`](../packages/model/src/source.ts)
- Viewer: [`apps/desktop/src/renderer/src/components/CodePanel.tsx`](../apps/desktop/src/renderer/src/components/CodePanel.tsx)
- Editor bridge: [`apps/desktop/src/main/editor.ts`](../apps/desktop/src/main/editor.ts)

## Screen → source

Selecting a screen shows the following in **Screen details**:

| Section | Content |
| --- | --- |
| Header | Widget class, route, platform kind, module, feature |
| Source | Declaration file and line, which opens the viewer. **VS Code** (or **Cursor**) opens the local editor. The route is listed below. |
| UI states | Runtime captures, newest first, with device, time and build. Mock illustrations are labelled as such. With no state, the panel says how to capture one. |
| Navigation from / to | Incoming and outgoing connections with their status |
| Key widgets | Widgets with handlers and assets; each opens its line |

**Open in Code Editor** opens the declaration and highlights it. When the analysis recorded where the screen's declaration ends, the whole range is highlighted.

## Edge → source

The **Source** section of a selected connection lists, best first:

| Entry | Meaning |
| --- | --- |
| Event handler | The handler that runs the navigation, for example `FilledButton.onPressed`. Marked **Best match**; **Open in Code Editor** goes there. |
| Navigation call | Shown instead when no handler name was identified. Marked **Uncertain**, and says so. |
| Route declaration | When the navigation goes through a named route: where the route is declared. Marked uncertain when the route is not declared, or does not lead to a known screen. |
| Destination | The destination screen's declaration. For an unknown destination: **Unknown destination**, no location, and the reason from analysis. For a destination chosen by hand: marked uncertain. |
| Also seen at | Other evidence locations |

An entry without a location says **No source location** and gives the reason, for example: "Observed at runtime only: no code location is known for the action that triggers it". A location is never invented.

## Source → canvas

In the code viewer:

- **Markers** next to the line numbers show what the analysis found on that line: `▣` a screen, `→` a navigation call, `#` a route declaration. Clicking a marker selects that element on the map and brings it into view.
- **Line numbers** are clickable. Clicking one selects the navigation call on that line. Otherwise it selects the screen whose declaration encloses the line (or the nearest one above it), or the screen a route on that line leads to. If nothing matches, the viewer says so.
- The chips in the header list the screens declared in the file.

## Stale line numbers

The analysis records, for every location, the text of its line (`anchor`) and a SHA-1 of each referenced file (`contentHash`). The agent returns the same hash with file content. When the viewer opens a file:

| Situation | Behavior |
| --- | --- |
| File unchanged (same hash) | The recorded lines are used as is |
| File changed, recorded text still on that line | Same line, marked exact |
| File changed, text found elsewhere | Highlight and markers move to the nearest line with that text. A banner says "moved from line 44 to line 46". |
| File changed, text gone | The original line is highlighted in amber. The banner says the code is no longer there. Markers for vanished code are hidden. |
| No recorded text (older results, demo) | Lines are used as is |

The banner offers **Re-analyze**. **Open in VS Code** in the viewer header opens the editor at the corrected line.

## Local editors

**Open in VS Code** / **Open in Cursor** (choose in the viewer header):

1. The renderer sends `{ projectId, path, line, editor }` to the main process. The main process validates it: known editor, project id format, a path without NUL characters, positive integer line.
2. The main process asks the agent to resolve the path (`POST /v1/projects/:id/files/reveal`). It applies the same rules as reading a file: inside the project after resolving symlinks, not a sensitive file (`.env`, keystores, …), a regular file.
3. Only then does it open `vscode://file/<path>:<line>` (or `cursor://…`) through the editor's URL handler.

Files are never opened with the operating system's default handler, which could run a script. Editors are only available for analyzed projects on this computer, not for the demo.

## Workspace boundaries and privacy

- Files are read only through the local agent, only inside the opened project, and never when they may hold secrets. An attempt to leave the project or read a secret returns `403`, and the viewer shows the reason.
- The analysis result carries no source text. The viewer fetches one file at a time, on demand.
- No source code is sent to any external service. AppFlow has no AI or cloud feature. All network traffic stays on the machine: the agent on `127.0.0.1`, and the Dart VM service of a debug app started from AppFlow. An AI feature would have to be added later as an explicit, opt-in setting.

## Tests

| File | Covers |
| --- | --- |
| `packages/model/src/source.test.ts` | `relocate` (unchanged, moved, nearest of several, stale, clamping, CRLF, no anchor); edge source targets (handler, navigation call, route declaration, undeclared route, unknown destination, observed-only, added by hand, chosen destination, missing screen); markers; line → canvas |
| `packages/analyzer/src/core/engine.test.ts` | Every location in five fixtures is a real file and line, its anchor matches the file, the file hash matches; nothing points into sensitive files |
| `packages/agent/src/server.test.ts` | Content hash; reveal returns the real path; reveal refuses traversal, absolute paths, sensitive files, directories, missing files |
| `apps/desktop/src/main/editor.test.ts` | Editor URLs (Windows paths, spaces, `#`/`?`); request validation |
| `apps/desktop/src/renderer/src/components/CodePanel.test.tsx` | Unchanged, moved and stale highlighting with banners; markers follow moved code; markers and line numbers select on the canvas; files outside the project; unreadable files |
| `apps/desktop/src/renderer/src/store/explorerStore.test.ts` | Best edge location; fallback when the handler is unknown; source → canvas; editor requests and refusals; demo has no editor; reload after edits |
| `apps/desktop/src/renderer/src/components/DetailsPanel.test.tsx` | Uncertain handler and destination shown with "No source location"; UI states listed |
