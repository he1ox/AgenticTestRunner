// "Chat with your agent": each message from the viewer runs one headless turn of an agent CLI,
// scoped to one test case. The CLI is the project's harness (.qa/config.json → harness) or
// QA_CHAT_HARNESS; one adapter per CLI below turns a turn into its arguments and reads its JSON
// events back. The session id is kept per case, so follow-up questions resume the same
// conversation (a CLI that hands out no id gets the conversation so far in its prompt instead).
// The agent can read the run's files and images, and its only write path is `qa-runs.mjs
// annotate`, so it can mark up screenshots but not touch results or code. When the harness has no
// headless CLI, or the CLI is not installed, the drawer says why and stays disabled.
//
//   QA_CHAT_HARNESS   claude | codex | gemini | opencode | copilot (default: the project's harness)
//   QA_CHAT_BIN       the CLI to run (QA_CLAUDE_BIN still works for claude)
//   QA_CHAT_MODEL     model (claude: sonnet; others: the CLI's own default)
//   QA_CHAT_EFFORT    effort, where the CLI takes one (default: low)
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { delimiter, dirname, extname, join } from 'node:path';
import { CONFIG, PROJECT_ROOT, SKILL_DIR, displayPath, readJson, runDir, tcDir, writeJson } from './lib.mjs';
import { costOf } from './pricing.mjs';

const EFFORT = process.env.QA_CHAT_EFFORT || 'low';
const MAX_MESSAGE = 4000;
const live = new Map();

const repoPath = displayPath;
const cliPath = () => repoPath(join(SKILL_DIR, 'scripts', 'qa-runs.mjs'));
const chatDir = (runId, tcId) => join(tcDir(runId, tcId), 'chat');
const messagesFile = (runId, tcId) => join(chatDir(runId, tcId), 'messages.json');
const sessionFile = (runId, tcId) => join(chatDir(runId, tcId), 'session.json');

// ---------------------------------------------------------------------------------------------
// Adapters. Each one: bin, model (default), args(turn) → argv, prompt in stdin or argv, and
// parse(turn, event) for one JSON line of its output, filling turn.delta / committed / activity /
// cost / error / sessionId. `session` says how a conversation continues: 'preset' (we choose the
// id), 'captured' (the CLI reports one) or 'none' (history goes in the prompt).

const commit = (turn, text) => {
  if (!text) return;
  turn.committed += (turn.committed ? '\n\n' : '') + text;
  turn.delta = '';
};

