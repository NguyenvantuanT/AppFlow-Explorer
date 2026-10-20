import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CaptureDevice } from '@appflow/model';
import type { Device } from './devices';
import type { ProcessRunner } from './exec';
import type { HostInfo } from './toolchain';

/** Reads width/height from a PNG's IHDR chunk. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG image.');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export interface Screenshot {
  png: Buffer;
  width: number;
  height: number;
  pixelRatio?: number;
  device: CaptureDevice;
  /** Android foreground activity, when available. */
  activity?: string;
}

/** Captures the current screen of an online device. */
export async function captureScreen(device: Device, host: HostInfo, runner: ProcessRunner): Promise<Screenshot> {
  if (device.state !== 'online') throw new Error(`${device.name} is not online (${device.state}).`);
  if (device.platform === 'android') {
    if (!host.adb) throw new Error('adb is not available.');
    const shot = await runner.run(host.adb, ['-s', device.id, 'exec-out', 'screencap', '-p'], { timeoutMs: 20_000 });
    if (shot.code !== 0 || shot.stdout.length < 24) throw new Error(`screencap failed: ${shot.stderr.trim() || 'no image returned'}`);
    const { width, height } = pngSize(shot.stdout);
    const density = Number((await runner.run(host.adb, ['-s', device.id, 'shell', 'wm', 'density'], { timeoutMs: 10_000 })).stdout.toString().match(/(\d+)\s*$/m)?.[1]);
    const activity = /mResumedActivity: \S+ \S+ ([\w./$]+)/.exec((await runner.run(host.adb, ['-s', device.id, 'shell', 'dumpsys', 'activity', 'activities'], { timeoutMs: 10_000 })).stdout.toString())?.[1];
    return {
      png: shot.stdout,
      width,
      height,
      pixelRatio: density ? Math.round((density / 160) * 1000) / 1000 : undefined,
      device: { id: device.id, name: device.name, platform: 'android', osVersion: device.osVersion, resolution: `${width}x${height}`, density: density || undefined },
      activity,
    };
  }
  if (!host.xcrun) throw new Error('iOS capture requires macOS with Xcode.');
  const file = path.join(os.tmpdir(), `appflow-${Date.now()}-${process.pid}.png`);
  try {
    const r = await runner.run(host.xcrun, ['simctl', 'io', device.id, 'screenshot', '--type=png', file], { timeoutMs: 30_000 });
    if (r.code !== 0) throw new Error(`simctl screenshot failed: ${r.stderr.trim()}`);
    const png = await fs.readFile(file);
    const { width, height } = pngSize(png);
    return { png, width, height, device: { id: device.id, name: device.name, platform: 'ios', osVersion: device.osVersion, resolution: `${width}x${height}` } };
  } finally {
    await fs.rm(file, { force: true });
  }
}
