import { runtimeApi } from '../agent/runtime';
import { shopliteProject } from '../mock/shoplite/project';
import { createExplorerStore } from './explorerStore';
import { createRuntimeStore } from './runtimeStore';

/** App-wide store. Starts on the welcome screen; the bundled mock project is the demo. */
export const useExplorer = createExplorerStore(shopliteProject);

/** Device, build session and capture state for the open project. */
export const useRuntime = createRuntimeStore({
  api: runtimeApi,
  onCaptures: (captures, observations, images) => useExplorer.getState().applyRuntimeOverlay(captures, observations, images),
});

export type { CodeTarget, Selection } from './explorerStore';
