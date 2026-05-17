/**
 * agents/createReactAgent.ts
 *
 * One internal factory (_createAgent) drives four named exports:
 *
 *   createReactAgent                — standard ReAct loop, no delegation
 *   createRecursiveReactAgent       — ReAct that can delegate to itself
 *   createSupervisorAgent           — delegates to named sub-agents only
 *   createRecursiveSupervisorAgent  — delegates to itself AND named sub-agents
 *
 * All four return { agentNode, toolNode, nodes }.
 * Spread .nodes directly into your cascade graph declaration.
 *
 * ─── Quick reference ──────────────────────────────────────────────────────────
 *
 *  createReactAgent('search', {
 *    provider: 'openai-responses', model: 'gpt-4o-mini',
 *    systemPrompt: '...', tools: [...],
 *  });
 *
 *  createRecursiveReactAgent('search', { ...above, maxDepth: 2 });
 *
 *  createSupervisorAgent('orchestrator', {
 *    provider: 'openai-responses', model: 'gpt-4o',
 *    systemPrompt: '...',
 *    subAgents: [
 *      { name: 'searchAgentNode', description: 'Searches the web.' },
 *      { name: 'writerAgentNode', description: 'Writes content.'   },
 *    ],
 *  });
 *
 *  createRecursiveSupervisorAgent('orchestrator', { ...above, maxDepth: 2 });
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { v4 as uuidv4 } from 'uuid';
import {
  toProviderHistory,
  buildTools,
  extractToolCalls,
  buildToolResultMessage,
  buildErrorToolResultMessage,
} from '../llm/llmProviderAdapters';
import type {
  CanonicalMessage,
  CanonicalToolCall,
  NormalizedToolCall,
  ToolParam,
  LLMProvider,
} from '../llm/types';
import type {
  WorkflowContext,
  Updates,
  PostResult,
  CascadeController,
  SpawnContext,
} from '@cascaide-ts/core';
import type {
  ToolDefinition,
  SubAgentDescriptor,
  AgentFactoryConfig,
  ReactAgentBundle,
  ReactAgentConfig,
  RecursiveReactAgentConfig,
  SupervisorAgentConfig,
  RecursiveSupervisorAgentConfig,
} from './types';

export type {
  ToolDefinition,
  SubAgentDescriptor,
  ReactAgentBundle,
  ReactAgentConfig,
  RecursiveReactAgentConfig,
  SupervisorAgentConfig,
  RecursiveSupervisorAgentConfig,
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

type NonStreamingExecOutput = {
  assistantMessage: CanonicalMessage;
  cascadeId: string;
  userId?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. parseCompletedResponse — provider-native completed response → CanonicalMessage
//    Used only in the non-streaming path.
// ─────────────────────────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV === 'development';

// Helper function for dev-only logging
const devLog = (...args: any[]) => {
  if (isDev) console.log(...args);
};

const devError = (...args: any[]) => {
  if (isDev) console.error(...args);
};

export function parseCompletedResponse(
  provider: LLMProvider,
  response: any
): CanonicalMessage {
  switch (provider) {

    case 'anthropic': {
      const msg: CanonicalMessage = { role: 'assistant' };
      const toolCalls: CanonicalToolCall[] = [];

      for (const block of response.content ?? []) {
        if (block.type === 'thinking') {
          msg.thinking = block.thinking;
          msg.extensions = {
            ...msg.extensions,
            anthropic: { ...msg.extensions?.anthropic, signature: block.signature },
          };
        } else if (block.type === 'text') {
          msg.content = block.text;
        } else if (block.type === 'tool_use') {
          toolCalls.push({ id: block.id, name: block.name, args: block.input });
        }
      }

      if (toolCalls.length) msg.tool_calls = toolCalls;
      return msg;
    }

    case 'openai': {
      const choice = response.choices?.[0];
      const msg: CanonicalMessage = { role: 'assistant' };

      if (choice?.message?.content) msg.content = choice.message.content;

      if (choice?.message?.tool_calls?.length) {
        msg.tool_calls = choice.message.tool_calls.map((tc: any) => ({
          id:   tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        }));
      }

      return msg;
    }

    case 'openai-responses': {
      const msg: CanonicalMessage = { role: 'assistant' };
      const toolCalls: CanonicalToolCall[] = [];
      const outputItems: any[] = response.output ?? [];

      for (const item of outputItems) {
        if (item.type === 'reasoning') {
          msg.thinking = item.summary?.map((s: any) => s.text).join('') ?? '';
        } else if (item.type === 'message') {
          msg.content = item.content
            ?.filter((c: any) => c.type === 'output_text')
            .map((c: any) => c.text)
            .join('') ?? '';
        } else if (item.type === 'function_call') {
          toolCalls.push({
            id:   item.call_id,
            name: item.name,
            args: JSON.parse(item.arguments),
          });
        }
      }

      if (toolCalls.length) msg.tool_calls = toolCalls;
      msg.extensions = { openai_responses: { output: outputItems } };
      return msg;
    }

    case 'gemini-genai': {
      const msg: CanonicalMessage = { role: 'assistant' };
      const toolCalls: CanonicalToolCall[] = [];
      const parts: any[] = response.candidates?.[0]?.content?.parts ?? [];

      for (const part of parts) {
        if (part.thought) {
          msg.thinking = part.text;
          msg.extensions = {
            ...msg.extensions,
            gemini: { ...msg.extensions?.gemini, thoughtSignature: part.thoughtSignature },
          };
        } else if (part.text) {
          msg.content = part.text;
        } else if (part.functionCall) {
          toolCalls.push({
            id:   part.functionCall.id ?? part.functionCall.name,
            name: part.functionCall.name,
            args: part.functionCall.args,
          });
        }
      }

      if (toolCalls.length) msg.tool_calls = toolCalls;
      msg.extensions = { ...msg.extensions, gemini: { ...msg.extensions?.gemini, parts } };
      return msg;
    }

    default:
      throw new Error(`[parseCompletedResponse] Unknown provider: ${provider}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. callLLM — dispatch to the right provider SDK
//    Returns { stream, provider } when isStreaming = true.
//    Returns { response, provider } when isStreaming = false.
// ─────────────────────────────────────────────────────────────────────────────
export async function callLLM(
  provider: LLMProvider, model: string, systemPrompt: string,
  history: any[], nativeTools: any, isStreaming: true
): Promise<{ stream: any; provider: LLMProvider }>;

export async function callLLM(
  provider: LLMProvider, model: string, systemPrompt: string,
  history: any[], nativeTools: any, isStreaming: false
): Promise<{ response: any; provider: LLMProvider }>;

export async function callLLM(
  provider: LLMProvider, model: string, systemPrompt: string,
  history: any[], nativeTools: any, isStreaming: boolean
): Promise<{ stream: any; provider: LLMProvider } | { response: any; provider: LLMProvider }> {

  switch (provider) {

    case 'anthropic': {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const result = await client.messages.create({
        model,
        max_tokens: 2048,
        stream: isStreaming as any,
        system: systemPrompt,
        messages: history,
        tools: nativeTools,
        thinking: { budget_tokens: 1024, type: 'enabled' },
      });
      return isStreaming
        ? { stream: result, provider }
        : { response: result, provider };
    }

    case 'openai-responses': {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const result = await openai.responses.create({
        model,
        stream: isStreaming as any,
        input: history,
        instructions: systemPrompt,
        tools: nativeTools,
        store: true,
      });
      return isStreaming
        ? { stream: result, provider }
        : { response: result, provider };
    }

    case 'openai': {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const result = await openai.chat.completions.create({
        model,
        stream: isStreaming as any,
        messages: history,
        tools: nativeTools,
      });
      return isStreaming
        ? { stream: result, provider }
        : { response: result, provider };
    }

    case 'gemini-genai': {
      const { GoogleGenAI, ThinkingLevel } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      if (isStreaming) {
        const stream = await ai.models.generateContentStream({
          model,
          contents: history,
          config: {
            systemInstruction: systemPrompt,
            tools: nativeTools,
            thinkingConfig: { includeThoughts: true, thinkingLevel: ThinkingLevel.HIGH },
          },
        });
        return {
          stream,
          provider,
        };
      } else {
        const response = await ai.models.generateContent({
          model,
          contents: history,
          config: {
            systemInstruction: systemPrompt,
            tools: nativeTools,
            thinkingConfig: { includeThoughts: true, thinkingLevel: ThinkingLevel.HIGH },
          },
        });
        return { response, provider };
      }
    }

    default:
      throw new Error(`[callLLM] Unknown provider: ${provider}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. delegateToSubAgents — spawn sub-cascades and await their completion
//    Uses CascadeController exclusively; no direct Redux access.
// ─────────────────────────────────────────────────────────────────────────────

interface DelegationCall {
  agentName: string;
  toolCall: NormalizedToolCall;
}

async function delegateToSubAgents(
  delegations: DelegationCall[],
  controller: CascadeController,
  userId: string,
  cascadeId: string,
  maxDepth: number
): Promise<Array<{ toolCall: NormalizedToolCall; toolResult: any }>> {
  const match = cascadeId.match(/^call(\d+)_/);
  const currentDepth = match ? parseInt(match[1]) : 0;

  if (currentDepth >= maxDepth) {
    console.warn(`[delegateToSubAgents] 🚫 Max depth ${maxDepth} reached at depth ${currentDepth}.`);
    return delegations.map(({ toolCall }) => ({
      toolCall,
      toolResult: { content: 'Forbidden: max delegation depth exceeded.' },
    }));
  }

  const childPrefix = `call${currentDepth + 1}`;
  const generateId  = () => `${childPrefix}_${uuidv4().replace(/-/g, '').slice(0, 12)}`;

  const resolved = delegations.map(({ agentName, toolCall }, idx) => ({
    agentName,
    toolCall,
    subtask:      toolCall.args.subtask as string,
    subcascadeId: generateId(),
    idx,
  }));

  // Filter out any cascades already in-flight or complete
  const toSpawn = resolved.filter(({ subcascadeId }) => {
    if (controller.exists(subcascadeId)) {
      devLog(`[delegateToSubAgents] ⏳/✅ ${subcascadeId} already exists, skipping`);
      return false;
    }
    return true;
  });

  if (toSpawn.length > 0) {
    const spawnsMap: Record<string, SpawnContext> = {};

    for (const { agentName, subtask, subcascadeId } of toSpawn) {
      devLog(`[delegateToSubAgents] 🚀 ${agentName} ← "${subtask}" → ${subcascadeId}`);
      spawnsMap[agentName] = {
        cascadeId: subcascadeId,
        userId,
        history: [{ role: 'user', content: subtask } as CanonicalMessage],
      };
    }

    // controller.spawn dispatches all nodes AND awaits their completion internally
    await controller.spawn(spawnsMap);
  }

  // Read results — all cascades are complete at this point
  return resolved.map(({ toolCall, subcascadeId }) => {
    const cascadeState = controller.getCascadeState(subcascadeId);
    const lastMsg = (cascadeState?.history ?? [])
      .filter((m: any) => m.role === 'assistant' && !m.tool_calls?.length)
      .at(-1);

    return {
      toolCall,
      toolResult: { content: lastMsg?.content ?? 'Sub-agent returned no result' },
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Node builders — streaming path
// ─────────────────────────────────────────────────────────────────────────────

function buildAgentNodePrep(provider: LLMProvider) {
  return async function agentNodePrep(
    context: WorkflowContext,
    initialContext: any
  ) {
    const { cascadeId, userId } = initialContext;
    const dataArray = context[cascadeId];
    const canonical: CanonicalMessage[] = dataArray.flatMap((item: any) => item.history || []);
    const history = toProviderHistory(provider, canonical);
    return { history, cascadeId, userId };
  };
}

function buildAgentNodeExec(
  provider: LLMProvider,
  model: string,
  systemPrompt: string,
  nativeTools: any
) {
  return async function agentNodeExec(prepOutput: any) {
    const { history } = prepOutput;
    const result = await callLLM(provider, model, systemPrompt, history, nativeTools, true);
    if (!('stream' in result)) {
      throw new Error('[agentNodeExec] Expected streaming result');
    }
    return { stream: result.stream, provider: result.provider };
  };
}

function buildAgentNodePost(
  agentNodeName: string,
  toolNodeName: string,
  provider: LLMProvider
) {
  return async function agentNodePost(execOutput: any) {
    const { assistantMessage, cascadeId , userId } = execOutput;

    const canonical  = assistantMessage.canonical ?? assistantMessage;
    const uiMessage  = assistantMessage.uiMessage;
    

    const pendingToolCalls = extractToolCalls(provider, canonical);

    const isDifferent = uiMessage !== undefined &&
      JSON.stringify(canonical) !== JSON.stringify(uiMessage);

    return {
      updates: {
        [cascadeId]: {
          history:    [canonical],
          status:     pendingToolCalls.length > 0 ? 'calling_tool' : 'complete',
          lastUpdate: Date.now(),
        },
      } as Updates,
      ...(isDifferent ? {
        uiUpdates: {
          [cascadeId]: { history: [uiMessage], status: pendingToolCalls.length> 0? 'calling_tool' : 'complete' },
        },
      } : {}),
      spawns: pendingToolCalls.length > 0
        ? {
            [toolNodeName]: {
              history:            [canonical],
              toolCallsToExecute: pendingToolCalls,
              cascadeId,
              userId,
            } as SpawnContext,
          }
        : undefined,
    } satisfies PostResult;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Node builders — non-streaming path
// ─────────────────────────────────────────────────────────────────────────────

function buildAgentNodeExecNonStreaming(
  provider: LLMProvider,
  model: string,
  systemPrompt: string,
  nativeTools: any
) {
  return async function agentNodeExecNonStreaming(
    prepOutput: any
  ): Promise<NonStreamingExecOutput> {
    const { history, cascadeId, userId } = prepOutput;
    const result = await callLLM(provider, model, systemPrompt, history, nativeTools, false);

    if (!('response' in result)) {
      throw new Error('[agentNodeExecNonStreaming] Expected non-streaming response');
    }

    const assistantMessage = parseCompletedResponse(result.provider, result.response);
    return { assistantMessage, cascadeId, userId };
  };
}

function buildAgentNodePostNonStreaming(
  agentNodeName: string,
  toolNodeName: string,
  provider: LLMProvider
) {
  return async function agentNodePostNonStreaming(
    execOutput: NonStreamingExecOutput
  ): Promise<PostResult> {
    const { assistantMessage, cascadeId, userId } = execOutput;
    const pendingToolCalls = extractToolCalls(provider, assistantMessage);

    return {
      updates: {
        [cascadeId]: {
          history:    [assistantMessage],
          status:     pendingToolCalls.length > 0 ? 'calling_tool' : 'complete',
          lastUpdate: Date.now(),
        },
      } as Updates,
      spawns: pendingToolCalls.length > 0
        ? {
            [toolNodeName]: {
              history:            [assistantMessage],
              toolCallsToExecute: pendingToolCalls,
              cascadeId,
              userId,
            } as SpawnContext,
          }
        : undefined,
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Tool node builders — shared between streaming and non-streaming agent nodes
// ─────────────────────────────────────────────────────────────────────────────

function buildToolNodePrep(toolNodeName: string) {
  return async function toolNodePrep(
    _context: WorkflowContext,
    initialContext: any
  ) {
    const { toolCallsToExecute, cascadeId, userId } = initialContext;
    if (!Object.prototype.hasOwnProperty.call(initialContext, 'toolCallsToExecute')) {
      throw new Error(`${toolNodeName}Prep: toolCallsToExecute not provided in context.`);
    }
    return { toolCallsToExecute: toolCallsToExecute ?? [], cascadeId, userId };
  };
}

function buildToolNodeExec(
  executeMap: Record<string, ToolDefinition['execute']>,
  selfDelegationName: string | null,
  subAgentToolNames: Set<string>,
  agentNodeName: string,
  maxDepth: number,
  provider: LLMProvider
) {
  return async function toolNodeExec(
    prepOutput: any,
    controller: CascadeController
  ) {
    const { toolCallsToExecute, cascadeId, userId } = prepOutput;

    // Partition into three buckets
    const regularCalls:  NormalizedToolCall[] = [];
    const selfCalls:     NormalizedToolCall[] = [];
    const subAgentCalls: NormalizedToolCall[] = [];

    for (const tc of toolCallsToExecute as NormalizedToolCall[]) {
      if (selfDelegationName && tc.name === selfDelegationName) {
        selfCalls.push(tc);
      } else if (subAgentToolNames.has(tc.name)) {
        subAgentCalls.push(tc);
      } else {
        regularCalls.push(tc);
      }
    }

    // ── Direct tool calls ────────────────────────────────────────────────────
    const regularResults = await Promise.all(
      regularCalls.map(async (toolCall) => {
        const executeFn = executeMap[toolCall.name];
        if (!executeFn) {
          return {
            toolCall,
            toolResult: buildErrorToolResultMessage(
              provider, toolCall, `Unknown tool: ${toolCall.name}`
            ),
          };
        }
        try {
          const rawResult = await executeFn(toolCall.args, controller);
          return { toolCall, toolResult: buildToolResultMessage(provider, toolCall, rawResult) };
        } catch (err: any) {
          return {
            toolCall,
            toolResult: buildErrorToolResultMessage(provider, toolCall, err.message),
          };
        }
      })
    );

    // ── Self-delegation (recursive variants) ─────────────────────────────────
    const selfResults = selfCalls.length > 0
      ? await delegateToSubAgents(
          selfCalls.map(tc => ({ agentName: agentNodeName, toolCall: tc })),
          controller,
          userId, cascadeId, maxDepth
        ).then(results => results.map(({ toolCall, toolResult }) => ({
          toolCall,
          toolResult: buildToolResultMessage(provider, toolCall, toolResult.content),
        })))
      : [];

    // ── Sub-agent delegation (supervisor variants) ────────────────────────────
    // Tool name encodes target: delegate_to_searchAgentNode → 'searchAgentNode'
    const subAgentResults = subAgentCalls.length > 0
      ? await delegateToSubAgents(
          subAgentCalls.map(tc => ({
            agentName: tc.name.replace(/^delegate_to_/, ''),
            toolCall:  tc,
          })),
          controller,
          userId, cascadeId, maxDepth
        ).then(results => results.map(({ toolCall, toolResult }) => ({
          toolCall,
          toolResult: buildToolResultMessage(provider, toolCall, toolResult.content),
        })))
      : [];

    return {
      results: [...regularResults, ...selfResults, ...subAgentResults],
      cascadeId,
    };
  };
}

function buildToolNodePost(agentNodeName: string) {
  return async function toolNodePost(execOutput: any): Promise<PostResult> {
    const { results, cascadeId } = execOutput;
    const toolResultsOnly = results.map((r: any) => r.toolResult);
    return {
      updates: {
        [cascadeId]: { history: toolResultsOnly, status: 'complete' },
      } as Updates,
      spawns: {
        [agentNodeName]: { history: toolResultsOnly, cascadeId } as SpawnContext,
      },
    };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. _createAgent — the single primitive everything delegates to
// ─────────────────────────────────────────────────────────────────────────────

function _createAgent(name: string, cfg: AgentFactoryConfig): ReactAgentBundle {
  const {
    provider, model, systemPrompt,
    tools, subAgents, selfDelegation, maxDepth,
    isStreaming, env,
  } = cfg;

  const agentNodeName = `${name}AgentNode`;
  const toolNodeName  = `${name}ToolNode`;

  // ── Assemble tool list ─────────────────────────────────────────────────────

  const directToolParams: ToolParam[] = tools.map(({ execute: _x, ...rest }) => rest);

  const subAgentToolParams: ToolParam[] = subAgents.map(sa => ({
    name:        `delegate_to_${sa.name}`,
    description: sa.description,
    parameters: {
      type: 'object' as const,
      properties: {
        subtask: {
          type: 'string',
          description: 'The specific self-contained task for this sub-agent to handle.',
        },
      },
      required: ['subtask'],
    },
  }));

  const selfDelegationParam: ToolParam | null = selfDelegation
    ? {
        name: `delegate_to_${name}`,
        description:
          `Spawns a parallel instance of ${name} to handle an independent subtask. ` +
          `Use when the task can be decomposed into concurrent independent threads.`,
        parameters: {
          type: 'object' as const,
          properties: {
            subtask: {
              type: 'string',
              description: 'The specific self-contained subtask for the parallel instance.',
            },
          },
          required: ['subtask'],
        },
      }
    : null;

  const allToolParams: ToolParam[] = [
    ...directToolParams,
    ...subAgentToolParams,
    ...(selfDelegationParam ? [selfDelegationParam] : []),
  ];

  const nativeTools = allToolParams.length > 0
    ? buildTools(provider, allToolParams)
    : [];

  const executeMap: Record<string, ToolDefinition['execute']> = Object.fromEntries(
    tools.map(t => [t.name, t.execute])
  );

  const subAgentToolNames  = new Set(subAgentToolParams.map(t => t.name));
  const selfDelegationName = selfDelegationParam?.name ?? null;

  // ── Wire agent node — branch on isStreaming ────────────────────────────────

  const agentNodePrep = buildAgentNodePrep(provider);

  const agentNode = isStreaming
    ? {
        prep: agentNodePrep,
        exec: buildAgentNodeExec(provider, model, systemPrompt, nativeTools),
        post: buildAgentNodePost(agentNodeName, toolNodeName, provider),
      }
    : {
        prep: agentNodePrep,
        exec: buildAgentNodeExecNonStreaming(provider, model, systemPrompt, nativeTools),
        post: buildAgentNodePostNonStreaming(agentNodeName, toolNodeName, provider),
      };

  // ── Wire tool node — always non-streaming ──────────────────────────────────

  const toolNode = {
    prep: buildToolNodePrep(toolNodeName),
    exec: buildToolNodeExec(
      executeMap,
      selfDelegationName,
      subAgentToolNames,
      agentNodeName,
      maxDepth,
      provider
    ),
    post: buildToolNodePost(agentNodeName),
  };

  return {
    agentNode,
    toolNode,
    nodes: {
      [agentNodeName]: {
        name:        agentNodeName,
        prep:        agentNode.prep,
        exec:        agentNode.exec,
        post:        agentNode.post,
        isStreaming,
        isUINode:    false,
        env,
      },
      [toolNodeName]: {
        name:        toolNodeName,
        prep:        toolNode.prep,
        exec:        toolNode.exec,
        post:        toolNode.post,
        isStreaming:  false,
        isUINode:    false,
        env,
      },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Public exports
// ─────────────────────────────────────────────────────────────────────────────

/** Standard ReAct loop. No delegation. */
export function createReactAgent(
  name: string,
  config: ReactAgentConfig
): ReactAgentBundle {
  return _createAgent(name, {
    provider:       config.provider,
    model:          config.model,
    systemPrompt:   config.systemPrompt,
    tools:          config.tools ?? [],
    subAgents:      [],
    selfDelegation: false,
    maxDepth:       0,
    isStreaming:    config.isStreaming ?? true,
    env:            config.env ?? 'server',
  });
}

