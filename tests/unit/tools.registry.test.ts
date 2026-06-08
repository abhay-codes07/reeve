/**
 * Registry shape + progressive-exposure tests. No network involved.
 */

import { describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/tools/index.js';
import { listNamespaces, listTools, getToolSchema } from '../../src/tools/exposure.js';

const registry = buildRegistry();

describe('tool registry', () => {
  it('registers 50+ tools across 7 namespaces', () => {
    expect(registry.size).toBeGreaterThanOrEqual(50);
    expect(registry.namespaces().sort()).toEqual(
      [
        'github-actions',
        'github-checks',
        'github-issues',
        'github-prs',
        'github-releases',
        'github-repo',
        'github-search',
      ].sort(),
    );
  });

  it('has unique, function-call-safe tool names', () => {
    const names = registry.all().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('every tool has a description and both schemas', () => {
    for (const t of registry.all()) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.inputSchema).toBeDefined();
      expect(t.outputSchema).toBeDefined();
    }
  });

  it('meets the per-namespace minimums from the spec', () => {
    const counts = Object.fromEntries(
      registry.namespaces().map((ns) => [ns, registry.byNamespace(ns).length]),
    );
    expect(counts['github-issues']).toBeGreaterThanOrEqual(12);
    expect(counts['github-prs']).toBeGreaterThanOrEqual(11);
    expect(counts['github-repo']).toBeGreaterThanOrEqual(11);
    expect(counts['github-actions']).toBeGreaterThanOrEqual(8);
    expect(counts['github-search']).toBeGreaterThanOrEqual(6);
  });
});

describe('progressive exposure', () => {
  it('list_namespaces returns descriptions and counts', () => {
    const ns = listNamespaces(registry);
    expect(ns.length).toBe(7);
    for (const entry of ns) {
      expect(entry.toolCount).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(10);
    }
  });

  it('list_tools returns name + description for a namespace', () => {
    const tools = listTools(registry, 'github-issues');
    expect(tools.find((t) => t.name === 'issues_list')).toBeTruthy();
    expect(tools.every((t) => typeof t.description === 'string')).toBe(true);
  });

  it('get_tool_schema returns JSON schema for input and output', () => {
    const schema = getToolSchema(registry, 'issues_get');
    expect(schema.name).toBe('issues_get');
    expect(schema.namespace).toBe('github-issues');
    expect(schema.inputSchema).toMatchObject({ type: 'object' });
    expect(schema.outputSchema).toMatchObject({ type: 'object' });
  });

  it('rejects unknown namespaces and tools', () => {
    expect(() => listTools(registry, 'github-nope')).toThrowError(/No such namespace/);
    expect(() => getToolSchema(registry, 'nope_tool')).toThrowError(/No such tool/);
  });
});
