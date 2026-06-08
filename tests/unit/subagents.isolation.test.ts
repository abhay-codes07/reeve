/**
 * Isolation tests for the subagents (CLAUDE.md invariant #2). No LLM/network —
 * these assert the STRUCTURE of the isolation:
 *   - the subagent's available tools equal its scoped subset (not the registry),
 *   - it physically cannot reach out-of-scope tools,
 *   - its input is only a brief that is a pure function of the task params,
 *   - each run gets a fresh thread id,
 *   - the subagent-spawning tools are discoverable on the orchestrator registry
 *     but absent from the base (scope-source) registry, so subagents can't recurse.
 */

import { describe, expect, it } from 'vitest';
import { testContext } from '../helpers/context.js';
import { buildRegistry, invokeTool } from '../../src/tools/index.js';
import {
  buildOrchestratorRegistry,
  ORCHESTRATOR_INSTRUCTIONS,
  REVIEW_PR_SCOPE,
  INVESTIGATE_ISSUE_SCOPE,
  buildReviewPrBrief,
  buildInvestigateIssueBrief,
  createReviewPrSubagent,
  createInvestigateIssueSubagent,
} from '../../src/agents/index.js';
import { NotFoundError } from '../../src/errors/index.js';

const ctx = testContext();
const EXPOSURE_TOOLS = ['get_tool_schema', 'invoke_tool', 'list_namespaces', 'list_tools'];

describe('subagent scoped toolset', () => {
  it('review_pr subagent sees exactly its read-only scope, nothing more', () => {
    const h = createReviewPrSubagent(ctx);
    expect(h.scopedRegistry.all().map((t) => t.name).sort()).toEqual([...REVIEW_PR_SCOPE].sort());
    expect(h.scopedRegistry.size).toBe(REVIEW_PR_SCOPE.length);

    // The four progressive-exposure tools are its only agent tools.
    expect(Object.keys(h.tools).sort()).toEqual(EXPOSURE_TOOLS);

    // It cannot see write tools or unrelated namespaces.
    expect(h.scopedRegistry.has('issues_create')).toBe(false);
    expect(h.scopedRegistry.has('prs_merge')).toBe(false);
    expect(h.scopedRegistry.has('review_pr')).toBe(false);

    // It is dramatically smaller than the full registry.
    expect(h.scopedRegistry.size).toBeLessThan(buildOrchestratorRegistry().size);
  });

  it('review_pr subagent physically cannot invoke an out-of-scope tool', async () => {
    const h = createReviewPrSubagent(ctx);
    // invoke_tool over the SCOPED registry can't resolve a tool it doesn't hold.
    await expect(
      invokeTool(h.scopedRegistry, 'prs_merge', { pullNumber: 1 }, ctx),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      invokeTool(h.scopedRegistry, 'issues_create', { title: 'x' }, ctx),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('investigate_issue subagent sees exactly its read-only scope', () => {
    const h = createInvestigateIssueSubagent(ctx);
    expect(h.scopedRegistry.all().map((t) => t.name).sort()).toEqual(
      [...INVESTIGATE_ISSUE_SCOPE].sort(),
    );
    expect(Object.keys(h.tools).sort()).toEqual(EXPOSURE_TOOLS);
    expect(h.scopedRegistry.has('issues_close')).toBe(false);
  });
});

describe('subagent brief is the only input (no parent context)', () => {
  it('review brief is a pure function of the PR number and leaks no parent prompt', () => {
    const brief = buildReviewPrBrief(42);
    expect(brief).toContain('#42');
    expect(brief.toLowerCase()).toContain('pull request');
    // It does not carry the orchestrator's instructions or any conversation.
    expect(brief).not.toContain(ORCHESTRATOR_INSTRUCTIONS);
    expect(brief).not.toMatch(/orchestrator/i);
    // Same number -> same brief; different number -> differs only by the number.
    expect(buildReviewPrBrief(42)).toBe(brief);
    expect(buildReviewPrBrief(7)).toBe(brief.replaceAll('#42', '#7'));
  });

  it('investigate brief is a pure function of the issue number', () => {
    const brief = buildInvestigateIssueBrief(5);
    expect(brief).toContain('#5');
    expect(brief.toLowerCase()).toContain('issue');
    expect(brief).not.toMatch(/orchestrator/i);
  });
});

describe('subagent identity & freshness', () => {
  it('is a distinct agent with its own id (not the orchestrator)', () => {
    const h = createReviewPrSubagent(ctx);
    expect(h.agent.id).toBe('reeve-subagent-review-pr');
    expect(h.agent.id).not.toBe('reeve-orchestrator');
  });

  it('mints a fresh thread id per construction', () => {
    const a = createReviewPrSubagent(ctx);
    const b = createReviewPrSubagent(ctx);
    expect(a.threadId).not.toBe(b.threadId);
    expect(a.threadId).toMatch(/[0-9a-f-]{36}/);
  });
});

describe('subagent tools are discoverable but non-recursive', () => {
  it('review_pr/investigate_issue are on the orchestrator registry, not the base', () => {
    const full = buildOrchestratorRegistry();
    const base = buildRegistry();
    expect(full.has('review_pr')).toBe(true);
    expect(full.has('investigate_issue')).toBe(true);
    expect(full.namespaces()).toContain('subagents');
    // The base registry (the scope source) is subagent-free, so subagents
    // can never scope themselves into existence recursively.
    expect(base.has('review_pr')).toBe(false);
    expect(base.has('investigate_issue')).toBe(false);
  });
});