/** ReAct agent that can spawn parallel instances of itself. */
export function createRecursiveReactAgent(
  name: string,
  config: RecursiveReactAgentConfig
): ReactAgentBundle {
  return _createAgent(name, {
    provider:       config.provider,
    model:          config.model,
    systemPrompt:   config.systemPrompt,
    tools:          config.tools ?? [],
    subAgents:      [],
    selfDelegation: true,
    maxDepth:       config.maxDepth ?? 2,
    isStreaming:    config.isStreaming ?? true,
    env:            config.env ?? 'server',
  });
}

/** Delegates to named sub-agents. No self-delegation. */
export function createSupervisorAgent(
  name: string,
  config: SupervisorAgentConfig
): ReactAgentBundle {
  return _createAgent(name, {
    provider:       config.provider,
    model:          config.model,
    systemPrompt:   config.systemPrompt,
    tools:          config.tools ?? [],
    subAgents:      config.subAgents,
    selfDelegation: false,
    maxDepth:       1,
    isStreaming:    config.isStreaming ?? true,
    env:            config.env ?? 'server',
  });
}

/** Can spawn parallel instances of itself AND delegate to named sub-agents. */
export function createRecursiveSupervisorAgent(
  name: string,
  config: RecursiveSupervisorAgentConfig
): ReactAgentBundle {
  return _createAgent(name, {
    provider:       config.provider,
    model:          config.model,
    systemPrompt:   config.systemPrompt,
    tools:          config.tools ?? [],
    subAgents:      config.subAgents,
    selfDelegation: true,
    maxDepth:       config.maxDepth ?? 2,
    isStreaming:    config.isStreaming ?? true,
    env:            config.env ?? 'server',
  });
}

// one off execution helper for tools

export type ManualToolExecute = (args: Record<string, any>) => Promise<unknown>;
export type ManualToolExecuteMap = Record<string, ManualToolExecute>;



export async function executeToolCalls(
  calls: CanonicalToolCall[],
  executeMap: ManualToolExecuteMap,
  provider: LLMProvider,
): Promise<{ toolCall:CanonicalToolCall; toolResult: CanonicalMessage }[]> {
  return Promise.all(
    calls.map(async (toolCall) => {
      const executeFn = executeMap[toolCall.name];

      if (!executeFn) {
        return {
          toolCall,
          toolResult: buildErrorToolResultMessage(provider, toolCall, `Unknown tool: ${toolCall.name}`),
        };
      }

      try {
        const rawResult = await executeFn(toolCall.args);
        console.log(JSON.stringify(rawResult), "raw results after executng one off");
        return {
          toolCall,
          toolResult: buildToolResultMessage(provider, toolCall, rawResult),
        };
      } catch (err: any) {
        return {
          toolCall,
          toolResult: buildErrorToolResultMessage(provider, toolCall, err.message),
        };
      }
    })
  );
}