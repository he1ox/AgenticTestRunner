// A minimal MCP client over stdio (newline-delimited JSON-RPC), enough to drive a Playwright MCP
// server without an agent: the replay runner sends each recorded step as one
// browser_run_code_unsafe call. No dependencies, like the rest of the skill.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export class McpClient {
  constructor(command, args, { env, cwd } = {}) {
    this.child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      windowsHide: true,
      env: { ...process.env, ...env },
      cwd,
    });
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = '';
    this.child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-4000);
    });
    createInterface({ input: this.child.stdout }).on('line', (line) => this.receive(line));
    this.exited = new Promise((resolveExit) =>
      this.child.on('exit', (code) => {
        for (const { reject } of this.pending.values())
          reject(new Error(`MCP server exited (${code}): ${this.stderr.trim().split('\n').slice(-3).join(' ')}`));
        this.pending.clear();
        resolveExit(code);
      }),
    );
  }

  receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id === undefined || !this.pending.has(message.id)) return;
    const { resolve, reject, timer } = this.pending.get(message.id);
    this.pending.delete(message.id);
    clearTimeout(timer);
    if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
    else resolve(message.result);
  }

  request(method, params, timeoutMs = 120000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async start() {
    await this.request(
      'initialize',
      { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'qa-runner-replay', version: '1' } },
      180000,
    );
    this.notify('notifications/initialized');
    return this;
  }

  // Returns { text, isError } with the tool's text parts joined.
  async call(name, args = {}, timeoutMs) {
    const result = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    const text = (result?.content || [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    return { text, isError: Boolean(result?.isError) || /^### Error/m.test(text) };
  }

  async close() {
    try {
      await this.call('browser_close', {}, 15000);
    } catch {
      // the browser may already be gone
    }
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill(), 5000);
    await this.exited;
    clearTimeout(timer);
  }
}

// Splits a Playwright MCP reply into its "### Section" blocks.
export function sections(text) {
  const out = new Map();
  let name = null;
  for (const line of String(text || '').split('\n')) {
    const header = /^### (.+)$/.exec(line);
    if (header) {
      name = header[1].trim();
      out.set(name, []);
    } else if (name) out.get(name).push(line);
  }
  return new Map([...out].map(([key, lines]) => [key, lines.join('\n').trim()]));
}

// The code inside a "Ran Playwright code" section, without its fence.
export function ranCode(text) {
  const block = sections(text).get('Ran Playwright code');
  if (!block) return null;
  return block.replace(/^```[a-z]*\n?/i, '').replace(/\n?```\s*$/, '').trim() || null;
}
