import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cleanChatSessionDirectory } from '../src/providers.ts';

const CHAT_ID = '30000000-0000-4000-8000-000000000001';

test('chat cleanup removes only the selected provider session directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rivastock-chat-cleanup-'));
  try {
    const target = join(root, 'codex', CHAT_ID);
    const sibling = join(root, 'codex', '30000000-0000-4000-8000-000000000002');
    await mkdir(target, { recursive: true });
    await mkdir(sibling, { recursive: true });
    await writeFile(join(target, 'session.json'), 'session');
    await writeFile(join(sibling, 'session.json'), 'keep');

    await cleanChatSessionDirectory(root, 'codex', CHAT_ID);

    await assert.rejects(readFile(join(target, 'session.json')));
    assert.equal(await readFile(join(sibling, 'session.json'), 'utf8'), 'keep');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('chat cleanup rejects malformed IDs and providers outside the session tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rivastock-chat-cleanup-'));
  try {
    await assert.rejects(cleanChatSessionDirectory(root, 'codex', '..'), /Identificador de chat inválido/);
    await assert.rejects(cleanChatSessionDirectory(root, 'other', CHAT_ID), /Identificador de chat inválido/);
    await cleanChatSessionDirectory(root, 'mock', CHAT_ID);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('chat cleanup refuses a linked directory without touching its target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rivastock-chat-cleanup-'));
  const outside = await mkdtemp(join(tmpdir(), 'rivastock-chat-outside-'));
  try {
    const providerRoot = join(root, 'codex');
    await mkdir(providerRoot, { recursive: true });
    await writeFile(join(outside, 'keep.txt'), 'outside');
    await symlink(outside, join(providerRoot, CHAT_ID), 'junction');

    await assert.rejects(cleanChatSessionDirectory(root, 'codex', CHAT_ID), /enlace simbólico/);
    assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'outside');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('chat cleanup refuses linked children instead of traversing them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rivastock-chat-cleanup-'));
  const outside = await mkdtemp(join(tmpdir(), 'rivastock-chat-outside-'));
  try {
    const target = join(root, 'claude', CHAT_ID);
    await mkdir(target, { recursive: true });
    await writeFile(join(outside, 'keep.txt'), 'outside');
    await symlink(outside, join(target, 'linked'), 'junction');

    await assert.rejects(cleanChatSessionDirectory(root, 'claude', CHAT_ID), /enlace simbólico/);
    assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'outside');
    assert.equal(await readFile(join(target, 'linked', 'keep.txt'), 'utf8'), 'outside');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
