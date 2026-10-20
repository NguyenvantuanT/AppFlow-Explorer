import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from './bridge';

// The renderer gets narrow, typed calls only — no Node access and no agent token.
const bridge: DesktopBridge = {
  platform: process.platform,
  versions: { electron: process.versions.electron ?? '', chrome: process.versions.chrome ?? '' },
  pickProjectDirectory: () => ipcRenderer.invoke('project:pick-directory'),
  initialProjectPath: () => ipcRenderer.invoke('project:initial-path'),
  agent: {
    request: (method, path, body) => ipcRenderer.invoke('agent:request', { method, path, body }),
  },
};

contextBridge.exposeInMainWorld('appflow', bridge);
