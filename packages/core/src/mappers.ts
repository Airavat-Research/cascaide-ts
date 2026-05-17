/**
 * mappers.ts
 *
 * Every mapper emits the same canonical identity names regardless of provider:
 *
 *   identity: 'role'       — 'assistant' | 'model', silent, written once
 *   identity: 'content'    — string, streamed as delta
 *   identity: 'thinking'   — string, streamed as delta
 *   identity: 'tool_calls' — CanonicalToolCall[], buffered, sent once complete
 *   identity: 'extensions' — provider-specific data, buffered, silent
 *
 * The assembled assistantMessage is always a CanonicalMessage.
 * handleProviderStream and the reducer are unchanged.
 *
 * toProviderHistory() in llmProviderAdapter.ts is the reverse transform —
 * it reconstructs provider-native history from canonical + extensions.
 */

import type { ChunkMapper, ChunkDelta } from './types';

export interface CanonicalToolCall {
  id:   string;
  name: string;
  args: Record<string, any>; // always a parsed object, never a JSON string
}
// ─────────────────────────────────────────────────────────────────────────────
// Anthropic
//
// Raw assembled shape (before this change):
//   { role, content: Block[] }
//   where Block = { type: 'text'|'thinking'|'tool_use', ... }
//
// Canonical assembled shape (after):
//   { role: 'assistant', content: string, thinking: string,
//     tool_calls: CanonicalToolCall[],
//     extensions: { anthropic: { signature } } }
// ─────────────────────────────────────────────────────────────────────────────

