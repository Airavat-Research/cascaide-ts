/**
 * llm/llmProviderAdapter.ts
 *
 * Two responsibilities:
 *
 * A) Build/extract provider-native tool definitions and results:
 *    - buildTools
 *    - extractToolCalls        ← reads from CanonicalMessage.tool_calls
 *    - buildToolResultMessage  ← writes a CanonicalMessage (tool role)
 *    - buildErrorToolResultMessage
 *
 * B) Translate canonical history ↔ provider-native history:
 *    - toProviderHistory       ← called in prep() before LLM call
 *
 * The canonical message shape is the single format stored in cascade state.
 * Mappers assemble it. prep() translates it out. post() writes it back.
 * No provider-native shapes ever touch cascade state.
 */

import type { FunctionDeclaration, Tool as GeminiTool } from '@google/genai';
import { Type } from '@google/genai';
import type OpenAI from 'openai';
import type Anthropic from '@anthropic-ai/sdk';

import type {
  CanonicalMessage,
  CanonicalToolCall,
  CanonicalToolResult,
  ToolParam,
  LLMProvider,
} from './types';

export type {
  CanonicalMessage,
  CanonicalToolCall,
  CanonicalToolResult,
  ToolParam,
  LLMProvider,
};
export type { NormalizedToolCall } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// 1. buildTools — ToolParam[] → provider-native tool definition format
// ─────────────────────────────────────────────────────────────────────────────

