import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { connectToolChannel } from './toolChannel.ts';
import { READ_TOOLS, type ReadToolDefinition } from './toolDefinitions.ts';

const pipe = process.env.RIVASTOCK_TOOL_PIPE;
const nonce = process.env.RIVASTOCK_TOOL_NONCE;
if (!pipe || !nonce || !/^[a-f0-9]{64}$/i.test(nonce)) {
  process.stderr.write('[RivaStock MCP] No hay un canal de turno válido.\n');
  process.exit(1);
}

export function zodSchemaForTool(tool: ReadToolDefinition): z.ZodType {
  const properties = (tool.inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (tool.inputSchema.required ?? []) as string[];
  const shape: Record<string, z.ZodType> = {};
  for (const [key, rule] of Object.entries(properties)) {
    let field: z.ZodType;
    if (rule.type === 'string') {
      field = Array.isArray(rule.enum)
        ? z.enum(rule.enum as [string, ...string[]])
        : z.string();
      if (!Array.isArray(rule.enum) && typeof rule.minLength === 'number') field = (field as z.ZodString).min(rule.minLength);
      if (!Array.isArray(rule.enum) && typeof rule.maxLength === 'number') field = (field as z.ZodString).max(rule.maxLength);
      if (rule.format === 'uuid') field = (field as z.ZodString).uuid();
      if (rule.format === 'date') field = (field as z.ZodString).regex(/^\d{4}-\d{2}-\d{2}$/);
    } else if (rule.type === 'integer') {
      field = z.number().int();
      if (typeof rule.minimum === 'number') field = (field as z.ZodNumber).min(rule.minimum);
      if (typeof rule.maximum === 'number') field = (field as z.ZodNumber).max(rule.maximum);
    } else {
      field = z.unknown();
    }
    shape[key] = required.includes(key) ? field : field.optional();
  }
  let schema: z.ZodType = z.object(shape).strict();
  if (tool.name === 'pedido_ver') {
    schema = (schema as z.ZodObject).refine((args) => 'order_id' in args || 'codigo' in args, 'Ingresá el identificador o el código del pedido.');
  }
  return schema;
}

const server = new McpServer({ name: 'rivastock', version: '1.0.0' }, { capabilities: { tools: {} } });
for (const tool of READ_TOOLS) {
  server.registerTool(tool.name, {
    title: tool.name,
    description: tool.description,
    inputSchema: zodSchemaForTool(tool),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async (args) => {
    const response = await connectToolChannel(pipe, { nonce, tool: tool.name, args });
    return { content: [{ type: 'text', text: JSON.stringify(response) }] };
  });
}

await server.connect(new StdioServerTransport());
