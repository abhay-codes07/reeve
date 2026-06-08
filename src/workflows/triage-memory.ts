/**
 * Run-scoped memory for the long-horizon triage task.
 *
 * The triage_repository task can span 25+ tool calls across many issues. To keep
 * the working context BOUNDED (CLAUDE.md invariant #3), we do not carry raw issue
 * bodies or full investigation transcripts forward. Instead we persist:
 *   - the PLAN (recorded once, up front),
 *   - short per-batch SUMMARIES (the compaction sink — each processed page /
 *     cluster / investigation is reduced to one line),
 *   - a small key/value STATE bag (counters, the cluster set, etc.).
 *
 * This is a deliberately lightweight, in-process store rather than @mastra/memory
 * + a storage adapter: it keeps the long-horizon task deterministic and unit
 * testable with no database dependency. The interface is the seam — a Mastra
 * Memory-backed implementation could be dropped in later without touching the
 * workflow.
 */

export interface TriagePlan {
  goal: string;
  repo: string;
  /** Ordered high-level steps the run will follow. */
  steps: string[];
  createdAt: string;
}

export interface TriageMemorySnapshot {
  plan: TriagePlan | undefined;
  batchSummaries: string[];
  state: Record<string, unknown>;
}

export interface TriageMemory {
  /** Record the plan once, at the start of the run. */
  recordPlan(plan: TriagePlan): void;
  getPlan(): TriagePlan | undefined;
  /** Compaction sink: reduce a processed batch to a short summary line. */
  recordBatchSummary(summary: string): void;
  getBatchSummaries(): string[];
  /** Small running-state bag (counters, cluster set, ...). */
  setState(key: string, value: unknown): void;
  getState<T = unknown>(key: string): T | undefined;
  snapshot(): TriageMemorySnapshot;
}

/** Default in-process implementation. */
export class InMemoryTriageMemory implements TriageMemory {
  private plan: TriagePlan | undefined;
  private readonly batchSummaries: string[] = [];
  private readonly state = new Map<string, unknown>();

  recordPlan(plan: TriagePlan): void {
    this.plan = plan;
  }

  getPlan(): TriagePlan | undefined {
    return this.plan;
  }

  recordBatchSummary(summary: string): void {
    this.batchSummaries.push(summary);
  }

  getBatchSummaries(): string[] {
    return [...this.batchSummaries];
  }

  setState(key: string, value: unknown): void {
    this.state.set(key, value);
  }

  getState<T = unknown>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }

  snapshot(): TriageMemorySnapshot {
    return {
      plan: this.plan,
      batchSummaries: [...this.batchSummaries],
      state: Object.fromEntries(this.state),
    };
  }
}