export function buildTools(provider: LLMProvider, tools: ToolParam[]): any {
  switch (provider) {

    case 'anthropic':
      return tools.map((t): Anthropic.Tool => ({
        name:         t.name,
        description:  t.description,
        input_schema: {
          type:       'object' as const,
          properties: t.parameters.properties,
          required:   t.parameters.required,
        },
      }));

    case 'openai-responses':
      return tools.map((t): OpenAI.Responses.Tool => ({
        type:        'function',
        name:        t.name,
        description: t.description,
        parameters:  t.parameters,
        strict:      false,
      }));

    case 'openai':
      return tools.map(t => ({
        type: 'function',
        function: {
          name:        t.name,
          description: t.description,
          parameters:  t.parameters,
        },
      }));

      case 'gemini-genai': {
        const toGeminiType = (jsType: string): Type => {
          switch (jsType) {
            case 'string':  return Type.STRING;
            case 'number':  return Type.NUMBER;
            case 'boolean': return Type.BOOLEAN;
            case 'array':   return Type.ARRAY;
            case 'object':  return Type.OBJECT;
            default:        return Type.STRING;
          }
        };
      
        const toGeminiSchema = (v: any): any => {
          const geminiType = toGeminiType(v.type);
          const schema: any = { type: geminiType };
      
          if (v.description) schema.description = v.description;
      
          if (geminiType === Type.ARRAY) {
            schema.items = v.items ? toGeminiSchema(v.items) : { type: Type.STRING };
          }
      
          if (geminiType === Type.OBJECT && v.properties) {
            schema.properties = Object.fromEntries(
              Object.entries(v.properties).map(([k, val]) => [k, toGeminiSchema(val)])
            );
            if (v.required) schema.required = v.required;
          }
      
          return schema;
        };
      
        const functionDeclarations: FunctionDeclaration[] = tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: {
            type: Type.OBJECT,
            properties: Object.fromEntries(
              Object.entries(t.parameters.properties).map(([k, v]) => [k, toGeminiSchema(v)])
            ),
            required: t.parameters.required,
          },
        }));
      
        return [{ functionDeclarations }] satisfies GeminiTool[];
      }

    default:
      throw new Error(`[buildTools] Unknown provider: ${provider}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. extractToolCalls — reads from canonical assistant message
//    No longer needs to know the provider — tool_calls is always canonical.
// ─────────────────────────────────────────────────────────────────────────────

export function extractToolCalls(
  _provider: LLMProvider,
  assistantMessage: CanonicalMessage
): CanonicalToolCall[] {
  return assistantMessage.tool_calls ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. buildToolResultMessage — writes a canonical tool message
//    toProviderHistory translates it to provider-native when needed.
// ─────────────────────────────────────────────────────────────────────────────

export function buildToolResultMessage(
  _provider: LLMProvider,
  toolCall: CanonicalToolCall,
  resultData: any
): CanonicalMessage {
  return {
    role: 'tool',
    tool_result: {
      tool_call_id: toolCall.id,
      name:         toolCall.name,
      content:      typeof resultData === 'string'
        ? resultData
        : JSON.stringify(resultData),
    },
  };
}

export function buildErrorToolResultMessage(
  provider: LLMProvider,
  toolCall: CanonicalToolCall,
  errorMessage: string
): CanonicalMessage {
  return buildToolResultMessage(provider, toolCall, { error: errorMessage });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. toProviderHistory — canonical[] → provider-native history array
//
// Called in prep() before passing history to the LLM API.
// Each provider gets what it expects, reconstructed faithfully from canonical
// plus any relevant extensions.{provider} data.
// ─────────────────────────────────────────────────────────────────────────────

export function toProviderHistory(
  provider: LLMProvider,
  history: CanonicalMessage[]
): any[] {
  switch (provider) {
    case 'anthropic':        return history.flatMap(toAnthropicMessage);
    case 'openai-responses': return history.flatMap(toOpenAIResponsesMessage);
    case 'openai':           return history.flatMap(toOpenAIChatMessage);
    case 'gemini-genai':     return history.flatMap(toGeminiMessage);
    default:
      throw new Error(`[toProviderHistory] Unknown provider: ${provider}`);
  }
}

// ── Anthropic ─────────────────────────────────────────────────────────────────
// Native shape: { role, content: Block[] }
// thinking block requires signature from extensions if present

function toAnthropicMessage(msg: CanonicalMessage): any[] {
  const ext = msg.extensions?.anthropic ?? {};

  if (msg.role === 'user') {
    if (!msg.tool_result) {
      return [{ role: 'user', content: msg.content ?? '' }];
    }
    return [{
      role:    'user',
      content: [{
        type:        'tool_result',
        tool_use_id: msg.tool_result.tool_call_id,
        content:     msg.tool_result.content,
      }],
    }];
  }

  if (msg.role === 'tool') {
    return [{
      role:    'user',
      content: [{
        type:        'tool_result',
        tool_use_id: msg.tool_result!.tool_call_id,
        content:     msg.tool_result!.content,
      }],
    }];
  }

  // assistant message — reconstruct content block array
  const blocks: any[] = [];

  if (msg.thinking) {
    blocks.push({
      type:      'thinking',
      thinking:  msg.thinking,
      signature: ext.signature ?? '',
    });
  }

  if (msg.content) {
    blocks.push({ type: 'text', text: msg.content });
  }

  if (msg.tool_calls?.length) {
    for (const tc of msg.tool_calls) {
      blocks.push({
        type:  'tool_use',
        id:    tc.id,
        name:  tc.name,
        input: tc.args,
      });
    }
  }

  return [{ role: 'assistant', content: blocks }];
}

// ── OpenAI Responses API ──────────────────────────────────────────────────────
// Native shape: flat input[] items (not messages)
// extensions.openai_responses.output preserved for exact replay if available

function toOpenAIResponsesMessage(msg: CanonicalMessage): any[] {
  if (msg.role === 'user') {
    if (!msg.tool_result) {
      return [{ role: 'user', content: msg.content ?? '' }];
    }
    return [{
      type:    'function_call_output',
      call_id: msg.tool_result.tool_call_id,
      output:  msg.tool_result.content,
    }];
  }

  if (msg.role === 'tool') {
    return [{
      type:    'function_call_output',
      call_id: msg.tool_result!.tool_call_id,
      output:  msg.tool_result!.content,
    }];
  }

  // assistant — prefer extensions.openai_responses.output for exact replay
  const ext = msg.extensions?.openai_responses;
  if (ext?.output) return ext.output;

  const items: any[] = [];

  if (msg.thinking) {
    items.push({
      type:    'reasoning',
      summary: [{ type: 'summary_text', text: msg.thinking }],
    });
  }

  if (msg.content) {
    items.push({
      type:    'message',
      role:    'assistant',
      content: [{ type: 'output_text', text: msg.content }],
    });
  }

  if (msg.tool_calls?.length) {
    for (const tc of msg.tool_calls) {
      items.push({
        type:      'function_call',
        call_id:   tc.id,
        name:      tc.name,
        arguments: JSON.stringify(tc.args),
      });
    }
  }

  return items;
}

// ── OpenAI Chat Completions ───────────────────────────────────────────────────
// Native shape: { role, content, tool_calls, tool_call_id }

function toOpenAIChatMessage(msg: CanonicalMessage): any[] {
  if (msg.role === 'user') {
    if (!msg.tool_result) {
      return [{ role: 'user', content: msg.content ?? '' }];
    }
    return [{
      role:         'tool',
      tool_call_id: msg.tool_result.tool_call_id,
      content:      msg.tool_result.content,
    }];
  }

  if (msg.role === 'tool') {
    return [{
      role:         'tool',
      tool_call_id: msg.tool_result!.tool_call_id,
      content:      msg.tool_result!.content,
    }];
  }

  // assistant
  const out: any = { role: 'assistant', content: msg.content ?? null };

  if (msg.tool_calls?.length) {
    out.tool_calls = msg.tool_calls.map(tc => ({
      id:       tc.id,
      type:     'function',
      function: {
        name:      tc.name,
        arguments: JSON.stringify(tc.args),
      },
    }));
  }

  return [out];
}

// ── Gemini ────────────────────────────────────────────────────────────────────
// Native shape: { role: 'user'|'model', parts: Part[] }
// extensions.gemini.parts preserved for exact replay if available

function toGeminiMessage(msg: CanonicalMessage): any[] {
  if (msg.role === 'user') {
    if (!msg.tool_result) {
      return [{ role: 'user', parts: [{ text: msg.content ?? '' }] }];
    }
    return [{
      role:  'user',
      parts: [{
        functionResponse: {
          name:     msg.tool_result.name ?? msg.tool_result.tool_call_id,
          response: { result: msg.tool_result.content },
        },
      }],
    }];
  }

  if (msg.role === 'tool') {
    return [{
      role:  'user',
      parts: [{
        functionResponse: {
          name:     msg.tool_result!.name ?? msg.tool_result!.tool_call_id,
          response: { result: msg.tool_result!.content },
        },
      }],
    }];
  }

  // assistant (model) — prefer extensions.gemini.parts for exact replay
  const ext = msg.extensions?.gemini;
  if (ext?.parts) return [{ role: 'model', parts: ext.parts }];

  const parts: any[] = [];

  if (msg.thinking) {
    parts.push({
      thought:          true,
      text:             msg.thinking,
      thoughtSignature: ext?.thoughtSignature,
    });
  }

  if (msg.content) {
    parts.push({ text: msg.content });
  }

  if (msg.tool_calls?.length) {
    for (const tc of msg.tool_calls) {
      parts.push({
        functionCall: { id: tc.id, name: tc.name, args: tc.args },
      });
    }
  }

  return [{ role: 'model', parts }];
}