import type { ProcessRunner } from './exec';
import type { HostInfo } from './toolchain';

export interface Device {
  /** adb serial (`emulator-5554`), simulator UDID, or `avd:<name>` for a stopped emulator. */
  id: string;
  name: string;
  platform: 'android' | 'ios';
  kind: 'emulator' | 'simulator' | 'physical';
  /** `online`: ready for install/capture; `stopped`: can be booted; others are transient or need attention. */
  state: 'online' | 'stopped' | 'booting' | 'offline' | 'unauthorized';
  osVersion?: string;
  /** AVD name for Android emulators. */
  avd?: string;
}

/** Parses `adb devices -l`. */
export function parseAdbDevices(output: string): Array<{ serial: string; state: string; model?: string }> {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [serial, state, ...rest] = l.split(/\s+/);
      const model = rest.find((r) => r.startsWith('model:'))?.slice(6);
      return { serial: serial!, state: state!, model };
    });
}

async function adbProp(runner: ProcessRunner, adb: string, serial: string, prop: string): Promise<string | undefined> {
  const r = await runner.run(adb, ['-s', serial, 'shell', 'getprop', prop], { timeoutMs: 10_000 });
  const v = r.stdout.toString().trim();
  return r.code === 0 && v ? v : undefined;
}

/** Lists Android devices/emulators (running and stopped AVDs) and, on macOS, iOS simulators. */
export async function listDevices(host: HostInfo, runner: ProcessRunner): Promise<Device[]> {
  const devices: Device[] = [];
  const runningAvds = new Set<string>();
  if (host.adb) {
    const r = await runner.run(host.adb, ['devices', '-l'], { timeoutMs: 15_000 });
    for (const d of parseAdbDevices(r.stdout.toString())) {
      const isEmulator = d.serial.startsWith('emulator-');
      const state: Device['state'] = d.state === 'device' ? 'online' : d.state === 'unauthorized' ? 'unauthorized' : 'offline';
      let avd: string | undefined;
      let osVersion: string | undefined;
      let booted = true;
      if (state === 'online') {
        osVersion = await adbProp(runner, host.adb, d.serial, 'ro.build.version.release');
        booted = (await adbProp(runner, host.adb, d.serial, 'sys.boot_completed')) === '1';
        if (isEmulator) {
          avd = await adbProp(runner, host.adb, d.serial, 'ro.boot.qemu.avd_name');
          if (avd) runningAvds.add(avd);
        }
      }
      devices.push({
        id: d.serial,
        name: (avd ?? d.model ?? d.serial).replace(/_/g, ' '),
        platform: 'android',
        kind: isEmulator ? 'emulator' : 'physical',
        state: state === 'online' && !booted ? 'booting' : state,
        osVersion: osVersion ? `Android ${osVersion}` : undefined,
        avd,
      });
    }
  }
  if (host.emulator) {
    const r = await runner.run(host.emulator, ['-list-avds'], { timeoutMs: 15_000 });
    for (const name of r.stdout.toString().split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('INFO'))) {
      if (!runningAvds.has(name)) devices.push({ id: `avd:${name}`, name: name.replace(/_/g, ' '), platform: 'android', kind: 'emulator', state: 'stopped', avd: name });
    }
  }
  if (host.iosSupported && host.xcrun) {
    const r = await runner.run(host.xcrun, ['simctl', 'list', 'devices', 'available', '--json'], { timeoutMs: 20_000 });
    try {
      const json = JSON.parse(r.stdout.toString()) as { devices: Record<string, Array<{ udid: string; name: string; state: string }>> };
      for (const [runtime, list] of Object.entries(json.devices)) {
        if (!runtime.includes('iOS')) continue;
        const version = /iOS[-.](\d+)[-.](\d+)/.exec(runtime);
        for (const s of list) {
          devices.push({ id: s.udid, name: s.name, platform: 'ios', kind: 'simulator', state: s.state === 'Booted' ? 'online' : 'stopped', osVersion: version ? `iOS ${version[1]}.${version[2]}` : undefined });
        }
      }
    } catch {
      // xcrun unavailable or no simulators
    }
  }
  return devices;
}

/** Starts a stopped Android emulator or iOS simulator. Returns immediately; poll the device list for `online`. */
export async function bootDevice(device: Device, host: HostInfo, runner: ProcessRunner): Promise<void> {
  if (device.platform === 'android') {
    if (!host.emulator || !device.avd) throw new Error('The Android emulator tool is not available.');
    runner.detached(host.emulator, ['-avd', device.avd]);
    return;
  }
  if (!host.xcrun) throw new Error('iOS simulators require macOS with Xcode.');
  const r = await runner.run(host.xcrun, ['simctl', 'boot', device.id], { timeoutMs: 60_000 });
  if (r.code !== 0 && !r.stderr.includes('Booted')) throw new Error(r.stderr.trim() || 'simctl boot failed');
  runner.detached('open', ['-a', 'Simulator']);
}
