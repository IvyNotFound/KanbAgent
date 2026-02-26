#!/usr/bin/env node
/**
 * Spike T576: Validate claude CLI stream-json for xterm.js replacement
 *
 * Tests:
 * Q1: Does stream-json work without -p (interactive long mode, N turns)?
 * Q2: Can we write to stdin between turns to send user messages?
 * Q3: Does --thinking expose separate thinking blocks in stream-json?
 * Q4: Is --resume <conv_id> compatible with stream-json?
 *
 * Usage:
 *   node scripts/spike-stream-json.js [--conv-id <id>]
 *
 * NOTE: Must unset CLAUDECODE env var before running:
 *   CLAUDECODE= node scripts/spike-stream-json.js
 */

const { spawn } = require('child_process');
const readline = require('readline');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function pass(label) {
  console.log(`${GREEN}✓ PASS${RESET} ${label}`);
}
function fail(label, reason) {
  console.log(`${RED}✗ FAIL${RESET} ${label}${reason ? ` — ${reason}` : ''}`);
}
function info(msg) {
  console.log(`${CYAN}  →${RESET} ${msg}`);
}
function section(title) {
  console.log(`\n${BOLD}${YELLOW}=== ${title} ===${RESET}`);
}

/**
 * Spawn claude with given args and options.
 * Returns a promise that resolves to { lines: string[], exitCode: number, convId: string|null }.
 *
 * @param {string[]} args - CLI args
 * @param {object} opts
 * @param {string[]} [opts.stdinMessages] - Lines to write to stdin (JSON or text)
 * @param {number} [opts.timeoutMs=30000] - Max time to wait
 * @param {(line: string, parsed: any) => boolean} [opts.stopOn] - Stop early when true
 */
function runClaude(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const { stdinMessages = [], timeoutMs = 45000, stopOn } = opts;

    const env = { ...process.env };
    delete env.CLAUDECODE; // allow nested execution

    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    const lines = [];
    let convId = null;
    let stderr = '';
    let settled = false;
    let stdinQueue = [...stdinMessages];
    let stdinSent = 0;

    function settle(exitCode) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ lines, exitCode, convId, stderr });
    }

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      settle(-1);
    }, timeoutMs);

    const rl = readline.createInterface({ input: proc.stdout });
    // For --input-format stream-json: send the FIRST message immediately after spawn
    if (stdinQueue.length > 0) {
      const first = stdinQueue.shift();
      info(`→ writing stdin initial message: ${first.slice(0, 60)}`);
      proc.stdin.write(first + '\n');
      stdinSent++;
    } else {
      // No stdin messages — close stdin so claude doesn't wait for input
      proc.stdin.end();
    }

    rl.on('line', (raw) => {
      lines.push(raw);
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { /* not JSON */ }

      // Extract session_id from result events
      if (parsed && parsed.session_id) {
        convId = parsed.session_id;
      }

      // Pretty-print event summary
      if (parsed && parsed.type) {
        const type = parsed.type;
        if (type === 'system' && parsed.subtype) {
          info(`[system:${parsed.subtype}] session=${parsed.session_id || '?'}`);
        } else if (type === 'assistant') {
          const texts = (parsed.message?.content || [])
            .filter(b => b.type === 'text')
            .map(b => b.text?.slice(0, 80));
          const thinking = (parsed.message?.content || [])
            .filter(b => b.type === 'thinking')
            .map(b => b.thinking?.slice(0, 80));
          if (thinking.length) info(`[assistant:thinking] "${thinking[0]}…"`);
          if (texts.length) info(`[assistant:text] "${texts[0]}…"`);
        } else if (type === 'user') {
          const texts = (parsed.message?.content || [])
            .filter(b => b.type === 'text')
            .map(b => b.text?.slice(0, 60));
          if (texts.length) info(`[user] "${texts[0]}…"`);
        } else if (type === 'result') {
          info(`[result] cost=$${parsed.cost_usd?.toFixed(4) || '?'} turns=${parsed.num_turns || 1}`);
          // After a result, send the next stdin message if any
          if (stdinQueue.length > 0) {
            const msg = stdinQueue.shift();
            info(`→ writing stdin turn ${++stdinSent}: ${msg.slice(0, 60)}`);
            proc.stdin.write(msg + '\n');
          } else if (stdinMessages.length > 0) {
            // All stdin messages sent, close stdin to end the session
            proc.stdin.end();
          }
        }
      }

      // Stop early if requested
      if (stopOn && parsed && stopOn(raw, parsed)) {
        proc.kill('SIGTERM');
        settle(0);
      }
    });

    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => settle(code));
  });
}

