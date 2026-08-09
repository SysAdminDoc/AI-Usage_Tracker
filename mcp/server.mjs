#!/usr/bin/env node

import fs from 'node:fs/promises';
import readline from 'node:readline';
import rootPackage from '../package.json' with { type: 'json' };
import { forecastMonthEnd } from '../src/lib/forecast.js';
import { normalizeMcpState } from '../src/lib/mcp-state.js';

const SERVER_VERSION = rootPackage.version;
const args = parseArgs(process.argv.slice(2));

if (!args.state) {
  process.stderr.write('ai-usage-tracker-mcp: --state <explicit-export.json> is required\n');
  process.exitCode = 2;
} else {
  serve();
}

const TOOL_DEFINITIONS = [
  {
    name: 'get_usage',
    description: 'Read current provider and bucket usage from the explicit redacted export.',
    inputSchema: {
      type: 'object',
      properties: { provider: { type: 'string', description: 'Optional provider ID filter.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'forecast',
    description: 'Project cost-bearing API spend to the end of the export month.',
    inputSchema: {
      type: 'object',
      properties: { asOfISO: { type: 'string', description: 'Optional ISO timestamp for deterministic replay.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'time_to_reset',
    description: 'Return reset timestamps and remaining time for usage buckets.',
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: 'Optional provider ID filter.' },
        bucketId: { type: 'string', description: 'Optional redacted bucket ID filter.' },
        asOfISO: { type: 'string', description: 'Optional ISO timestamp for deterministic replay.' },
      },
      additionalProperties: false,
    },
  },
];

async function serve() {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      writeResponse(null, jsonRpcError(-32700, 'Invalid JSON'));
      continue;
    }
    const response = await handleRequest(request);
    if (response) writeResponse(request.id ?? null, response);
  }
}

async function handleRequest(request) {
  const method = request?.method;
  if (method === 'notifications/initialized' || request?.id == null) return null;
  if (method === 'ping') return { result: {} };
  if (method === 'initialize') {
    return {
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'ai-usage-tracker-local', version: SERVER_VERSION },
        instructions: 'Reads only the explicit --state JSON export. No browser storage, network, credentials, prompts, or code are accessed.',
      },
    };
  }
  if (method === 'tools/list') return { result: { tools: TOOL_DEFINITIONS } };
  if (method !== 'tools/call') return jsonRpcError(-32601, `Method not found: ${String(method)}`);

  const name = request.params?.name;
  try {
    const state = await readState();
    const data = await callTool(name, request.params?.arguments || {}, state);
    return { result: toolResult(data) };
  } catch (error) {
    return { result: toolResult({ error: error?.message || 'tool-failed' }, true) };
  }
}

async function callTool(name, input, state) {
  if (name === 'get_usage') return getUsage(state, input);
  if (name === 'forecast') return getForecast(state, input);
  if (name === 'time_to_reset') return getTimeToReset(state, input);
  throw new Error(`Unknown tool: ${String(name)}`);
}

async function readState() {
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(args.state, 'utf8'));
  } catch {
    throw new Error('Explicit MCP state file could not be read');
  }
  return normalizeMcpState(raw);
}

function getUsage(state, input = {}) {
  const providerFilter = optionalText(input.provider);
  const providers = Object.fromEntries(Object.entries(state.snapshot.providers || {})
    .filter(([provider]) => !providerFilter || provider === providerFilter));
  if (providerFilter && !Object.prototype.hasOwnProperty.call(providers, providerFilter)) {
    throw new Error(`Provider is not present in the explicit export: ${providerFilter}`);
  }
  return {
    exportedAtISO: state.exportedAtISO,
    fetchedAtISO: state.snapshot.fetchedAtISO,
    providers,
  };
}

function getForecast(state, input = {}) {
  const now = parseAsOf(input.asOfISO, state.exportedAtISO);
  return {
    exportedAtISO: state.exportedAtISO,
    forecast: forecastMonthEnd(state.snapshot, { now }),
  };
}

function getTimeToReset(state, input = {}) {
  const providerFilter = optionalText(input.provider);
  const bucketFilter = optionalText(input.bucketId);
  const now = parseAsOf(input.asOfISO, state.exportedAtISO);
  const rows = [];
  for (const [provider, providerState] of Object.entries(state.snapshot.providers || {})) {
    if (providerFilter && provider !== providerFilter) continue;
    for (const bucket of providerState?.buckets || []) {
      if (bucketFilter && bucket.id !== bucketFilter) continue;
      const resetDate = bucket.resetISO ? new Date(bucket.resetISO) : null;
      const validReset = resetDate && Number.isFinite(resetDate.getTime());
      const remainingMs = validReset ? Math.max(0, resetDate.getTime() - now.getTime()) : null;
      rows.push({
        provider,
        bucketId: bucket.id,
        resetISO: validReset ? resetDate.toISOString() : null,
        remainingMs,
        remainingSeconds: remainingMs == null ? null : Math.ceil(remainingMs / 1000),
        expired: remainingMs != null && remainingMs === 0,
      });
    }
  }
  if (providerFilter && !Object.prototype.hasOwnProperty.call(state.snapshot.providers || {}, providerFilter)) {
    throw new Error(`Provider is not present in the explicit export: ${providerFilter}`);
  }
  if (bucketFilter && !rows.length) throw new Error(`Bucket is not present in the explicit export: ${bucketFilter}`);
  return { asOfISO: now.toISOString(), rows };
}

function toolResult(data, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
    ...(isError ? { isError: true } : {}),
  };
}

function parseAsOf(value, fallback) {
  const candidate = value || fallback;
  const date = new Date(candidate || Date.now());
  if (!Number.isFinite(date.getTime())) throw new Error('asOfISO must be a valid ISO timestamp');
  return date;
}

function optionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--state') parsed.state = argv[index + 1] || '';
    index += argv[index] === '--state' ? 1 : 0;
  }
  return parsed;
}

function writeResponse(id, payload) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...payload })}\n`);
}

function jsonRpcError(code, message) {
  return { error: { code, message } };
}
