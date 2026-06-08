/**
 * Live end-to-end smoke test (run manually, not part of CI).
 *
 *   pnpm tsx scripts/smoke.ts
 *
 * Drives ONE real task through the orchestrator agent: it forces the live Gemini
 * model (google/gemini-2.5-flash, flash-lite fallback) to discover tools via
 * list_namespaces / list_tools / get_tool_schema and act via invoke_tool against
 * the live GITHUB_SANDBOX_REPO. Prints the model's final answer and confirms both
 * the Gemini call and the GitHub tool calls succeeded. Surfaces any error verbatim.
 *
 * Requires a real .env (GITHUB_TOKEN, GOOGLE_GENERATIVE_AI_API_KEY,
 * GITHUB_SANDBOX_REPO). Does not change any architecture.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env into process.env (tsx does not do this automatically).
try {
  const text = readFileSync(resolve(process.cwd(), '.env'), 'utf-8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {
  /* rely on ambient env */
}

const { loadEnv } = await import('../src/config/index.js');
const { getGitHubClient } = await import('../src/github/index.js');
const { createOrchestrator } = await import('../src/agents/index.js');

const TASK =
  'List the open issues in the sandbox repo and give me a one-paragraph summary of what they are about. If there are no open issues, say so clearly.';

function hr(label: string): void {
  console.log(`\n${'='.repeat(8)} ${label} ${'='.repeat(8)}`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  hr('CONFIG');
  console.log('sandbox repo :', `${env.sandbox.owner}/${env.sandbox.repo}`);
  console.log('model        : google/gemini-2.5-flash (fallback google/gemini-2.5-flash-lite)');

  const github = getGitHubClient(env);
  const orchestrator = createOrchestrator({ github, env });

  hr('TASK');
  console.log(TASK);

  const result = await orchestrator.generate(TASK, { maxSteps: 12 });

  // --- inspect tool activity --------------------------------------------
  const toolCalls = ((result as any).toolCalls ?? []) as any[];
  const toolResults = ((result as any).toolResults ?? []) as any[];

  const callName = (c: any): string => c?.toolName ?? c?.name ?? c?.payload?.toolName ?? 'unknown';
  const callArgs = (c: any): any => c?.args ?? c?.payload?.args ?? c?.input ?? {};
  const resultPayload = (r: any): any => r?.result ?? r?.payload?.result ?? r?.output ?? r;

  hr('TOOL CALLS');
  const metaCalls = toolCalls.map(callName);
  console.log('meta-tool calls :', metaCalls.length ? metaCalls.join(' -> ') : '(none)');

  // Which registry tools did the model invoke through invoke_tool?
  const invoked = toolCalls
    .filter((c) => callName(c) === 'invoke_tool')
    .map((c) => String(callArgs(c)?.toolName ?? '?'));
  console.log('invoke_tool targets :', invoked.length ? invoked.join(', ') : '(none)');

  // Did any invoke_tool call return ok:true for a github-issues tool?
  let githubOk = false;
  for (const r of toolResults) {
    const payload = resultPayload(r);
    if (payload && typeof payload === 'object' && payload.ok === true) githubOk = true;
  }
  const usedIssuesTool = invoked.some((n) => n.startsWith('issues_'));
  const discovered = metaCalls.some((n) =>
    ['list_namespaces', 'list_tools', 'get_tool_schema'].includes(n),
  );

  hr('FINAL ANSWER');
  console.log(result.text?.trim() || '(empty)');

  hr('VERIFICATION');
  const usage = (result as any).usage ?? {};
  console.log('finishReason :', (result as any).finishReason ?? '(n/a)');
  console.log('token usage  :', JSON.stringify(usage));
  console.log('Gemini call succeeded        :', Boolean(result.text && result.text.length > 0));
  console.log('Tool discovery happened      :', discovered);
  console.log('invoke_tool used a github tool:', usedIssuesTool);
  console.log('a tool call returned ok:true  :', githubOk);

  const success = Boolean(result.text) && discovered && usedIssuesTool && githubOk;
  hr(success ? 'RESULT: PASS ✅' : 'RESULT: INCOMPLETE ⚠️');
  if (!success) {
    console.log(
      'The model answered but did not clearly exercise the full discover->invoke->github path.',
    );
    console.log('Full tool-call dump:');
    console.log(JSON.stringify(toolCalls, null, 2));
    process.exitCode = 2;
  }
}

main().catch((err: unknown) => {
  hr('ERROR (verbatim)');
  if (err instanceof Error) {
    console.error(err.name + ':', err.message);
    if ((err as any).cause) console.error('cause:', (err as any).cause);
    console.error(err.stack);
  } else {
    console.error(err);
  }
  process.exitCode = 1;
});
