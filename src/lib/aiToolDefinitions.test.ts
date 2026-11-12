import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { findReadTool, READ_TOOLS, validateReadToolArguments } from '../../tools/rivastock-ai-bridge/src/mcp/toolDefinitions';

it('keeps the Edge and Bridge tool registries byte-identical', () => {
  const bridge = readFileSync('tools/rivastock-ai-bridge/src/mcp/toolDefinitions.ts', 'utf8').replace(/\r\n/g, '\n');
  const edge = readFileSync('supabase/functions/_shared/aiToolDefinitions.ts', 'utf8').replace(/\r\n/g, '\n');
  expect(edge).toBe(bridge);
  expect(READ_TOOLS).toHaveLength(14);
  expect(bridge).toContain("name: 'previsualizar_cambio'");
  expect(bridge).toContain('readOnlyHint: true, destructiveHint: false, idempotentHint: true');
});

it('validates input shapes and keeps read-only MCP annotations', async () => {
  const tool = findReadTool('pedido_ver');
  expect(tool).toBeDefined();
  expect(validateReadToolArguments(tool!, { codigo: 'P-0001' })).toBe(true);
  expect(validateReadToolArguments(tool!, {})).toBe(false);
  expect(validateReadToolArguments(tool!, { codigo: 'P-0001', proveedor: 'internal' })).toBe(false);
  const moduleSource = readFileSync('tools/rivastock-ai-bridge/src/mcp/toolDefinitions.ts', 'utf8');
  expect(moduleSource).toContain('readOnlyHint: true, destructiveHint: false, idempotentHint: true');
});
