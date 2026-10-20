# AppFlow Explorer

A desktop tool that turns a mobile app's source code into an interactive, Figma-like map of its screens, navigation flows and source files. It supports Flutter, Android (Kotlin/Java), iOS (Swift/Objective-C) and React Native.

> **Status: Phase 6.** Real projects are analyzed statically by a local agent. Flutter apps can be built and launched on an Android emulator (or an iOS simulator on macOS) after your confirmation, and real screenshots are attached to the discovered screens. The App Flow Map combines static analysis and runtime observations. It groups screens by feature, can be filtered and corrected by hand, and keeps its layout when the project is re-analyzed. Every screen and navigation links to its source. You can open it in the built-in viewer (which follows code that moved after the analysis) or in VS Code/Cursor, and go from a line of code back to the map. Analysis also reports loading, empty, error, authentication, dialog, sheet and tab states found in code, and deep links. An analysis report shows coverage and every unresolved flow. The map can be exported (JSON, Markdown, Mermaid, SVG), notices source changes and offers a re-analysis, restores your session, and can be used from the keyboard. Screens without a capture stay as wireframes from code. The Phase 1 demo dataset is still available from the welcome screen.

## Getting started

Requirements: Node.js 20 or newer and npm 10 or newer. No Flutter, Android, Xcode or Node toolchain is needed to analyze a project.

```bash
npm install
npm run dev                          # desktop app with hot reload
npm run build                        # production bundle in apps/desktop/out
npm test                             # all workspaces (model, analyzer, agent, desktop)
npm run typecheck
```

To open a project:

- **From the app:** click **Open project folder…** on the welcome screen, or **Open project** in the top bar.
- **From the command line:** pass the folder with `--open`. For example: `npx electron-vite dev -- --open /path/to/project`, or `electron apps/desktop/out/main/index.js --open /path/to/project` after a build.

Troubleshooting:

- **`Cannot find module 'electron'`.** The `ELECTRON_RUN_AS_NODE` environment variable is set (some editors set it). Unset it.
- **Electron binary missing.** Run `node node_modules/electron/install.js`.

## What happens when you open a project

1. The main process starts the **local agent** in its own utility process, bound to `127.0.0.1` with a random token that the renderer never sees.
2. The agent scans the folder. It skips `node_modules`, build output and symlinks, and **never reads** `.env` files, keystores, provisioning profiles or credential files.
3. Adapters detect the project type, parse code with tree-sitter grammars, read manifests, navigation graphs and storyboards, and produce the normalized model.
4. The canvas shows screens, routes and navigation:

   | Line on the canvas | Status | Meaning |
   | --- | --- | --- |
   | Solid blue | `verified` | Observed in the running app |
   | Teal dash-dot | `manual` | Added or completed by you |
   | Solid violet | `declared` | Found in navigation configuration |
   | Dashed | `inferred` | Found in code |
   | Dotted amber, with a “?” node | `unresolved` | Destination unknown |

   Nothing is ever marked `verified` without a runtime observation. See [App Flow Map](docs/flow-map.md).
5. Opening a file in the code viewer fetches only that file from the agent. No source code ever leaves the machine.

Nothing in the project is executed. Dependency installs and builds exist in the agent API only behind an explicit, single-use confirmation.

## Documentation

- [Analysis adapters](docs/adapters.md): supported project types, coverage and confidence, limitations, warning codes, and how to add an adapter.
- [App Flow Map](docs/flow-map.md): how the map is built, node and connection types, feature grouping, filters, manual corrections, layout stability, reports, export, source changes, sessions, and keyboard shortcuts.
- [Source-linked exploration](docs/source-navigation.md): screen and edge source locations, uncertainty, source → canvas, stale line numbers, local editors, workspace boundaries and privacy.
- [Runtime capture](docs/runtime-capture.md): host requirements, what runs and when you are asked, build risks, the capture workflow, and verification steps.
- [Local agent API](docs/agent-api.md): endpoints, contracts, errors, the security model, and the operation-consent flow.
- [Phase 1 report](docs/phase-1-report.md) · [Phase 2 report](docs/phase-2-report.md) · [Phase 3 report](docs/phase-3-report.md) · [Phase 4 report](docs/phase-4-report.md) · [Phase 5 report](docs/phase-5-report.md) · [Phase 6 report](docs/phase-6-report.md)

## Repository layout

```
apps/desktop/                Electron app (electron-vite)
  src/main/                  Window, IPC, agent host (utility process), agent entry
  src/preload/               Narrow bridge: pick folder, call agent, initial --open path
  src/renderer/src/          React UI: canvas, panels, code viewer, search, store
packages/model/              Normalized data model (Project, Module, Screen, NavigationRoute,
                             NavigationEdge, Asset, AnalysisWarning, Evidence…)
packages/analyzer/           Analysis core + adapters (flutter, android, ios, reactNative)
  src/parsing/               tree-sitter facts extractors, XML parser
  src/core/                  Engine, graph builder, code index, adapter contract
  fixtures/                  One sample project per platform
packages/agent/              Local HTTP API (loopback, token, validation, jobs, operations)
```

## Frontend integration

The renderer talks to the agent only through `window.appflow.agent.request(method, path, body)`. The main process forwards the call with the token and returns `{ status, body }`. A standalone web frontend can call the same [HTTP API](docs/agent-api.md) directly after starting `node apps/desktop/out/main/agent.js --allow-origin <origin>`.

The store (`apps/desktop/src/renderer/src/store/explorerStore.ts`) runs the workflow in this order:

1. `openProjectFolder` / `openProjectPath`
2. `registerProject`
3. `startAnalysis`, then poll the analysis until it finishes
4. Load the result
5. `ensureFileContent` when the code viewer opens a file

Partial results (failed adapters, unresolved navigation) load like any other result, and their warnings are listed in the overview panel.