export const anthropicMapper = (): ChunkMapper => {
  let roleEmitted = false;

  return (chunk): ChunkDelta | ChunkDelta[] | null => {

    // ── content_block_start ───────────────────────────────────────────────────
    if (chunk.type === 'content_block_start') {

      const roleDelta = (): ChunkDelta => {
        roleEmitted = true;
        return { identity: 'role', value: 'assistant', silent: true };
      };

      if (chunk.content_block?.type === 'thinking') {
        return [
          ...(!roleEmitted ? [roleDelta()] : []),
          // thinking streams as a plain string delta
          { identity: 'thinking', value: '' },
        ];
      }

      if (chunk.content_block?.type === 'text') {
        return [
          ...(!roleEmitted ? [roleDelta()] : []),
          // content streams as a plain string delta
          { identity: 'content', value: '' },
        ];
      }

      if (chunk.content_block?.type === 'tool_use') {
        // tool_calls buffered — we accumulate the full array before sending
        return [
          ...(!roleEmitted ? [roleDelta()] : []),
          {
            identity: 'tool_calls',
            value:    [],
            buffer:   true,
            accumulate: (current: CanonicalToolCall[] = [], _incoming: any) => {
              current.push({
                id:   chunk.content_block.id,
                name: chunk.content_block.name,
                args: {},  // filled in on input_json_delta / content_block_stop
              });
              return current;
            },
          },
        ];
      }
    }

    // ── content_block_delta ───────────────────────────────────────────────────
    if (chunk.type === 'content_block_delta') {

      if (chunk.delta?.type === 'text_delta') {
        return { identity: 'content', value: chunk.delta.text };
      }

      if (chunk.delta?.type === 'thinking_delta') {
        return { identity: 'thinking', value: chunk.delta.thinking };
      }

      if (chunk.delta?.type === 'signature_delta') {
        // signature is Anthropic-specific → goes into extensions, buffered, silent
        return {
          identity: 'extensions',
          value:    null,
          buffer:   true,
          silent:   true,
          accumulate: (current: any = {}, _incoming: any) => ({
            ...current,
            anthropic: {
              ...(current.anthropic ?? {}),
              signature: chunk.delta.signature,
            },
          }),
        };
      }

      if (chunk.delta?.type === 'input_json_delta') {
        // accumulate raw JSON string onto the last tool_call's args string
        return {
          identity: 'tool_calls',
          value:    chunk.delta.partial_json,
          buffer:   true,
          accumulate: (current: any[] = [], incoming: string) => {
            const last = current[current.length - 1];
            if (last) {
              // store as string temporarily; parsed at content_block_stop
              last._rawArgs = (last._rawArgs ?? '') + incoming;
            }
            return current;
          },
        };
      }
    }

    // ── content_block_stop ────────────────────────────────────────────────────
    if (chunk.type === 'content_block_stop') {
      // parse accumulated JSON args string → object
      return {
        identity: 'tool_calls',
        value:    null,
        buffer:   true,
        accumulate: (current: any[] = [], _incoming: any) => {
          const last = current[current.length - 1];
          if (last && last._rawArgs !== undefined) {
            try {
              last.args = JSON.parse(last._rawArgs || '{}');
            } catch {
              last.args = {};
            }
            delete last._rawArgs;
          }
          return current;
        },
      };
    }

    return null;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Chat Completions
//
// Raw assembled shape (before):
//   { role, content: string, reasoning_content: string,
//     tool_calls: [{ id, type, function: { name, arguments } }] }
//
// Canonical assembled shape (after):
//   { role: 'assistant', content: string, thinking: string,
//     tool_calls: CanonicalToolCall[] }
//
// No provider-specific extensions needed — OpenAI Chat shape is the simplest.
// ─────────────────────────────────────────────────────────────────────────────

export const openaiChatMapper = (): ChunkMapper => {
  let roleEmitted = false;

  return (chunk): ChunkDelta | ChunkDelta[] | null => {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return null;

    const deltas: ChunkDelta[] = [];

    if (!roleEmitted) {
      roleEmitted = true;
      deltas.push({ identity: 'role', value: 'assistant', silent: true });
    }

    // reasoning_content (o3, o4-mini) → canonical thinking
    if (delta.reasoning_content) {
      deltas.push({ identity: 'thinking', value: delta.reasoning_content });
    }

    if (delta.content) {
      deltas.push({ identity: 'content', value: delta.content });
    }

    if (delta.tool_calls) {
      const tc    = delta.tool_calls[0];
      const idx   = tc.index ?? 0;
      deltas.push({
        identity: 'tool_calls',
        value:    tc,
        buffer:   true,
        accumulate: (current: CanonicalToolCall[] = [], incoming: any) => {
          if (!current[idx]) {
            current[idx] = { id: '', name: '', args: {} };
          }
          if (incoming.id)                    current[idx].id    = incoming.id;
          if (incoming.function?.name)         current[idx].name += incoming.function.name;
          if (incoming.function?.arguments) {
            // accumulate JSON string, parse when stream ends
            (current[idx] as any)._rawArgs =
              ((current[idx] as any)._rawArgs ?? '') + incoming.function.arguments;
          }
          return current;
        },
      });
    }

    // parse args on finish_reason === 'tool_calls'
    if (chunk.choices?.[0]?.finish_reason === 'tool_calls') {
      deltas.push({
        identity: 'tool_calls',
        value:    null,
        buffer:   true,
        accumulate: (current: any[] = [], _incoming: any) => {
          return current.map(tc => {
            if (tc._rawArgs !== undefined) {
              try { tc.args = JSON.parse(tc._rawArgs || '{}'); }
              catch { tc.args = {}; }
              delete tc._rawArgs;
            }
            return tc;
          });
        },
      });
    }

    return deltas.length === 0 ? null : deltas.length === 1 ? deltas[0] : deltas;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Gemini (google/genai generateContentStream)
//
// Raw assembled shape (before):
//   { role: 'model', parts: Part[] }
//   where Part = { text } | { thought: true, text, thoughtSignature } | { functionCall }
//
// Canonical assembled shape (after):
//   { role: 'assistant', content: string, thinking: string,
//     tool_calls: CanonicalToolCall[],
//     extensions: { gemini: { thoughtSignature, parts } } }
//
// extensions.gemini.parts preserved for faithful Gemini replay.
// extensions.gemini.thoughtSignature preserved — no cross-provider equivalent.
// ─────────────────────────────────────────────────────────────────────────────

export const geminiGenaiMapper = (): ChunkMapper => {
  let roleEmitted = false;
  // keep the native parts array for extensions — needed for exact replay
  const nativeParts: any[] = [];

  return (chunk): ChunkDelta | ChunkDelta[] | null => {
    const chunkParts: any[] = chunk.candidates?.[0]?.content?.parts ?? [];
    if (!chunkParts.length) return null;

    const deltas: ChunkDelta[] = [];

    if (!roleEmitted) {
      roleEmitted = true;
      deltas.push({ identity: 'role', value: 'assistant', silent: true });
    }

    for (const part of chunkParts) {

      // ── Thinking part ───────────────────────────────────────────────────────
      if (part.thought === true && part.text) {
        // update native parts
        const existing = nativeParts.find(p => p.thought === true);
        if (existing) {
          existing.text += part.text;
          if (part.thoughtSignature) existing.thoughtSignature = part.thoughtSignature;
        } else {
          nativeParts.push({ ...part });
        }

        // canonical: stream thinking as plain string
        deltas.push({ identity: 'thinking', value: part.text });

        // extensions: keep thoughtSignature if present
        if (part.thoughtSignature) {
          deltas.push({
            identity: 'extensions',
            value:    null,
            buffer:   true,
            silent:   true,
            accumulate: (current: any = {}, _: any) => ({
              ...current,
              gemini: {
                ...(current.gemini ?? {}),
                thoughtSignature: part.thoughtSignature,
                parts: [...nativeParts],
              },
            }),
          });
        }
      }

      // ── Text part ───────────────────────────────────────────────────────────
      else if (part.text && part.thought !== true) {
        const existing = nativeParts.find(
          p => p.text !== undefined && !p.thought && !p.functionCall
        );
        if (existing) existing.text += part.text;
        else nativeParts.push({ text: part.text });

        // canonical: stream content as plain string
        deltas.push({ identity: 'content', value: part.text });

        // keep native parts in extensions for replay
        deltas.push({
          identity: 'extensions',
          value:    null,
          buffer:   true,
          silent:   true,
          accumulate: (current: any = {}, _: any) => ({
            ...current,
            gemini: { ...(current.gemini ?? {}), parts: [...nativeParts] },
          }),
        });
      }

      // ── Function call part ──────────────────────────────────────────────────
      else if (part.functionCall) {
        nativeParts.push({ ...part });

        // canonical tool_calls
        deltas.push({
          identity: 'tool_calls',
          value:    null,
          buffer:   true,
          accumulate: (current: CanonicalToolCall[] = [], _: any) => {
            // rebuild from nativeParts each time to stay in sync
            return nativeParts
              .filter(p => p.functionCall)
              .map(p => ({
                id:   p.functionCall.id ?? p.functionCall.name,
                name: p.functionCall.name,
                args: p.functionCall.args ?? {},
              }));
          },
        });

        // extensions: preserve native parts for replay
        deltas.push({
          identity: 'extensions',
          value:    null,
          buffer:   true,
          silent:   true,
          accumulate: (current: any = {}, _: any) => ({
            ...current,
            gemini: { ...(current.gemini ?? {}), parts: [...nativeParts] },
          }),
        });
      }
    }

    return deltas.length === 0 ? null : deltas.length === 1 ? deltas[0] : deltas;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Responses API
//
// Raw assembled shape (before):
//   { output: Item[] }
//   where Item = reasoning | message | function_call item objects
//
// Canonical assembled shape (after):
//   { role: 'assistant', content: string, thinking: string,
//     tool_calls: CanonicalToolCall[],
//     extensions: { openai_responses: { output } } }
//
// extensions.openai_responses.output preserved for faithful Responses API replay.
// ─────────────────────────────────────────────────────────────────────────────

export const openaiResponsesMapper = (): ChunkMapper => {
  const items: any[] = [];

  return (chunk): ChunkDelta | ChunkDelta[] | null => {

    // ── Item added ────────────────────────────────────────────────────────────
    if (chunk.type === 'response.output_item.added') {
      const item = chunk.item;
      if (!item) return null;

      if (item.type === 'reasoning') {
        items.push({
          id: item.id, type: 'reasoning',
          summary: [{ type: 'summary_text', text: '' }],
        });
        return extensionsDelta('openai_responses', items);
      }

      if (item.type === 'message') {
        items.push({
          id: item.id, type: 'message',
          role: 'assistant', content: [{ type: 'output_text', text: '' }],
        });
        return [
          { identity: 'role', value: 'assistant', silent: true },
          extensionsDelta('openai_responses', items),
        ];
      }

      if (item.type === 'function_call') {
        items.push({
          id: item.id, type: 'function_call',
          call_id: item.call_id, name: item.name, arguments: '',
        });
        return extensionsDelta('openai_responses', items);
      }
    }

    // ── Reasoning delta → canonical thinking ──────────────────────────────────
    if (chunk.type === 'response.reasoning_summary_text.delta') {
      const item = items.find(i => i.id === chunk.item_id && i.type === 'reasoning');
      if (item) item.summary[0].text += chunk.delta;
      return [
        extensionsDelta('openai_responses', items),
        { identity: 'thinking', value: chunk.delta },
      ];
    }

    // ── Message text delta → canonical content ────────────────────────────────
    if (chunk.type === 'response.output_text.delta') {
      const item = items.find(i => i.id === chunk.item_id && i.type === 'message');
      if (item) item.content[0].text += chunk.delta;
      return [
        extensionsDelta('openai_responses', items),
        { identity: 'content', value: chunk.delta },
      ];
    }

    // ── Function call argument delta ──────────────────────────────────────────
    if (chunk.type === 'response.function_call_arguments.delta') {
      const item = items.find(i => i.id === chunk.item_id && i.type === 'function_call');
      if (item) item.arguments += chunk.delta;
      return extensionsDelta('openai_responses', items);
    }

    // ── Function call done → canonical tool_calls ─────────────────────────────
    if (chunk.type === 'response.function_call_arguments.done') {
      const item = items.find(i => i.id === chunk.item_id && i.type === 'function_call');
      if (item) item.arguments = chunk.arguments ?? '{}';

      const toolCalls: CanonicalToolCall[] = items
        .filter(i => i.type === 'function_call')
        .map(i => ({
          id:   i.call_id,
          name: i.name,
          args: (() => {
            try { return JSON.parse(i.arguments || '{}'); }
            catch { return {}; }
          })(),
        }));

      return [
        extensionsDelta('openai_responses', items),
        {
          identity: 'tool_calls',
          value:    toolCalls,
          buffer:   true,
          accumulate: (_current: any, incoming: any) => incoming, // replace wholesale
        },
      ];
    }

    return null;
  };
};

// ── Helper: emit the full items array into extensions silently ────────────────
function extensionsDelta(providerKey: string, items: any[]): ChunkDelta {
  return {
    identity: 'extensions',
    value:    null,
    buffer:   true,
    silent:   true,
    accumulate: (current: any = {}, _: any) => ({
      ...current,
      [providerKey]: { output: [...items] },
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

export const mappers: Record<string, ChunkMapper | (() => ChunkMapper)> = {
  'anthropic':        anthropicMapper,
  'openai':           openaiChatMapper,
  'gemini-genai':     geminiGenaiMapper,
  'openai-responses': openaiResponsesMapper,
};