// ---------------------------------------------------------------------------
// Q1: stream-json works without -p (interactive mode)
// ---------------------------------------------------------------------------
async function testQ1() {
  section('Q1: stream-json without -p (interactive mode)');
  info('According to CLI help: --output-format only works with --print (-p)');
  info('Testing: claude --output-format stream-json "hello" (no -p)');

  const { lines, exitCode, stderr } = await runClaude(
    ['--output-format', 'stream-json', 'What is 2+2? Answer in one word.'],
    { timeoutMs: 20000 }
  );

  const hasJsonLines = lines.some(l => {
    try { JSON.parse(l); return true; } catch { return false; }
  });

  if (hasJsonLines) {
    pass('Q1: stream-json works without -p');
    info(`Got ${lines.length} lines, ${lines.filter(l => { try { JSON.parse(l); return true; } catch { return false; } }).length} valid JSON`);
  } else {
    fail('Q1: stream-json without -p', 'No JSON lines in output');
    if (stderr) info(`stderr: ${stderr.slice(0, 200)}`);
    if (lines.length) info(`stdout (first 3): ${lines.slice(0, 3).join(' | ')}`);
  }
  return { pass: hasJsonLines, sampleLines: lines.slice(0, 5) };
}

// ---------------------------------------------------------------------------
// Q1b: stream-json WITH -p (should work)
// ---------------------------------------------------------------------------
async function testQ1b() {
  section('Q1b: stream-json WITH -p (baseline)');
  info('Testing: claude -p --output-format stream-json "hello"');

  const { lines, exitCode, convId, stderr } = await runClaude(
    ['-p', '--verbose', '--output-format', 'stream-json', 'What is 2+2? Answer in one word.'],
    { timeoutMs: 60000 }
  );

  const jsonLines = lines.filter(l => { try { JSON.parse(l); return true; } catch { return false; } });
  const hasResult = jsonLines.some(l => JSON.parse(l).type === 'result');
  const hasAssistant = jsonLines.some(l => JSON.parse(l).type === 'assistant');

  if (hasResult && hasAssistant) {
    pass('Q1b: stream-json with -p works');
    info(`session_id (conv_id): ${convId}`);
    info(`Total lines: ${lines.length}, JSON: ${jsonLines.length}`);
  } else {
    fail('Q1b', `result=${hasResult} assistant=${hasAssistant}`);
    if (stderr) info(`stderr: ${stderr.slice(0, 200)}`);
  }
  return { pass: hasResult && hasAssistant, convId, exitCode };
}

// ---------------------------------------------------------------------------
// Q2: Write to stdin between turns for multi-turn conversation
// ---------------------------------------------------------------------------
async function testQ2() {
  section('Q2: Multi-turn via stdin with --input-format stream-json');
  info('Testing: claude -p --input-format stream-json --output-format stream-json');
  info('Turn 1: ask "What is 5+5? Answer in one word."');
  info('Turn 2 (after result): ask "And what is 10+10? Answer in one word."');

  // With --input-format stream-json, stdin messages must use the full message format:
  // { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '...' }] } }
  const mkMsg = (text) => JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] }
  });
  const turn1 = mkMsg('What is 5+5? Answer in one word.');
  const turn2 = mkMsg('And what is 10+10? Answer in one word.');

  const { lines, exitCode, convId } = await runClaude(
    ['-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json'],
    {
      stdinMessages: [turn1, turn2],
      timeoutMs: 120000,
    }
  );

  const jsonLines = lines.filter(l => { try { JSON.parse(l); return true; } catch { return false; } });
  const results = jsonLines.filter(l => JSON.parse(l).type === 'result');
  const assistantMsgs = jsonLines.filter(l => JSON.parse(l).type === 'assistant');

  // Multi-turn = at least 2 result events
  const isMultiTurn = results.length >= 2;

  if (isMultiTurn) {
    pass(`Q2: Multi-turn stdin works (${results.length} result events, ${assistantMsgs.length} assistant messages)`);
    info(`conv_id: ${convId}`);
  } else {
    fail('Q2: Multi-turn stdin', `Only ${results.length} result events (need ≥2)`);
    info(`Exit code: ${exitCode}`);
    info(`Total JSON lines: ${jsonLines.length}`);
    if (jsonLines.length > 0) {
      info('Types seen: ' + [...new Set(jsonLines.map(l => JSON.parse(l).type))].join(', '));
    }
  }
  return { pass: isMultiTurn, convId, numTurns: results.length };
}

