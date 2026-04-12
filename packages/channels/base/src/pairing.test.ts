import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createPairingStore, parsePairingCommand } from './pairing.js';

describe('pairing store', () => {
  it('persists paired users', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nachos-pairing-'));

    const store = createPairingStore('slack', { stateDir: dir });
    await store.setPaired('U123');
    expect(await store.isPaired('U123')).toBe(true);

    const store2 = createPairingStore('slack', { stateDir: dir });
    expect(await store2.isPaired('U123')).toBe(true);
  });
});

describe('parsePairingCommand', () => {
  it('parses pairing command and token', () => {
    expect(parsePairingCommand('pair')).toEqual({});
    expect(parsePairingCommand('PAIR abc123')).toEqual({ token: 'abc123' });
    expect(parsePairingCommand('hello')).toBeNull();
  });
});
