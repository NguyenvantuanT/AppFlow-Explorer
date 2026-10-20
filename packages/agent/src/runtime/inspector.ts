/**
 * Minimal Dart VM service client used to read the live widget tree through
 * Flutter's widget inspector extension (debug builds only). This is how a
 * capture is matched to a discovered screen: the screen classes present in
 * the tree, and the one on top.
 */

interface WidgetNode {
  description?: string;
  widgetRuntimeType?: string;
  children?: WidgetNode[];
}

export interface DetectedScreens {
  /** Known screen classes found in the tree, in tree order (later = drawn above). */
  detected: string[];
  top?: string;
}

/** Finds known screen widget classes in an inspector tree, in depth-first order. */
export function findScreens(tree: WidgetNode, screenClasses: Set<string>): DetectedScreens {
  const detected: string[] = [];
  const visit = (n: WidgetNode) => {
    const type = (n.widgetRuntimeType ?? n.description ?? '').replace(/<.*$/, '');
    if (screenClasses.has(type)) detected.push(type);
    for (const c of n.children ?? []) visit(c);
  };
  visit(tree);
  return { detected, top: detected.at(-1) };
}

export class VmServiceClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private isolateId: string | null = null;

  constructor(private readonly wsUri: string) {}

  private async connect(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return this.ws;
    const ws = new WebSocket(this.wsUri);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Could not connect to the Dart VM service.'));
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (msg.id === undefined) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    };
    ws.onclose = () => {
      for (const p of this.pending.values()) p.reject(new Error('VM service connection closed.'));
      this.pending.clear();
      this.ws = null;
    };
    this.ws = ws;
    return ws;
  }

  async call<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
    const ws = await this.connect();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`VM service call ${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  private async mainIsolate(): Promise<string> {
    if (this.isolateId) return this.isolateId;
    const vm = await this.call<{ isolates: Array<{ id: string; name: string }> }>('getVM');
    const isolate = vm.isolates.find((i) => i.name === 'main') ?? vm.isolates[0];
    if (!isolate) throw new Error('The app has no running isolate.');
    this.isolateId = isolate.id;
    return isolate.id;
  }

  /** Reads the summary widget tree (widgets created by the project). */
  async widgetTree(): Promise<WidgetNode> {
    const isolateId = await this.mainIsolate();
    const group = 'appflow-capture';
    const unwrap = (r: unknown): WidgetNode => {
      const inner = (r as { result?: unknown })?.result ?? r;
      return (typeof inner === 'string' ? JSON.parse(inner) : inner) as WidgetNode;
    };
    try {
      try {
        return unwrap(await this.call('ext.flutter.inspector.getRootWidgetTree', { isolateId, groupName: group, isSummaryTree: 'true', withPreviews: 'false' }));
      } catch {
        return unwrap(await this.call('ext.flutter.inspector.getRootWidgetSummaryTree', { isolateId, objectGroup: group }));
      }
    } finally {
      void this.call('ext.flutter.inspector.disposeGroup', { isolateId, objectGroup: group }).catch(() => undefined);
    }
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
