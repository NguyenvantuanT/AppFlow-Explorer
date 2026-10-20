export interface AgentResponse {
  status: number;
  body: unknown;
}

export interface DesktopBridge {
  platform: string;
  versions: { electron: string; chrome: string };
  /** Opens a native folder picker; resolves to the absolute path, or null when cancelled. */
  pickProjectDirectory(): Promise<string | null>;
  /** Project passed on the command line with `--open <dir>`, returned once. */
  initialProjectPath(): Promise<string | null>;
  /** Calls the local agent API (`/v1/...`) through the main process. */
  agent: {
    request(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<AgentResponse>;
  };
  /** Opens a project file at a line in a local editor, after the agent checked the path. */
  openInEditor(request: { projectId: string; path: string; line?: number; column?: number; editor: 'vscode' | 'cursor' }): Promise<{ ok: boolean; error?: string }>;
  /** Shows a save dialog and writes an exported flow map to the chosen path. */
  saveFile(request: { suggestedName: string; content: string; extension: string }): Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>;
}

declare global {
  interface Window {
    /** Present when running inside the Electron shell; absent in tests. */
    appflow?: DesktopBridge;
  }
}
