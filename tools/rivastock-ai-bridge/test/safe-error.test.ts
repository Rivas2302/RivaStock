import assert from 'node:assert/strict';
import test from 'node:test';
import { reportError } from '../src/safeError.ts';

test('reportError redacts credentials, signed URLs, local paths, and newlines', () => {
  const message = reportError('Bearer secret-token sk-abcdefgh1234 eyJabcdefghijklmnop https://storage.example/file?token=secret C:\\Users\\Riva\\.env\nnext line');
  assert.doesNotMatch(message, /secret-token|sk-abcdefgh1234|eyJabcdefghijklmnop|storage\.example|C:\\Users\\Riva|\.env|\n/);
  assert.match(message, /\[URL redacted\]/);
  assert.match(message, /\[path redacted\]/);
});
