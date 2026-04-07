import { describe, expect, it } from 'vitest';
import {
  containsCommandSubstitution,
  extractCommandBins,
  splitCommandSegments,
  tokenizeSegment,
} from './shell-command-parser.js';

describe('shell-command-parser', () => {
  it('detects command substitution patterns', () => {
    expect(containsCommandSubstitution('ls $(pwd)')).toBe(true);
    expect(containsCommandSubstitution('ls `pwd`')).toBe(true);
    expect(containsCommandSubstitution('echo ${HOME}')).toBe(true);
    expect(containsCommandSubstitution('cat <(echo hi)')).toBe(true);
    expect(containsCommandSubstitution('cat >(tee out.txt)')).toBe(true);
    expect(containsCommandSubstitution('cat <<EOF')).toBe(true);
    expect(containsCommandSubstitution('ls -la')).toBe(false);
  });

  it('extracts binaries for compound commands', () => {
    expect(extractCommandBins('cat file.txt | grep error && wc -l')).toEqual(['cat', 'grep', 'wc']);
  });

  it('splits segments and preserves operators', () => {
    expect(splitCommandSegments('ls && pwd; whoami')).toEqual([
      { command: 'ls', operator: '&&' },
      { command: 'pwd', operator: ';' },
      { command: 'whoami', operator: null },
    ]);
  });

  it('tokenizes quotes correctly', () => {
    expect(tokenizeSegment('grep "hello world" file.txt')).toEqual([
      'grep',
      'hello world',
      'file.txt',
    ]);
  });
});
