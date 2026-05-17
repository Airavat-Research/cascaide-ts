import { CascadePersistence } from './persistence';
import { Middleware } from "@reduxjs/toolkit";
import type { ListenerEffectAPI } from '@reduxjs/toolkit';
import { createServerStore } from './stores/createServerStore';

// core/types.ts
export type WorkflowStep = {
  history: any[];
  status: string;
  [extraKeys: string]: any; // this should give some freedom for custom keys
};

export type WorkflowContext = {
  [cascadeId: string]: WorkflowStep[];
};


export type ActionMeta = {
  origin?: 'client' | 'server';
  functionId?: number;
  cascadeId?: string;
  userId?:string;
  uiUpdates?: Updates; // V1: retained
};

export type ActiveNode = {
  nodeName: string;
  parentTriggerId?: string;
  processed?: boolean;
  initialContext?: any;
  origin?: 'client' | 'server';
  functionId?: number;
  cascadeId?: string;
};


export type NodeHistoryRecord ={
  nodeId: string;
  nodeName: string;
  timestamp: number;
}

export interface WorkflowState {
  context: WorkflowContext;
  activeNodes: { [nodeId: string]: ActiveNode };
  history: NodeHistoryRecord[];
  errors: { [nodeId: string]: string };
}

export interface ClaimRequest {
  nodeInstanceId: string;
  cascadeId: string;
  userId: string;
  nodeName: string;
  functionId: number;
  inputContext: any;
  location: 'client' | 'server';
}

export interface ClaimResponse {
  status: string;
  functionId: number;
}

export interface NodeDefinition {
  name: string;
  isUINode: boolean;
  env: 'client' | 'server';
}

export type Updates = {
  [cascadeId: string] : WorkflowStep
}


export type SpawnContext<T = Record<string, any>> = {
  cascadeId?: string;
  history: any[];
  userId?: string;
} & T;

export type Spawns = Record<string, SpawnContext>;



export type PostResult = {
  updates: Updates;
  uiUpdates? : Updates;
  spawns?: Record<string, SpawnContext>; 
}


export interface WorkflowHandlerConfig {
  workflowGraph: ServerWorkflowGraph;
  persistor?: CascadePersistence; // The user passes their PostgresPersistor here
  maxExecutionTime?: number;
  safeBuffer?: number;
  extraMiddlewares?: Middleware[]; 
}



export type ClientWorkflowGraph = Record<string, NodeDefinition>;



export type StreamEventType = 'init' | 'sync' | 'chunk';








export type ChunkMapper = (chunk: any) => ChunkDelta | ChunkDelta[] | null;

// V1: interface with silent field retained
export interface ChunkDelta {
  identity:   string;
  value:      any;
  accumulate?: (current: any, incoming: any) => any;
  buffer?:    boolean;  // true = hold until stream end, then flush once
  silent?:    boolean;  // true = assemble into canonical but never send to frontend
}

export interface StreamChunk {
  cascadeId: string;
  identity: string;
  value: any;
}


// ─── Stream Adapter ──────────────────────────────────────────────────────────
// Implement this interface to create a custom adapter.
//
// For stateful adapters (e.g. tracking tool call indexes, think-block state),
// use the `createAdapter()` factory so state lives safely in a closure rather
// than at module level.
//
// Example:
//   const myAdapter = createAdapter(() => {
//     let inThinkBlock = false;
//     return {
//       isReasoningModel: true,
//       extractDelta(chunk) { ... }
//     };
//   });


// ─── Stream Config ───────────────────────────────────────────────────────────
// Returned by a node's exec() to tell handleProviderStream how to process
// the raw provider stream.
//
// Resolution order in handleProviderStream:
//   1. `adapter`  — custom adapter passed directly (always wins)
//   2. registry   — built-in lookup via `${provider}-reasoning` or `provider`
//   3. error      — throws if neither resolves

export type LLMProvider = 'anthropic' | 'openai-responses' | 'gemini-genai' | 'openai' | 'custom';

export interface StreamConfig {
  stream:       AsyncIterable<any>;
  provider:     LLMProvider;
 
