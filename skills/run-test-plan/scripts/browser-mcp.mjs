#!/usr/bin/env node
// Starts one browser of the Test Agents' pool: a Playwright MCP server with its own in-memory
// profile, so parallel agents never share tabs or cookies. Every harness runs it over stdio
// (`browser-mcp.mjs <slot>`, or `shared` for the one server outside the Claude Code plugin); a node
// wrapper keeps that entry the same on every OS (npx needs a shell on Windows). Flags and
// overrides: browserArgs in agents.mjs.
//
// It is also a recording proxy: messages pass through untouched, and each tools/call is appended
// to <tmpdir>/qa-browser-<slot>/calls.jsonl with its time, arguments and the text of its result
// (images are dropped). Playwright MCP answers each browser tool with the code it ran, so that log
// is what tests.mjs turns into library scripts when a harness keeps no transcript of its own.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { browserArgs, browserLog } from './agents.mjs';

const slot = process.argv[2] || '1';
const log = browserLog(slot);
const MAX_LOG = 20 * 1024 * 1024;
try {
  mkdirSync(dirname(log), { recursive: true });
  if (existsSync(log) && statSync(log).size > MAX_LOG) renameSync(log, log.replace(/\.jsonl$/, '.1.jsonl'));
} catch {
  // recording is best effort; the browser must start regardless
}

const child = spawn('npx', browserArgs(slot), { stdio: ['pipe', 'pipe', 'inherit'], shell: process.platform === 'win32' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));

const pending = new Map();

// The code an agent saved to a file and ran by name is read now: the file may be gone later.
function snippet(args) {
  if (!args?.filename) return undefined;
  try {
    const path = resolve(String(args.filename));
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

function fromHarness(message) {
  if (message?.method !== 'tools/call' || message.id === undefined) return;
  const args = message.params?.arguments || {};
  pending.set(JSON.stringify(message.id), { at: new Date().toISOString(), start: Date.now(), tool: message.params?.name, args, source: snippet(args) });
}

function fromServer(message) {
  const key = message?.id === undefined ? null : JSON.stringify(message.id);
  if (key === null || !pending.has(key)) return;
  const call = pending.get(key);
  pending.delete(key);
  const content = Array.isArray(message.result?.content) ? message.result.content : [];
  const text = message.error
    ? `### Error\n${message.error.message || JSON.stringify(message.error)}`
    : content
        .filter((part) => part?.type === 'text')
        .map((part) => part.text)
        .join('\n');
  const entry = {
    at: call.at,
    ms: Date.now() - call.start,
    tool: call.tool,
    args: call.args,
    ...(call.source !== undefined && { source: call.source }),
    text,
    isError: Boolean(message.error || message.result?.isError) || /^### Error/m.test(text),
    images: content.filter((part) => part?.type === 'image').length,
  };
  try {
    appendFileSync(log, `${JSON.stringify(entry)}\n`);
  } catch {
    // a full disk must not break the agent's browser
  }
}

// Bytes are relayed as they arrive; a copy is split into lines (MCP over stdio is newline-delimited
// JSON-RPC) only to watch the traffic.
function watch(stream, sink, onMessage) {
  let buffer = '';
  stream.on('data', (chunk) => {
    sink.write(chunk);
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      for (const one of Array.isArray(message) ? message : [message]) onMessage(one);
    }
  });
}

watch(process.stdin, child.stdin, fromHarness);
watch(child.stdout, process.stdout, fromServer);
process.stdin.on('end', () => child.stdin.end());
