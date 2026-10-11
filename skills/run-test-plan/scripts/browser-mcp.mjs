#!/usr/bin/env node
// Starts one browser of the Test Agents' pool: a Playwright MCP server with its own in-memory
// profile, so parallel agents never share tabs or cookies. Claude Code runs it over stdio from the
// plugin's manifest (`browser-mcp.mjs <slot>`); a node wrapper keeps that entry the same on every
// OS (npx needs a shell on Windows). Flags and overrides: browserArgs in agents.mjs.
import { spawn } from 'node:child_process';
import { browserArgs } from './agents.mjs';

const slot = process.argv[2] || '1';
const child = spawn('npx', browserArgs(slot), { stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
