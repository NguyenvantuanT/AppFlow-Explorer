import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessDeniedError, ProjectFs } from './projectFs';
import { isSensitiveFile } from './sensitive';

const temp = mkdtempSync(path.join(tmpdir(), 'appflow-fs-'));
const root = path.join(temp, 'project');
const outside = path.join(temp, 'outside');
let fs: ProjectFs;
let symlinksSupported = true;

beforeAll(async () => {
  mkdirSync(path.join(root, 'lib'), { recursive: true });
  mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
  mkdirSync(path.join(root, 'build'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(root, 'lib', 'main.dart'), 'void main() {}\n');
  writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
  writeFileSync(path.join(root, '.env.production'), 'SECRET=2\n');
  writeFileSync(path.join(root, 'release.jks'), 'binary');
  writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), '');
  writeFileSync(path.join(root, 'build', 'out.txt'), '');
  writeFileSync(path.join(outside, 'secret.txt'), 'outside');
  try {
    symlinkSync(outside, path.join(root, 'linked'), 'junction');
    symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'lib', 'leak.txt'));
  } catch {
    symlinksSupported = false;
  }
  fs = await ProjectFs.open(root);
});
afterAll(() => rmSync(temp, { recursive: true, force: true }));

describe('ProjectFs', () => {
  it('scans project files, skipping dependency and build folders and symlinks', async () => {
    const scan = await fs.scan();
    expect(scan.files.map((f) => f.path)).toEqual(['lib/main.dart']);
  });

  it('lists sensitive files as excluded without reading them', async () => {
    const scan = await fs.scan();
    expect(scan.excludedSensitive.sort()).toEqual(['.env', '.env.production', 'release.jks']);
    await expect(fs.readText('.env')).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('reads files inside the project', async () => {
    expect(await fs.readText('lib/main.dart')).toBe('void main() {}\n');
    expect(await fs.readText('./lib/../lib/main.dart')).toBe('void main() {}\n');
  });

  it.each(['../outside/secret.txt', '/etc/passwd', 'C:/Windows/win.ini', 'lib/../../outside/secret.txt', 'lib\\..\\..\\outside\\secret.txt', 'a\0b'])('refuses %s', async (p) => {
    await expect(fs.readText(p)).rejects.toBeInstanceOf(AccessDeniedError);
  });

  it('refuses symlinks that resolve outside the project', async () => {
    if (!symlinksSupported) return;
    await expect(fs.readText('linked/secret.txt')).rejects.toBeInstanceOf(AccessDeniedError);
    await expect(fs.readText('lib/leak.txt')).rejects.toBeInstanceOf(AccessDeniedError);
  });
});

describe('isSensitiveFile', () => {
  it.each(['.env', '.env.local', 'prod.env', 'key.properties', 'local.properties', 'upload.keystore', 'release.jks', 'cert.p12', 'AuthKey.p8', 'dist.mobileprovision', 'google-services.json', 'GoogleService-Info.plist', 'secrets.json', 'id_rsa'])('%s is sensitive', (name) => {
    expect(isSensitiveFile(name)).toBe(true);
  });

  it.each(['main.dart', 'build.gradle', 'Info.plist', 'package.json', 'environment.dart', 'keyboard.swift'])('%s is not', (name) => {
    expect(isSensitiveFile(name)).toBe(false);
  });
});
