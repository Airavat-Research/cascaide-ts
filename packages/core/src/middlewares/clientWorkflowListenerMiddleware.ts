import { createListenerMiddleware } from '@reduxjs/toolkit';
import { 
  addActiveNode, 
  removeActiveNode, 
  setError, 
  updateContext,  
} from  "../workflowSlice"
import { streamChunkReceived } from '../workflowSlice';
import { v7 as uuidv7 } from 'uuid';
import {  ClientWorkflowGraph } from "../types"

export const workflowListenerMiddleware = createListenerMiddleware();
const addWorkflowListener = workflowListenerMiddleware.startListening;

const METADATA_DELIMITER = '\n__END_STREAM_METADATA__\n';

export interface ClientWorkflowListenerConfig {
    workflowGraph: ClientWorkflowGraph;  
    actionRelayEndpoint: string;
    isLite:boolean;
  }

export const setupWorkflowListeners = (config: ClientWorkflowListenerConfig) => {
  addWorkflowListener({
    actionCreator: addActiveNode,
    effect: async (action, listenerApi) => {
      const { nodeId, nodeName, contextData } = action.payload;
      const {functionId} = action.meta;
      const nodeDefinition = config.workflowGraph[nodeName];
      const isLite = config.isLite;

      // ASPECT 1: version 2 — log unidentified node before returning
      if (!nodeDefinition || nodeDefinition.isUINode) {
        return;
      }

      // ASPECT 2: version 2 — destructure and spread remainingData
      if (contextData?.sentFromClient && !contextData?.handledTimeout)  {
        const { cascadeId, userId, history, sentFromClient, ...remainingData } = contextData;
    
        const historyPayload = isLite 
          ? (history?.slice(-1) ?? []) 
          : [...(history ?? [])];
    
        await listenerApi.dispatch(updateContext(
          {
            [cascadeId]: {
              ...remainingData,
              history: historyPayload,
              status: 'completed'
            },
          },
          {
            functionId: functionId,
            cascadeId: cascadeId,
          }
        ));
      }

      try {
        const response = await fetch(config.actionRelayEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: listenerApi.signal,
          body: JSON.stringify(action),
        });

        if (!response.ok || !response.body) {
          throw new Error(await response.text() || 'Action relay failed');
        }

        const cascadeId = contextData?.cascadeId;
        await handleStreamingResponse(response.body, cascadeId, nodeId, listenerApi, action, isLite);

      } catch (err: any) {
        if (err.name === 'AbortError') return;
        await listenerApi.dispatch(setError({ nodeId, error: err.message }));
        await listenerApi.dispatch(removeActiveNode({ nodeId, hasSpawns: false }));
      }
    },
  });
};

async function handleStreamingResponse(
    body: ReadableStream, 
    cascadeId: string, 
    nodeId: string, 
    listenerApi: any, 
    originalAction: any,
    isLite:boolean
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let inMetadataMode = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      if (!inMetadataMode) {
        const delimiterIndex = buffer.indexOf(METADATA_DELIMITER);
        if (delimiterIndex !== -1) {
          const streamPart = buffer.substring(0, delimiterIndex);
          const metadataPart = buffer.substring(delimiterIndex + METADATA_DELIMITER.length);
          await processStreamChunks(streamPart, cascadeId, listenerApi);
          
          if (metadataPart.trim()) {
            try {
                const metadata = JSON.parse(metadataPart.trim());
                await handleFinalMetadata(metadata, nodeId, listenerApi, originalAction, isLite);
            } catch (e) {
                console.error("Metadata parse error", e);
            }
          }
          inMetadataMode = true;
          break; 
        }
        buffer = await processStreamChunks(buffer, cascadeId, listenerApi);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function processStreamChunks(text: string, cascadeId: string, listenerApi: any): Promise<string> {
  const lines = text.split('\n');
  const remaining = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim() || line.startsWith(':')) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'init') {
        // ASPECT 3: version 1 — content and text commented out
        await listenerApi.dispatch(updateContext({
          [parsed.cascadeId]: {
            history: [{ 
              role: 'assistant', 
              //text: ""
              // content: '',
              // reasoning_content will be added by streamChunkReceived if reasoningChunk exists
            }],
            status: 'streaming'
          }
        }));
      } else if (parsed.type === 'sync') {
        // ASPECT 4: version 1 — history: parsed.history (no extra array wrap)
        await listenerApi.dispatch(updateContext({
          [parsed.cascadeId]: {
            history: parsed.history,
            status: 'completed'
          }
        }));
      } else if (parsed.type === 'ui_spawn') {
        // ASPECT 5: version 2 — handle ui_spawn by dispatching addActiveNode
        await listenerApi.dispatch(addActiveNode({
            nodeId: `${parsed.nodeName}_${uuidv7()}`,
            nodeName: parsed.nodeName,
            contextData: parsed.contextData,
        }));
      } else {
        await listenerApi.dispatch(streamChunkReceived({ 
          cascadeId: parsed.cascadeId,
          identity: parsed.identity,
          value: parsed.value,
        }));
      }
    } catch (e) { 
      console.error("Chunk parse error", e); 
    }
  }
  return remaining;
}

async function handleFinalMetadata(metadata: any, nodeId: string, listenerApi: any, originalAction: any, isLite: boolean) {
  const currentFnId = originalAction.meta?.functionId ?? 0;
  const origin = originalAction.meta?.origin ?? 'server';
  const cascadeId = originalAction.payload.contextData?.cascadeId;

  const getSelectedContext = (context: any) => {
    if (!isLite) return context;
    const listenerState = listenerApi.getState().workflow.context[cascadeId];
    const listenerStateKeys = Object.keys(listenerState || {});
    const filteredContext = Object.fromEntries(
      Object.entries(context || {}).filter(([key]) => !listenerStateKeys.includes(key))
    );
    const history = listenerState.flatMap((item: any) => item.history || []);
    return { ...filteredContext, history, sentFromClient:true, handledTimeout:true  };
  };
  
  // then inside forEach:

  const spawnEntries = metadata.spawns ? Object.entries(metadata.spawns) : [];
  const hasSpawns = spawnEntries.length > 0;
  if (hasSpawns) {
    spawnEntries.forEach(async ([name, context]: [string, any], idx: number) => {
      const selectedContext = getSelectedContext(context);

      await listenerApi.dispatch(
        addActiveNode(
          {
            nodeId: `${name}_${uuidv7()}_${idx}`,
            nodeName: name,
            parentTriggerId: nodeId,
            contextData: {
              ...selectedContext,
              cascadeId,
              userId: selectedContext?.userId || originalAction.payload.contextData?.userId,
            }
          },
          { 
            functionId: isLite ? 0 : (currentFnId + 1 + idx),
            // functionId:0,
            cascadeId,
            origin
          }
        )
      );
    });
  }
  
  await listenerApi.dispatch(
    removeActiveNode(
      { 
        nodeId, 
        hasSpawns,
        fullOutput: metadata.updates
      },
      {
        functionId: undefined,
        cascadeId,
        origin
      }
    )
  );
}

