/** Agent framework contracts — Section 9. */
export interface AgentContext {
  eventId: string;
  articles: ArticleRef[];
  event: EventRef;
}

export interface ArticleRef {
  id: string; source_id: string; source_name: string; publisher_group: string;
  origin_type: string; reliability_score: number | null; url: string; title: string;
  summary: string | null; published_at: string | null; category: string | null;
  lat: number | null; lon: number | null; payload: string;
}

export interface EventRef {
  id: string; title: string; category: string; country: string | null;
  first_seen_at: string; last_activity_at: string; article_count: number;
  independent_sources: number; measurements: string | null; status: string;
}

export type AgentStatus = 'ok' | 'insufficient_data' | 'unavailable' | 'blocked';

export interface AgentResult<T = unknown> {
  agent: string;
  agentVersion: string;
  mode: 'deterministic' | 'llm';
  status: AgentStatus;
  /** null when status !== 'ok' — never a filler value. */
  output: T | null;
  confidence: number | null;
  notes: string[];
}

export interface Agent<T = unknown> {
  name: string;
  version: string;
  /** Orchestrator uses this to avoid running irrelevant agents (Section 7). */
  appliesTo(ctx: AgentContext): boolean;
  run(ctx: AgentContext): Promise<AgentResult<T>>;
}