  /**
   * Custom mapper — overrides the built-in mapper for this provider.
   * Use when you need to handle a provider variant or custom API shape.
   */
  mapper?:      ChunkMapper | (() => ChunkMapper);
 
  /**
   * Controls what gets sent to the frontend.
   *
   * Return false         → suppress this identity (not sent, not in uiMessage)
   * Return the value     → pass through unchanged
   * Return anything else → send this instead (replacement/redaction)
   *
   * When absent, everything non-silent is sent as-is and uiMessage is not
   * populated (persistence middleware treats canonical as the UI source too).
   *
   * @example
   * // Suppress thinking from frontend
   * filter: (identity, value) => identity === 'thinking' ? false : value
   *
   * @example
   * // Redact tool call args
   * filter: (identity, value) => {
   *   if (identity === 'tool_calls') {
   *     return value.map((tc: any) => ({ ...tc, args: { _redacted: true } }));
   *   }
   *   return value;
   * }
   *
   * @example
   * // Replace tool result with a UI indicator
   * filter: (identity, value) => {
   *   if (identity === 'tool_calls') {
   *     return { type: 'tool_indicator', names: value.map((tc: any) => tc.name) };
   *   }
   *   return value;
   * }
   */
  filter?:      StreamFilter;
}

export type MapperFactory = () => ChunkMapper;

export interface StreamResult {
  /**
   * Full assembled canonical message — all identities, no filtering.
   * Always present. Written to cascade state as LLM history.
   */
  canonical: Record<string, any>;

  /**
   * What was actually sent to the frontend — filtered/replaced values only.
   * Only present when a filter was applied. When absent, canonical is the
   * source of truth for UI as well (persistence middleware handles this).
   */
  uiMessage?: Record<string, any>;
}


// V1: StreamFilter as a standalone named exported type
export type StreamFilter = (identity: string, value: any) => any | false;











//// CHANGES!!!!!!


export type ServerRootState = {
  workflow: WorkflowState;
};


export type ServerStore = ReturnType<typeof createServerStore>['store'];
export type ServerDispatch = ServerStore['dispatch'];
export type ServerListenerApi = ListenerEffectAPI<ServerRootState, ServerDispatch>;


export type CascadeController = {
  // write
  updateContext: (updates: Updates) => void;
  spawn: (spawns: Record<string, SpawnContext>) => Promise<void>;
  fork: (newCascadeId: string, upToFunctionId: number, sourceCascadeId?: string) => Promise<{ status: 'SUCCESS' | 'FAILED' }>;
  waitUntil: (predicate: (state: ServerRootState) => boolean) => Promise<void>;

  // read
  getCascadeState: (cascadeId: string) => CascadeStateResult | undefined;
  getCascadeNodes: (cascadeId: string) => CascadeNode[];
  isComplete: (cascadeId: string) => boolean;
  exists: (cascadeId: string) => boolean;
  getState: () => ServerRootState
};


export type CascadeNode = {
  nodeId: string;
  nodeName: string;
  parentTriggerId?: string;
  initialContext?: any;
  processed?: boolean;
};

export type CascadeStateResult = {
  status: string;
  history: any[];
  [key: string]: any;
};

export interface ServerNodeDefinition<TPrep = any, TExec = any>
  extends NodeDefinition {
  isStreaming: false;
  prep: (cascadeContext: WorkflowContext, initialContext: any) => Promise<TPrep>;
  exec: (prepOutput: TPrep, controller?: CascadeController) => Promise<TExec>;
  post: (execOutput: TExec) => Promise<PostResult>;
}

export interface StreamingServerNodeDefinition<TPrep = any>
  extends NodeDefinition {
  isStreaming: true;
  prep: (cascadeContext: WorkflowContext, initialContext: any) => Promise<TPrep>;
  exec: (prepOutput: TPrep, controller?: CascadeController) => Promise<StreamConfig>;
  post: (execOutput: StreamingExecOutput) => Promise<PostResult>;
}

export type StreamingExecOutput = {
  assistantMessage: any;
  uiAssistantMessage?: any;
  cascadeId?: string;
  history: any[];
  userId?: string;
}

export type ServerWorkflowGraph = Record<
  string,
  ServerNodeDefinition<any, any> | StreamingServerNodeDefinition<any>
>;