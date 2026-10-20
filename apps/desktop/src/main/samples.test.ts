import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listSamples, SAMPLES } from './samples';

describe('listSamples', () => {
  it('lists every sample from the analyzer fixtures, the native bridges one first', () => {
    const dir = join(__dirname, '../../../../packages/analyzer/fixtures');
    const samples = listSamples(dir);
    expect(samples.map((s) => s.id)).toEqual(SAMPLES.map((s) => s.id));
    expect(samples[0]).toMatchObject({ id: 'flutter_native', path: join(dir, 'flutter_native') });
  });

  it('skips samples that are not there', () => {
    expect(listSamples(join(__dirname, 'no-such-dir'))).toEqual([]);
  });
});
