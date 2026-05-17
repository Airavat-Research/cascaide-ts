import { addActiveNode,  removeActiveNode, setError, updateContext } from '../workflowSlice';
import {ServerWorkflowGraph,  WorkflowContext, WorkflowState }from '../types';
import { Spawns } from '@cascaide-ts/core'
import { mappers } from '../mappers';
import { StreamConfig } from '@cascaide-ts/core';
import { ChunkMapper, StreamResult } from '@cascaide-ts/core';
import { v7 as uuidv7 } from 'uuid';
import { createCascadeController } from '../controller';

// Development mode check
const isDev = process.env.NODE_ENV === 'development';

const devLog = (...args: any[]) => {
  if (isDev) console.log(...args);
};

const devError = (...args: any[]) => {
  if (isDev) console.error(...args);
};

export interface StreamControl {
  send: (data: any) => Promise<void>;
  writeRaw: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

export function setupServerWorkflowListener(
  serverListener: any,
  config: {
    workflowGraph: ServerWorkflowGraph;
    maxExecutionTime: number;
    safeBuffer: number;
  },
  streamControl: StreamControl, // Aspect 1: Version 1's abstracted StreamControl
  counters: {
    chainDepth: { current: number };
  },
  startTime: number,
  isLite: boolean
) {
  const METADATA_DELIMITER = '\n__END_STREAM_METADATA__\n';
  const { writeRaw, close, send } = streamControl; // Aspect 1: destructure from abstraction

  serverListener.startListening({
    actionCreator: addActiveNode,
    effect: async (action: any, listenerApi: any) => {
      
      
      const { nodeId, nodeName, contextData } = action.payload;
      const { functionId = 0 } = action.meta ?? {};
      const nodeDefinition = config.workflowGraph[nodeName];
      const userId = contextData.userId;
      

      const controller = createCascadeController(listenerApi);

      devLog(`\n[Node ] 🚀 Starting: ${nodeName}`);
      const isSubCascade = contextData.cascadeId?.startsWith("call")

      // Aspect 2: Use Version 1's UI node handling (send typed ui_spawn, dispatch removeActiveNode, check activeNodes)
      if (!nodeDefinition || nodeDefinition.isUINode) {
        devLog(`[Node ] 🖥️ UI Node detected. Handing off to client listener.`);
         await send({ type: 'ui_spawn', nodeName, contextData });
        
         await listenerApi.dispatch(
          removeActiveNode(
            { 
              nodeId, 
              hasSpawns: false,
            },
            {
              origin:"server"
            }
          )
        );

         
         const currentState = listenerApi.getState();
         const activeNodes = currentState.workflow?.activeNodes || {};
         const activeNodeKeys = Object.keys(activeNodes);
       
         devLog(`[Server] Active node keys remaining:`, activeNodeKeys);
       
         // Check if the list is empty right now
         if (activeNodeKeys.length === 0) {
           devLog(`[Server] 🏁 State reached Zero. Closing stream. Triggered by completion of: ${nodeName}`);
           await close();
         }
        return;
      }
      
     ;

      try {
        if(functionId == 0) {
          const { cascadeId, userId, history, sentFromClient, ...remainingData } = contextData;

          await listenerApi.dispatch(
            updateContext({
              [contextData?.cascadeId]: { 
                ...remainingData,
                history: [...contextData?.history],
                status: 'completed'
              }, 
            },{
              origin: 'server',
            }) 
          );
          if(!contextData.sentFromClient) {
            await send({ type: 'sync', cascadeId: contextData.cascadeId, 
            
                history: [...contextData?.history],
                status: 'completed'
              
             });


          }
        }
        
        const mutableContextData = structuredClone(contextData);
        let prepOutput: any = {};
        
        if (nodeDefinition.prep) {
          const cascadeContext = (listenerApi.getState().workflow as WorkflowState).context as WorkflowContext;
          prepOutput = await nodeDefinition.prep(cascadeContext, mutableContextData);
        }
        
        const cascadeId = prepOutput.cascadeId || contextData.cascadeId;
        const currentFnId = action.meta?.functionId ?? 0;
        let postResult: any = null;
        
        if (nodeDefinition.isStreaming) {
          devLog(`[Node ] 🌊 Executing Streaming Node...`);
          
          const streamConfig = await nodeDefinition.exec(prepOutput, controller);
          
          const { canonical, uiMessage } = await handleProviderStream(
            streamConfig,
            cascadeId,
            send,
            isLite
          );
        
          postResult = await nodeDefinition.post({
            assistantMessage: canonical,
            uiAssistantMessage: uiMessage,
            cascadeId,
            history: structuredClone(prepOutput.history),
            userId: contextData.userId
          });
        } else {
          devLog(`[Node ] ⚡ Executing Standard Node...`);
          const execOutput = await nodeDefinition.exec(prepOutput, controller);
          postResult = await nodeDefinition.post(execOutput);

        }


        if (postResult) {
          const elapsed = Date.now() - startTime;
          const timeRemaining = config.maxExecutionTime - elapsed;
          const spawnNodes = postResult.spawns ? Object.keys(postResult.spawns) : [];

          if (spawnNodes.length) {
            if (timeRemaining > config.safeBuffer) {
              devLog(`[Node ] ✅ Internally Spawning: ${spawnNodes.join(', ')} (${Math.round(timeRemaining/1000)}s remaining)`);
              
              const fullOutput = postResult.updates[cascadeId];

              if (postResult.updates) {
                await listenerApi.dispatch(
                  updateContext(
                    postResult.updates,
                    {  
                      functionId: currentFnId, 
                      cascadeId,
                      uiUpdates: postResult.uiUpdates 
                    }
                  )
                );
    
                
                const latestNodeStateForUi = postResult.uiUpdates?.[cascadeId] ?? postResult.updates?.[cascadeId];
                if (latestNodeStateForUi && !nodeDefinition.isStreaming) {
                  devLog(`[Node ] 🔄 Syncing context chunk to client UI.`);
                  await send({ type: 'sync', cascadeId, ...latestNodeStateForUi });
                }
              }
              
              const spawnEntries = Object.entries(postResult.spawns as Spawns);
              const allSpawnsAreUI = spawnEntries.every(([name]) => 
                !config.workflowGraph[name] || config.workflowGraph[name].isUINode
              );

              if (allSpawnsAreUI) {
                // UI nodes will be handled via ui_spawn, just send postResult as metadata
                await writeRaw(METADATA_DELIMITER + JSON.stringify(postResult));
              } else {
                // Normal server spawn loop
                spawnEntries.forEach(async ([name, context], idx) => {
                  await listenerApi.dispatch(
                    addActiveNode(
                      {
                        nodeId: `${name}_${uuidv7()}_${idx}`,
                        nodeName: name,
                        parentTriggerId: nodeId,
                        contextData: (context?.userId)
                          ? context
                          : { ...context, userId },
                      },
                      {
                        functionId: currentFnId + 1 + idx,
                        cascadeId: context?.cascadeId,
                        userId: context?.userId || userId
                      }
                    )
                  );
                });
              }

              await listenerApi.dispatch(
                removeActiveNode(
                  { nodeId, hasSpawns: true, fullOutput },
                  { functionId: currentFnId, cascadeId }
                )
              );
            } else {
              devLog(`[Node ] ⏳ Time Buffer Reached. Handing off to client to checkpoint.`);
              
              const fullOutput = postResult.updates[cascadeId];

              if (postResult.updates) {
                await listenerApi.dispatch(
                  updateContext(
                    postResult.updates,
                    {  
                      functionId: currentFnId, 
                      cascadeId,
                      uiUpdates: postResult.uiUpdates // Aspect 5: Version 2
                    }
                  )
                );
            
                const latestNodeStateForUi = postResult.uiUpdates?.[cascadeId] ?? postResult.updates?.[cascadeId];
                if (latestNodeStateForUi && !nodeDefinition.isStreaming) {
                  devLog(`[Node ] 🔄 Syncing context chunk to client UI.`);
                  await send({ type: 'sync', cascadeId, ...latestNodeStateForUi });
                }
              }
              
              await listenerApi.dispatch(
                removeActiveNode(
                  { 
                    nodeId, 
                    hasSpawns: true,
                    fullOutput
                  },
                  { 
                    functionId: currentFnId,
                    cascadeId
                  }
                )
              );
               
              await writeRaw(METADATA_DELIMITER + JSON.stringify(postResult)); // Aspect 1: writeRaw
            }
          } else {
            devLog(`[Node ] 🏁 Chain Terminal. Dispatching completion.`);
            
            const fullOutput = postResult.updates[cascadeId];

            if (postResult.updates) {
              await listenerApi.dispatch(
                updateContext(
                  postResult.updates,
                  {  
                    functionId: currentFnId, 
                    cascadeId,
                    uiUpdates: postResult.uiUpdates // Aspect 5: Version 2
                  }
                )
              );
  
              
              // B) Sync to client UI (just send, don't dispatch)
              const latestNodeStateForUi = postResult.uiUpdates?.[cascadeId] ?? postResult.updates?.[cascadeId];
              if (latestNodeStateForUi && !nodeDefinition.isStreaming) {
                devLog(`[Node ] 🔄 Syncing context chunk to client UI.`);
                await send({ type: 'sync', cascadeId, ...latestNodeStateForUi });
              }
            }
            

            await listenerApi.dispatch(
              removeActiveNode(
                { 
                  nodeId, 
                  hasSpawns: false,
                  fullOutput
                },
                {
                  functionId: currentFnId,
                  cascadeId 
                }
              )
            );
            
            if(!isSubCascade){
              await writeRaw(METADATA_DELIMITER + JSON.stringify(postResult)); // Aspect 1: writeRaw
            }
          }
        }

      } catch (err: any) {
        devError(`[Node ] ❌ Execution Error:`, err.message);
        
        await listenerApi.dispatch(
          setError(
            { nodeId, error: err.message },
            {
              functionId: action.meta?.functionId,
              cascadeId: contextData?.cascadeId
            }
          )
        );

        await listenerApi.dispatch(
          removeActiveNode(
            { 
              nodeId, 
              hasSpawns: false,
              fullOutput: undefined
            },
            {
              functionId: action.meta?.functionId,
              cascadeId: contextData?.cascadeId,
              origin: 'server'
            }
          )
        );
        
        await writeRaw(METADATA_DELIMITER + JSON.stringify({ error: err.message })); // Aspect 1: writeRaw
        
      } finally {
        

        const currentState = listenerApi.getState();
        const activeNodes = currentState.workflow?.activeNodes || {};
        const activeNodeKeys = Object.keys(activeNodes);

        devLog(`[Server] Active node keys remaining:`, activeNodeKeys);

        // Aspect 2: Version 1's activeNodes state check to decide close
        if (activeNodeKeys.length === 0) {
          devLog(`[Server] 🏁 State reached Zero. Closing stream. Triggered by completion of: ${nodeName}`);
          await close(); // Aspect 1: close()
        }
      
      }
    },
  });
}


export async function handleProviderStream(
  config: StreamConfig,
  cascadeId: string,
  send: (data: any) => Promise<void>,
  isLite:boolean
): Promise<StreamResult> {
  const { stream, provider, mapper: customMapper, filter } = config;

  // ── Resolve mapper ────────────────────────────────────────────────────────
  const rawMapper = customMapper ?? mappers[provider];
  if (!rawMapper) throw new Error(
    `[handleProviderStream] No mapper found for provider "${provider}". ` +
    `Pass a custom mapper via StreamConfig.mapper, or use one of the ` +
    `built-in providers: ${Object.keys(mappers).join(', ')}.`
  );

  const mapper = typeof rawMapper === 'function' && rawMapper.length === 0
    ? (rawMapper as () => ChunkMapper)()
    : rawMapper as ChunkMapper;

  const shouldSuppressSend = cascadeId.startsWith('_');

  // ── Init ──────────────────────────────────────────────────────────────────
  if (!shouldSuppressSend) {
    await send({ type: 'init', cascadeId });
  }

  const canonical: Record<string, any> = {};

  const uiMessage: Record<string, any> = {};
  let filterWasApplied = false;

  const bufferedIdentities = new Set<string>();


  for await (const chunk of stream) {
    const result = mapper(chunk);
    if (!result) continue;

    const deltas = Array.isArray(result) ? result : [result];

    for (const delta of deltas) {
      const { identity, value, accumulate, buffer, silent } = delta;

      // ── Assemble canonical — always, unfiltered ───────────────────────────
      if (accumulate) {
        canonical[identity] = accumulate(canonical[identity], value);
      } else if (typeof canonical[identity] === 'string' && typeof value === 'string') {
        canonical[identity] += value;
      } else {
        canonical[identity] = value;
      }

      if (silent && (!isLite || identity === 'role')) {
        continue;
      }

      if (buffer) {
        bufferedIdentities.add(identity);
        continue;
      }

      if (!shouldSuppressSend) {
        const payloadValue = typeof value === 'string' ? value : canonical[identity];

        if (filter && !isLite) {
          const filtered = filter(identity, payloadValue);
          filterWasApplied = true;

          if (filtered !== false) {
           
            await send({ cascadeId, identity, value: filtered });

            // accumulate into uiMessage
            if (typeof filtered === 'string') {
              uiMessage[identity] = (uiMessage[identity] ?? '') + filtered;
            } else {
              uiMessage[identity] = filtered;
            }
          }
          // filtered === false → suppressed, nothing added to uiMessage
        } else {
         
          await send({ cascadeId, identity, value: payloadValue });
        }
      }
    }
  }

  // ── Flush buffered identities ─────────────────────────────────────────────
  if (!shouldSuppressSend) {
    for (const identity of bufferedIdentities) {
      if (canonical[identity] === undefined) continue;

      const payloadValue = canonical[identity];

      if (filter && !isLite) {
        const filtered = filter(identity, payloadValue);
        filterWasApplied = true;

        if (filtered !== false) {
          await send({ cascadeId, identity, value: filtered });
          uiMessage[identity] = filtered;
        }
        // suppressed → not in uiMessage
      } else {
        await send({ cascadeId, identity, value: payloadValue });
      }
    }
  }




  return {
    canonical,
    ...(filterWasApplied ? { uiMessage } : {}),
  };
}