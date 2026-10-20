import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge } from './bridge';

// The renderer gets narrow, typed calls only — no Node access and no agent token.
const bridge: DesktopBridge = {
  platform: process.platform,
  versions: { electron: process.versions.electron ?? '', chrome: process.versions.chrome ?? '' },
  pickProjectDirectory: () => ipcRenderer.invoke('project:pick-directory'),
  initialProjectPath: () => ipcRenderer.invoke('project:initial-path'),
  sampleProjects: () => ipcRenderer.invoke('project:samples'),
  agent: {
    request: (method, path, body) => ipcRenderer.invoke('agent:request', { method, path, body }),
  },
  openInEditor: (request) => ipcRenderer.invoke('editor:open', request),
  saveFile: (request) => ipcRenderer.invoke('export:save', request),
};

contextBridge.exposeInMainWorld('appflow', bridge);