const ADAPTERS = {
  claude: {
    label: 'Claude Code',
    bin: 'claude',
    model: 'sonnet',
    session: 'preset',
    stdin: true,
    systemPromptFlag: true,
    args: (t) => [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      ...(t.model ? ['--model', t.model] : []),
      '--effort',
      EFFORT,
      '--tools',
      'Read,Glob,Grep,Bash',
      '--allowedTools',
      'Read',
      'Glob',
      'Grep',
      `Bash(node ${cliPath()} annotate:*)`,
      `Bash(node ${cliPath()} memory:*)`,
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--disable-slash-commands',
      '--exclude-dynamic-system-prompt-sections',
      '--append-system-prompt',
      t.systemPrompt,
      ...(t.resume ? ['--resume', t.sessionId] : ['--session-id', t.sessionId]),
    ],
    parse(turn, event) {
      if (event.type === 'stream_event') {
        const delta = event.event?.delta;
        if (event.event?.type === 'content_block_delta' && delta?.type === 'text_delta') turn.delta += delta.text;
      } else if (event.type === 'assistant') {
        for (const block of event.message?.content || []) {
          if (block.type === 'text' && block.text) commit(turn, block.text);
          else if (block.type === 'tool_use') turn.activity.push(describeTool(block.name, block.input));
        }
      } else if (event.type === 'user') {
        for (const block of event.message?.content || []) if (block.type === 'tool_result' && block.is_error) markFailed(turn);
      } else if (event.type === 'result') {
        turn.cost = event.total_cost_usd ?? null;
        if (event.is_error) turn.error = String(event.result || event.subtype || 'the agent reported an error');
        if (!turn.committed && event.result) turn.committed = String(event.result);
      }
    },
  },

  // codex exec --json: JSON Lines of thread.started {thread_id}, item.started/item.completed
  // {item: {type: agent_message|command_execution|…}}, turn.completed {usage}, turn.failed, error.
  // Its sandbox is the boundary: workspace-write so `annotate` can save marks.
  codex: {
    label: 'Codex',
    bin: 'codex',
    model: null,
    session: 'captured',
    // Options go before `resume`: the parent command parses them for both forms.
    args: (t) => [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      ...(t.model ? ['-m', t.model] : []),
      '-c',
      `model_reasoning_effort="${EFFORT}"`,
      ...(t.resume ? ['resume', t.sessionId] : []),
      t.prompt,
    ],
    parse(turn, event) {
      if (event.type === 'thread.started') turn.sessionId = event.thread_id || turn.sessionId;
      else if (event.type === 'item.started' && event.item?.type === 'command_execution')
        turn.activity.push(describeTool('Bash', { command: event.item.command }));
      else if (event.type === 'item.completed') {
        const item = event.item || {};
        if (item.type === 'agent_message') commit(turn, item.text);
        else if (item.type === 'command_execution' && (item.status === 'failed' || (item.exit_code ?? 0) !== 0)) markFailed(turn);
        else if (item.type === 'mcp_tool_call') turn.activity.push({ tool: 'MCP', detail: String(item.tool || '') });
      } else if (event.type === 'turn.completed' && event.usage) {
        const u = event.usage;
        turn.cost = costOf(turn.model, {
          input: (u.input_tokens || 0) - (u.cached_input_tokens || 0),
          cacheRead: u.cached_input_tokens || 0,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          output: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0),
        });
      } else if (event.type === 'turn.failed' || event.type === 'error') turn.error = String(event.error?.message || event.message || 'the agent reported an error');
    },
  },

  // gemini -p … --output-format stream-json: init {session_id, model}, message {role, content,
  // delta}, tool_use {tool_name, parameters}, tool_result {status}, error, result {status, stats}.
  // Read tools need no approval; the shell is allowed for the annotate and memory commands only.
  gemini: {
    label: 'Gemini CLI',
    bin: 'gemini',
    model: null,
    session: 'captured',
    args: (t) => [
      '--output-format',
      'stream-json',
      ...(t.model ? ['--model', t.model] : []),
      '--allowed-mcp-server-names',
      'none',
      '--allowed-tools',
      `run_shell_command(node ${cliPath()} annotate)`,
      '--allowed-tools',
      `run_shell_command(node ${cliPath()} memory)`,
      ...(t.resume ? ['--resume', t.sessionId] : []),
      '-p',
      t.prompt,
    ],
    parse(turn, event) {
      if (event.type === 'init') {
        turn.sessionId = event.session_id || turn.sessionId;
        turn.modelUsed = event.model || turn.modelUsed;
      } else if (event.type === 'message' && event.role === 'assistant') {
        if (event.delta) turn.delta += event.content || '';
        else commit(turn, event.content);
      } else if (event.type === 'tool_use') {
        if (turn.delta) commit(turn, turn.delta);
        turn.activity.push(describeTool(geminiTool(event.tool_name), event.parameters));
      } else if (event.type === 'tool_result' && event.status === 'error') markFailed(turn);
      else if (event.type === 'error' && event.severity === 'error') turn.error = String(event.message || 'error');
      else if (event.type === 'result') {
        if (event.status === 'error') turn.error = String(event.error?.message || 'the agent reported an error');
        let cost = 0;
        for (const [model, s] of Object.entries(event.stats?.models || {})) {
          const c = costOf(model, { input: s.input ?? s.input_tokens ?? 0, cacheRead: s.cached || 0, cacheWrite5m: 0, cacheWrite1h: 0, output: s.output_tokens || 0 });
          if (c === null) return void (turn.cost = null);
          cost += c;
        }
        turn.cost = Object.keys(event.stats?.models || {}).length ? cost : null;
      }
    },
  },

  // opencode run --format json: {type, timestamp, sessionID, part} with text, tool_use (part.tool,
  // part.state), step_finish (part.cost), error. Permissions come from OPENCODE_PERMISSION; a run
  // cannot ask, so anything not allowed is refused.
  opencode: {
    label: 'OpenCode',
    bin: 'opencode',
    model: null,
    session: 'captured',
    env: () => ({
      OPENCODE_PERMISSION: JSON.stringify({
        edit: 'deny',
        webfetch: 'deny',
        bash: { '*': 'deny', [`node ${cliPath()} annotate*`]: 'allow', [`node ${cliPath()} memory*`]: 'allow' },
      }),
    }),
    args: (t) => [
      'run',
      '--format',
      'json',
      ...(t.model ? ['--model', t.model] : []),
      ...(t.resume ? ['--session', t.sessionId] : []),
      t.prompt,
    ],
    parse(turn, event) {
      if (event.sessionID) turn.sessionId = event.sessionID;
      const part = event.part || {};
      if (event.type === 'text') commit(turn, part.text);
      else if (event.type === 'tool_use') {
        turn.activity.push(describeTool(opencodeTool(part.tool), part.state?.input));
        if (part.state?.status === 'error') markFailed(turn);
      } else if (event.type === 'step_finish' && typeof part.cost === 'number') turn.cost = (turn.cost || 0) + part.cost;
      else if (event.type === 'error') turn.error = String(event.error?.message || event.error?.data?.message || 'the agent reported an error');
    },
  },

  // copilot -p … --output-format json: JSON Lines whose schema GitHub does not document yet; both
  // shapes seen in the wild are read (assistant.message {data.content} and a flat message). No
  // session id is relied on, so each turn carries the conversation so far.
  copilot: {
    label: 'Copilot CLI',
    bin: 'copilot',
    model: null,
    session: 'none',
    args: (t) => [
      '-p',
      t.prompt,
      '--output-format',
      'json',
      '--no-ask-user',
      '--deny-tool',
      'write',
      '--allow-tool',
      `shell(node ${cliPath()} annotate:*)`,
      '--allow-tool',
      `shell(node ${cliPath()} memory:*)`,
      ...(t.model ? ['--model', t.model] : []),
    ],
    parse(turn, event) {
      const data = event.data || event;
      const content = typeof data.content === 'string' ? data.content : Array.isArray(data.content) ? data.content.map((c) => c?.text || '').join('') : '';
      if (event.type === 'assistant.message_delta') turn.delta += data.deltaContent || '';
      else if (event.type === 'assistant.message' || (event.type === 'message' && (event.role || data.role) !== 'user')) commit(turn, content);
      else if (event.type === 'tool.execution_start' || event.type === 'tool_use')
        turn.activity.push(describeTool(String(data.toolName || data.name || 'tool'), data.arguments || data.input));
      else if (event.type === 'tool.execution_complete' && (data.error || data.success === false)) markFailed(turn);
      else if (event.type === 'error' || event.type === 'session.error') turn.error = String(data.message || 'the agent reported an error');
    },
  },
};