// ---------------------------------------------------------------------------
// Q3: --thinking exposes thinking blocks in stream-json
// ---------------------------------------------------------------------------
async function testQ3() {
  section('Q3: --thinking exposes thinking blocks in stream-json');
  info('Testing: claude -p --output-format stream-json --thinking "reason step by step: what is 7*8?"');

  const { lines, exitCode, stderr } = await runClaude(
    ['-p', '--verbose', '--output-format', 'stream-json',
     '--thinking', 'enabled',
     'Reason step by step: what is 7 multiplied by 8?'],
    { timeoutMs: 60000 }
  );

  const jsonLines = lines.filter(l => { try { JSON.parse(l); return true; } catch { return false; } });

  // Check for thinking blocks in assistant messages
  let hasThinkingBlock = false;
  let hasThinkingType = false;
  for (const l of jsonLines) {
    const parsed = JSON.parse(l);
    if (parsed.type === 'assistant') {
      const content = parsed.message?.content || [];
      if (content.some(b => b.type === 'thinking')) {
        hasThinkingBlock = true;
      }
    }
    if (parsed.type === 'thinking') {
      hasThinkingType = true;
    }
  }

  if (hasThinkingBlock) {
    pass('Q3: thinking blocks present in assistant content (type:"thinking")');
  } else if (hasThinkingType) {
    pass('Q3: thinking events present as top-level type:"thinking"');
  } else {
    fail('Q3: --thinking', 'No thinking blocks found in stream-json output');
    if (stderr) info(`stderr: ${stderr.slice(0, 200)}`);
    info('Types seen: ' + [...new Set(jsonLines.map(l => JSON.parse(l).type))].join(', '));
  }
  return { pass: hasThinkingBlock || hasThinkingType, hasThinkingBlock, hasThinkingType };
}

