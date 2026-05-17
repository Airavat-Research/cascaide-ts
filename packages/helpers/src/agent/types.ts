/**
 * agents/types.ts
 *
 * Public types for createReactAgent and its variants.
 */

import type { ToolParam, LLMProvider } from '../llm/types';
import type { CascadeController, WorkflowContext } from '@cascaide-ts/core';

export type { ToolParam, LLMProvider };

/** A ToolParam with a collocated execute function. */
export interface ToolDefinition extends ToolParam {
  /** Receives the already-parsed args object. Return any serialisable value. */
  execute: (args: Record<string, any>, listenerApi?: any) => Promise<any>;
}

export interface SubAgentDescriptor {
  /** Must match the nodeName already in your graph, e.g. 'searchAgentNode'. */
  name: string;
  /** Shown to the LLM as the tool description so it knows when to delegate here. */
  description: string;
}

export type Env = 'server' | 'client';

export interface BaseAgentConfig {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  tools?: ToolDefinition[];
  isStreaming?: boolean;
  env?: Env;
}

export interface ReactAgentConfig extends BaseAgentConfig {}

export interface RecursiveReactAgentConfig extends BaseAgentConfig {
  maxDepth?: number; // default: 2
}

export interface SupervisorAgentConfig extends BaseAgentConfig {
  subAgents: SubAgentDescriptor[];
}

export interface RecursiveSupervisorAgentConfig extends BaseAgentConfig {
  subAgents: SubAgentDescriptor[];
  maxDepth?: number; // default: 2
}

export interface ReactAgentBundle {
  agentNode: {
    prep: (context: WorkflowContext, initialContext: any) => Promise<any>;
    exec: (prepOutput: any) => Promise<any>;
    post: (execOutput: any) => Promise<any>;
  };
  toolNode: {
    prep: (context: WorkflowContext, initialContext: any) => Promise<any>;
    exec: (prepOutput: any, controller: CascadeController) => Promise<any>;
    post: (execOutput: any) => Promise<any>;
  };
  nodes: Record<string, any>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal factory config — not exported from package index
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentFactoryConfig {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  subAgents: SubAgentDescriptor[];
  selfDelegation: boolean;
  maxDepth: number;
  isStreaming: boolean;
  env: Env;
}