// Harness names (harness.mjs) → chat adapters; cursor and generic have none.
const FOR_HARNESS = { 'claude-code': 'claude', claude: 'claude', codex: 'codex', gemini: 'gemini', opencode: 'opencode', copilot: 'copilot' };

function chatHarness() {
  const configured = typeof CONFIG.harness === 'string' ? CONFIG.harness : CONFIG.harness?.name;
  const name = String(process.env.QA_CHAT_HARNESS || configured || 'claude-code').toLowerCase();
  return { name, adapter: FOR_HARNESS[name] || null };
}

// Windows runs npm CLIs through .cmd shims, which need a shell that would mangle a multi-line
// prompt; the shim names the real program, so it runs directly instead.
function resolveBin(bin) {
  const isPath = /[\\/]/.test(bin);
  // An extensionless file next to a Windows shim is its sh twin, which Windows cannot run.
  const exts = process.platform === 'win32' ? (extname(bin) ? [''] : ['.exe', '.cmd', '.bat']) : [''];
  const dirs = isPath ? [''] : (process.env.PATH || '').split(delimiter).filter(Boolean);
  for (const dir of dirs)
    for (const ext of exts) {
      const file = dir ? join(dir, bin + ext) : bin + ext;
      try {
        if (!existsSync(file) || !statSync(file).isFile()) continue;
      } catch {
        continue;
      }
      if (!/\.(cmd|bat)$/i.test(file)) return { command: file, prefix: [] };
      // npm shims also mention a node.exe that may sit next to them; the program is the other path.
      const path = [...readFileSync(file, 'utf8').matchAll(/"%~?dp0%?\\([^"]+?\.(?:js|mjs|cjs|exe))"/gi)]
        .map((m) => join(dirname(file), m[1]))
        .find((p) => !/[\\/]node\.exe$/i.test(p) && existsSync(p));
      if (!path) continue;
      return /\.exe$/i.test(path) ? { command: path, prefix: [] } : { command: process.execPath, prefix: [path] };
    }
  return null;
}

// What the viewer needs before the first message: which CLI answers, or why none can. The drawer
// polls, so the PATH lookup is cached for a short while (an install shows up without a restart).
let cached = null;
export function chatInfo() {
  if (cached && Date.now() - cached.at < 15000) return cached.info;
  cached = { at: Date.now(), info: lookupChat() };
  return cached.info;
}

