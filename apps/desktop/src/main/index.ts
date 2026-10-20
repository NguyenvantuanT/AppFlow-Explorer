import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { AgentHost, type AgentRequest } from './agentHost';

const isDev = !app.isPackaged && Boolean(process.env['ELECTRON_RENDERER_URL']);
const agent = new AgentHost();

/** `--open <dir>` opens and analyzes a project at startup (handed to the renderer once). */
let initialProject: string | null = (() => {
  const i = process.argv.indexOf('--open');
  return i > 0 ? (process.argv[i + 1] ?? null) : null;
})();

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'AppFlow Explorer',
    backgroundColor: '#0a0f1c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // The renderer is a single-page app: never navigate it away, and open
  // external links in the user's browser instead of inside the tool.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  if (isDev) void win.loadURL(process.env['ELECTRON_RENDERER_URL']!);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}

/** Only requests from our own window are served. */
function fromOwnWindow(event: Electron.IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith('file://') || (isDev && url.startsWith(process.env['ELECTRON_RENDERER_URL']!));
}

ipcMain.handle('project:pick-directory', async (event) => {
  if (!fromOwnWindow(event)) return null;
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win!, { title: 'Open a mobile project', properties: ['openDirectory'] });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle('project:initial-path', (event) => {
  if (!fromOwnWindow(event)) return null;
  const path = initialProject;
  initialProject = null;
  return path;
});

ipcMain.handle('agent:request', async (event, req: AgentRequest) => {
  if (!fromOwnWindow(event)) return { status: 403, body: { error: { code: 'forbidden', message: 'Unknown sender.' } } };
  try {
    return await agent.request(req);
  } catch (error) {
    return { status: 503, body: { error: { code: 'agent_unavailable', message: error instanceof Error ? error.message : String(error) } } };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => agent.stop());