// ---------------------------------------------------------------------------
// Q4: --resume <conv_id> compatible with stream-json
// ---------------------------------------------------------------------------
async function testQ4(convId) {
  section('Q4: --resume with stream-json');

  if (!convId) {
    info('No conv_id available from previous tests — skipping Q4');
    fail('Q4: --resume', 'No conv_id available');
    return { pass: false, reason: 'no conv_id' };
  }

  info(`Testing resume with conv_id: ${convId}`);

  const { lines, exitCode, convId: returnedConvId, stderr } = await runClaude(
    ['-p', '--verbose', '--output-format', 'stream-json', '--resume', convId,
     'What was my last question? Summarize in one sentence.'],
    { timeoutMs: 60000 }
  );

  const jsonLines = lines.filter(l => { try { JSON.parse(l); return true; } catch { return false; } });
  const hasResult = jsonLines.some(l => JSON.parse(l).type === 'result');
  const hasAssistant = jsonLines.some(l => JSON.parse(l).type === 'assistant');
  const errorLines = jsonLines.filter(l => JSON.parse(l).type === 'error' || JSON.parse(l).subtype === 'error');

  if (hasResult && hasAssistant && errorLines.length === 0) {
    pass(`Q4: --resume works with stream-json (returned convId: ${returnedConvId})`);
  } else if (errorLines.length > 0) {
    fail('Q4: --resume', `Error event: ${JSON.stringify(JSON.parse(errorLines[0]))}`);
  } else {
    fail('Q4: --resume', `result=${hasResult} assistant=${hasAssistant} exit=${exitCode}`);
    if (stderr) info(`stderr: ${stderr.slice(0, 300)}`);
  }
  return { pass: hasResult && hasAssistant && errorLines.length === 0 };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`${BOLD}Spike T576: claude CLI stream-json validation${RESET}`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log(`Node: ${process.version}`);

  // Check CLAUDECODE is unset
  if (process.env.CLAUDECODE) {
    console.log(`\n${RED}ERROR: CLAUDECODE env var is set — nested Claude session blocked.${RESET}`);
    console.log(`Run with: ${YELLOW}CLAUDECODE= node scripts/spike-stream-json.js${RESET}`);
    process.exit(1);
  }

  const results = {};

  // Q1: without -p
  results.q1 = await testQ1();

  // Q1b: with -p (baseline)
  results.q1b = await testQ1b();

  // Q2: multi-turn stdin
  results.q2 = await testQ2();

  // Q3: thinking blocks
  results.q3 = await testQ3();

  // Q4: resume (use conv_id from Q2 if available, else Q1b)
  const convId = results.q2?.convId || results.q1b?.convId;
  results.q4 = await testQ4(convId);

  // ---------------------------------------------------------------------------
  // Final report
  // ---------------------------------------------------------------------------
  section('FINAL REPORT');
  console.log('');

  const checks = [
    { key: 'q1',  label: 'Q1: stream-json without -p works',                result: results.q1 },
    { key: 'q1b', label: 'Q1b: stream-json with -p works (baseline)',        result: results.q1b },
    { key: 'q2',  label: 'Q2: multi-turn via stdin --input-format stream-json', result: results.q2 },
    { key: 'q3',  label: 'Q3: --thinking exposes thinking blocks',           result: results.q3 },
    { key: 'q4',  label: 'Q4: --resume <conv_id> compatible with stream-json', result: results.q4 },
  ];

  for (const { label, result } of checks) {
    if (result?.pass) pass(label);
    else fail(label, result?.reason || '');
  }

  console.log('');
  section('ARCHITECTURE CONCLUSIONS');

  if (results.q1b?.pass && results.q2?.pass) {
    console.log(`${GREEN}✓ Feasibility CONFIRMED${RESET}: child_process.spawn + stream-json CAN replace xterm.js`);
    console.log(`  Architecture: claude -p --verbose --input-format stream-json --output-format stream-json`);
    console.log(`  stdin:  JSONL messages — { type: "user", message: { role: "user", content: [{ type: "text", text: "..." }] } }`);
    console.log(`  stdout: JSONL events (system, user, assistant, result)`);
    console.log(`  NOTE:  Send first stdin message immediately after spawn (before system:init)`);
  } else {
    console.log(`${RED}✗ Feasibility BLOCKED${RESET}: some critical tests failed`);
  }

  if (results.q1?.pass) {
    console.log(`${GREEN}✓ Bonus${RESET}: stream-json also works without -p (interactive mode)`);
  } else {
    console.log(`${YELLOW}⚠ Note${RESET}: stream-json requires -p flag (not usable in pure interactive mode)`);
  }

  if (results.q3?.pass) {
    console.log(`${GREEN}✓ Thinking${RESET}: separate thinking blocks available in stream-json`);
    if (results.q3.hasThinkingBlock) console.log(`  Location: inside assistant.message.content[] as type:"thinking"`);
    if (results.q3.hasThinkingType) console.log(`  Location: top-level events type:"thinking"`);
  } else {
    console.log(`${YELLOW}⚠ Thinking${RESET}: --thinking enabled does NOT expose thinking blocks in stream-json`);
    console.log(`  Tested with claude-sonnet-4-6 — blocks are absent from assistant.message.content[]`);
    console.log(`  Possible workaround: use claude-opus-4-6 or wait for API support in stream-json`);
  }

  if (results.q4?.pass) {
    console.log(`${GREEN}✓ Resume${RESET}: --resume <conv_id> works with stream-json`);
  } else {
    console.log(`${YELLOW}⚠ Resume${RESET}: --resume test failed or skipped`);
  }

  // Exit code: 0 if baseline (Q1b) and multi-turn (Q2) pass
  const overallPass = results.q1b?.pass && results.q2?.pass;
  process.exit(overallPass ? 0 : 1);
}

main().catch(err => {
  console.error(`${RED}Fatal error:${RESET}`, err);
  process.exit(2);
});