function lookupChat() {
  const { name, adapter } = chatHarness();
  if (!adapter)
    return {
      harness: name,
      available: false,
      reason: `The ${name} harness has no headless CLI the viewer can drive. Set QA_CHAT_HARNESS to claude, codex, gemini, opencode or copilot before starting the viewer to chat through one of those.`,
    };
  const spec = ADAPTERS[adapter];
  const bin = process.env.QA_CHAT_BIN || (adapter === 'claude' && process.env.QA_CLAUDE_BIN) || spec.bin;
  const resolved = resolveBin(bin);
  return {
    harness: name,
    adapter,
    label: spec.label,
    bin,
    resolved,
    model: process.env.QA_CHAT_MODEL || spec.model,
    available: Boolean(resolved),
    reason: resolved ? null : `"${bin}" (${spec.label}) is not on the PATH of the viewer server. Install it, or set QA_CHAT_BIN to its path and restart the viewer.`,
  };
}

export function chatState(runId, tcId) {
  const turn = live.get(`${runId}/${tcId}`);
  const { resolved, bin, ...info } = chatInfo();
  return {
    ...info,
    messages: readJson(messagesFile(runId, tcId), []),
    busy: Boolean(turn),
    pending: turn ? { text: turn.committed + turn.delta, activity: turn.activity } : null,
  };
}

function append(runId, tcId, message) {
  const messages = readJson(messagesFile(runId, tcId), []);
  messages.push({ ...message, at: new Date().toISOString() });
  writeJson(messagesFile(runId, tcId), messages);
}

// Kept short on purpose: it is paid on every turn. The agent pulls the brief, result, plan or the
// mark syntax (`annotate --help`) only when a question needs them.
function systemPrompt(runId, tcId) {
  const base = tcDir(runId, tcId);
  const cli = `node ${cliPath()} annotate ${runId} ${tcId}`;
  const memoryCli = `node ${cliPath()} memory`;
  return `You assist a human reviewer in the local QA viewer, about test case ${tcId} of run ${runId}.

Files (your file-reading tool opens images too; open only what the question needs):
- brief (what the Test Agent was told): ${repoPath(join(base, 'brief.md'))}
- result: ${repoPath(join(base, 'result.json'))}
- evidence: ${repoPath(join(base, 'evidence'))}/  (<image>.annotations.json = marks + element boxes)
- plan: ${repoPath(join(runDir(runId), 'plan.json'))} · verdicts: ${repoPath(join(runDir(runId), 'review.json'))}

Answer in the reviewer's language, short and concrete; quote exact on-screen text when it matters. Say plainly when the evidence does not show something; never invent a result.

Your only write path is marking screenshots: run \`${cli} --help\` once before your first mark, then \`${cli} <image> --list|--add|--remove\`. Never edit images, results or other files.

If the reviewer states a fact a future run should reuse (a test value, a workaround), propose it with \`${memoryCli} add --help\`; a human approves it in the Memory panel. You cannot drive the browser or re-run the test; suggest a retest instead.`;
}

// For a CLI that cannot resume: the earlier turns, newest last, trimmed to stay cheap.
function history(runId, tcId) {
  const messages = readJson(messagesFile(runId, tcId), []).slice(-11, -1);
  if (!messages.length) return '';
  return `Conversation so far:\n${messages.map((m) => `${m.role === 'user' ? 'Reviewer' : 'You'}: ${String(m.text || '').slice(0, 1500)}`).join('\n')}\n\n`;
}

