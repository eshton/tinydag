import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDagFile, parseVarOverrides, ParseError } from '../src/core/parse.js';

function tmpDag(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tinydag-parse-'));
  const path = join(dir, 'dag.yml');
  writeFileSync(path, content);
  return path;
}

describe('parse', () => {
  it('loads a valid YAML mapping', async () => {
    const path = tmpDag('name: x\nsteps: []\n');
    const raw = await loadDagFile(path);
    expect(raw.raw).toEqual({ name: 'x', steps: [] });
    expect(raw.baseDir).toBeTruthy();
  });

  it('throws on missing file', async () => {
    await expect(loadDagFile('/nonexistent/dag.yml')).rejects.toThrow(ParseError);
  });

  it('throws on non-mapping root', async () => {
    const path = tmpDag('- a\n- b\n');
    await expect(loadDagFile(path)).rejects.toThrow(/must be a YAML mapping/);
  });

  it('throws on YAML syntax error', async () => {
    const path = tmpDag('name: : :\n');
    await expect(loadDagFile(path)).rejects.toThrow(/YAML parse error/);
  });
});

describe('parseVarOverrides', () => {
  it('parses key=value pairs', () => {
    expect(parseVarOverrides(['foo=bar', 'a=1'])).toEqual({ foo: 'bar', a: '1' });
  });

  it('keeps everything after the first =', () => {
    expect(parseVarOverrides(['url=postgres://u:p@h/d'])).toEqual({
      url: 'postgres://u:p@h/d',
    });
  });

  it('throws on missing =', () => {
    expect(() => parseVarOverrides(['nope'])).toThrow(/key=value/);
  });
});
