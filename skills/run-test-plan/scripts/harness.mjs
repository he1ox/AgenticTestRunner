// The agent harness the orchestrator runs in: Claude Code, Codex, Cursor, Gemini CLI, OpenCode,
// Copilot CLI, or any other agent that can run shell commands (`generic`). It decides only how
// Test Agents are launched and which model each tier gets by default:
//
// - claude-code with the qa-runner plugin: the plugin's dedicated Test Agents, each bound to one
//   browser of a pool of three, several at once.
// - everything else (and Claude Code without the plugin, `next --fallback`): one Test Agent at a
//   time on a single shared browser server, with the agent's rules inside its prompt. The
//   harness's own subagent tool runs it, or the orchestrator runs it inline when there is none.
//
// The harness comes from `--harness`, then QA_HARNESS, then .qa/config.json → harness, then
// detection (Claude Code sets CLAUDECODE=1 in its shells), then `generic`.
import { CONFIG } from './lib.mjs';

export const HARNESSES = ['claude-code', 'codex', 'cursor', 'gemini', 'opencode', 'copilot', 'generic'];

// Models per tier when neither the plan nor .qa/config.json → execution.tiers pins one. Other
// harnesses name models differently, so they get none and run on the session's own model.
const DEFAULT_MODELS = {
  'claude-code': { simple: 'haiku', standard: 'sonnet', complex: 'sonnet' },
};

export function resolveHarness(flag) {
  const configured = typeof CONFIG.harness === 'string' ? CONFIG.harness : CONFIG.harness?.name;
  const name = String(
    (typeof flag === 'string' && flag) || process.env.QA_HARNESS || configured || (process.env.CLAUDECODE ? 'claude-code' : 'generic'),
  ).toLowerCase();
  if (!HARNESSES.includes(name)) throw new Error(`unknown harness "${name}"; use one of ${HARNESSES.join(', ')}`);
  return name;
}

export const defaultModel = (harness, tier) => DEFAULT_MODELS[harness]?.[tier] || null;

// Only Claude Code has the plugin's per-browser agents; every other harness shares one browser.
export const hasPool = (harness) => harness === 'claude-code';

// How to register the shared browser server by hand, for an install without the harness's plugin
// or extension (`npx skills add`, a copied folder). `script` is browser-mcp.mjs's absolute path.
// Claude Code's fallback agents expect the server to be named `playwright`.
export function browserRegistration(harness, script) {
  const args = [script, 'shared'];
  const servers = (entry) => JSON.stringify({ mcpServers: { 'qa-browser': entry } }, null, 2);
  const quoted = args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
  switch (harness) {
    case 'claude-code':
      return `claude mcp add playwright -- node ${quoted}`;
    case 'codex':
      return `codex mcp add qa-browser -- node ${quoted}`;
    case 'gemini':
      return `gemini mcp add qa-browser node ${quoted}`;
    case 'cursor':
      return `.cursor/mcp.json (project) or ~/.cursor/mcp.json:\n${servers({ command: 'node', args })}`;
    case 'opencode':
      return `opencode.json → "mcp":\n${JSON.stringify({ mcp: { 'qa-browser': { type: 'local', command: ['node', ...args], enabled: true } } }, null, 2)}`;
    case 'copilot':
      return `~/.copilot/mcp-config.json (or /mcp add in Copilot CLI):\n${servers({ type: 'local', command: 'node', args, tools: ['*'] })}`;
    default:
      return `your agent's MCP settings, as a stdio server:\n${servers({ command: 'node', args })}`;
  }
}