export function sendChat(runId, tcId, { message, image }) {
  const key = `${runId}/${tcId}`;
  if (live.has(key)) throw Object.assign(new Error('the agent is still answering'), { status: 409 });
  const text = String(message || '')
    .trim()
    .slice(0, MAX_MESSAGE);
  if (!text) throw Object.assign(new Error('empty message'), { status: 400 });
  const info = chatInfo();
  if (!info.available) throw Object.assign(new Error(info.reason), { status: 503 });
  const spec = ADAPTERS[info.adapter];

  // A session belongs to the CLI that opened it; switching CLIs starts a new conversation.
  const stored = readJson(sessionFile(runId, tcId));
  const session = stored && (stored.adapter || 'claude') === info.adapter ? stored : null;
  let sessionId = session?.sessionId || null;
  if (spec.session === 'preset' && !sessionId) sessionId = randomUUID();
  if (!session || session.sessionId !== sessionId)
    writeJson(sessionFile(runId, tcId), { adapter: info.adapter, sessionId, createdAt: new Date().toISOString() });
  append(runId, tcId, { role: 'user', text, image: image || null });

  const resume = Boolean(session?.sessionId);
  // Every prompt opens with "[" so a CLI never reads the reviewer's text as a flag.
  const said = `${image ? `[The reviewer is looking at screenshot evidence/${image}]` : '[Reviewer]'}\n${text}`;
  const prompt = spec.systemPromptFlag
    ? said
    : resume
      ? said
      : `[Instructions]\n${systemPrompt(runId, tcId)}\n\n${spec.session === 'none' ? history(runId, tcId) : ''}${said}`;
  const turnInfo = { model: info.model, sessionId, resume, prompt, systemPrompt: systemPrompt(runId, tcId) };
  const args = [...info.resolved.prefix, ...spec.args(turnInfo)];

  const child = spawn(info.resolved.command, args, {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    env: { ...process.env, ...(spec.env?.() || {}), CLAUDE_CODE_ENTRYPOINT: 'qa-viewer', QA_MEMORY_ROLE: 'chat', QA_PROJECT_DIR: PROJECT_ROOT },
  });
  const turn = { child, model: info.model, committed: '', delta: '', activity: [], cost: null, error: null, stderr: '', buffer: '', sessionId };
  live.set(key, turn);

  const handle = (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    try {
      spec.parse(turn, event);
    } catch {
      // an event shape this adapter does not know is skipped, not fatal
    }
  };
  child.stdout.on('data', (chunk) => {
    turn.buffer += chunk.toString('utf8');
    const lines = turn.buffer.split('\n');
    turn.buffer = lines.pop();
    for (const line of lines) if (line.trim()) handle(line);
  });
  child.stderr.on('data', (chunk) => (turn.stderr = (turn.stderr + chunk.toString('utf8')).slice(-2000)));
  child.on('error', (error) => (turn.error = `Could not start "${info.bin}": ${error.message}`));
  child.on('close', (code) => {
    if (turn.buffer.trim()) handle(turn.buffer);
    live.delete(key);
    if (spec.session === 'captured' && turn.sessionId && turn.sessionId !== sessionId)
      writeJson(sessionFile(runId, tcId), { adapter: info.adapter, sessionId: turn.sessionId, createdAt: new Date().toISOString() });
    const answer = (turn.committed + turn.delta).trim();
    const failed = turn.error || (code !== 0 && !answer);
    if (failed && !turn.error && /unknown (argument|option)|unrecognized (argument|option)|unexpected argument/i.test(turn.stderr))
      turn.error = `${info.label} at "${info.bin}" does not know the flags the viewer uses; update it. ${turn.stderr.trim().split('\n').at(-1)}`;
    append(runId, tcId, {
      role: 'assistant',
      text: answer || (turn.stopped ? 'Stopped.' : ''),
      activity: turn.activity,
      cost: turn.cost,
      harness: info.adapter,
      error: failed ? turn.error || turn.stderr.trim().split('\n').slice(-3).join(' ') || `exit code ${code}` : null,
    });
  });
  if (spec.stdin) child.stdin.end(prompt);
  else child.stdin.end();
}

const markFailed = (turn) => {
  const last = turn.activity.at(-1);
  if (last) last.failed = true;
};

const geminiTool = (name) =>
  ({ read_file: 'Read', read_many_files: 'Read', glob: 'Glob', search_file_content: 'Grep', grep: 'Grep', run_shell_command: 'Bash', list_directory: 'Glob' })[name] || name;
const opencodeTool = (name) => ({ read: 'Read', glob: 'Glob', grep: 'Grep', bash: 'Bash', list: 'Glob' })[name] || name;

function describeTool(name, input = {}) {
  input ||= {};
  if (name === 'Bash') {
    const command = String(input.command || '');
    const annotate = /annotate\s+\S+\s+\S+\s+(\S+)\s+(--\w+)/.exec(command);
    return annotate ? { tool: 'annotate', detail: `${annotate[2].slice(2)} ${annotate[1]}` } : { tool: 'Bash', detail: command.slice(0, 120) };
  }
  if (name === 'Read')
    return {
      tool: 'Read',
      detail: String(input.file_path || input.filePath || input.absolute_path || input.path || '')
        .split(/[\\/]/)
        .slice(-2)
        .join('/'),
    };
  return { tool: name, detail: String(input.pattern || input.path || '').slice(0, 120) };
}

export function stopChat(runId, tcId) {
  const turn = live.get(`${runId}/${tcId}`);
  if (!turn) return false;
  turn.stopped = true;
  turn.child.kill();
  return true;
}

export function resetChat(runId, tcId) {
  stopChat(runId, tcId);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const file of [messagesFile(runId, tcId), sessionFile(runId, tcId)])
    if (existsSync(file)) renameSync(file, file.replace(/\.json$/, `.${stamp}.json`));
}
