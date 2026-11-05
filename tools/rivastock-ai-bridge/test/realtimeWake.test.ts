import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWakeMessage, realtimeEventsUrl } from '../src/realtimeWake.ts';

test('Realtime wake endpoint uses secure WebSockets for Supabase HTTPS URLs', () => {
  assert.equal(realtimeEventsUrl('https://example.supabase.co/functions/v1/ai-bridge'),
    'wss://example.supabase.co/functions/v1/ai-bridge');
});

test('wake messages expose only a bounded type and optional source', () => {
  assert.deepEqual(parseWakeMessage(Buffer.from('{"type":"wake","source":"ai_workspace_files"}')),
    { type: 'wake', source: 'ai_workspace_files' });
  assert.deepEqual(parseWakeMessage('{"type":"ready"}'), { type: 'ready' });
  assert.equal(parseWakeMessage('{"type":"wake","source":"x"'.padEnd(513, ' ')), null);
  assert.equal(parseWakeMessage('{"type":"job","input":"customer data"}'), null);
});
