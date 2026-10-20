/**
 * Entry point of the local developer agent.
 *
 * - Inside the desktop app it runs as an Electron utility process and reports
 *   its URL to the main process over `parentPort` (the token comes from the
 *   parent through the environment and is never printed).
 * - Standalone (`node out/main/agent.js [--port 4517] [--allow-origin URL]`)
 *   it prints `{ "url", "token" }` as one JSON line for a web frontend.
 */
import { startAgent } from '@appflow/agent';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const parentPort = (process as NodeJS.Process & { parentPort?: { postMessage(message: unknown): void } }).parentPort;
  const agent = await startAgent({
    dataDir: process.env['APPFLOW_DATA_DIR'] || undefined,
    port: Number(arg('port') ?? 0),
    token: process.env['APPFLOW_AGENT_TOKEN'] || undefined,
    allowedOrigins: arg('allow-origin') ? [arg('allow-origin')!] : [],
  });
  if (parentPort) parentPort.postMessage({ type: 'ready', url: agent.url });
  else process.stdout.write(`${JSON.stringify({ url: agent.url, token: agent.token })}\n`);
  const stop = () => void agent.close().then(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((error: unknown) => {
  console.error('[appflow-agent] failed to start', error);
  process.exit(1);
});
