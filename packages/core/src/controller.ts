import { ServerListenerApi, CascadeController } from './types';
import { updateContext, addActiveNode, forkAndHydrate } from './workflowSlice';
import { makeSelectCascadeNodes, makeSelectCascadeState } from './workflowSelectors';
import { v7 as uuidv7 } from 'uuid';

import { Updates, Spawns } from './types';

export function createCascadeController(listenerApi: ServerListenerApi): CascadeController {
  return {
    updateContext: async (updates : Updates) => {                                
      await listenerApi.dispatch(updateContext(updates));
    },

    spawn: async (spawns : Spawns) => {
      const cascadeIds: string[] = [];

      for (const [nodeName, spawnContext] of Object.entries(spawns)) {  
        const nodeId = `${nodeName}_${uuidv7()}`;
        await listenerApi.dispatch(
          addActiveNode(
            { nodeId, nodeName, contextData: spawnContext },
            {  cascadeId: spawnContext.cascadeId, userId: spawnContext.userId, functionId: 0 }
          )
        );
        if (spawnContext.cascadeId) cascadeIds.push(spawnContext.cascadeId);
      }

      if (cascadeIds.length === 0) return;

      await listenerApi.condition((_action, state) =>
        cascadeIds.every(id => {
          const nodes = makeSelectCascadeNodes()(state, id);
          const cascadeState = makeSelectCascadeState()(state, id);
          return nodes.length === 0 && cascadeState !== undefined;
        })
      );
    },

    fork: async (newCascadeId, upToFunctionId, sourceCascadeId) => {
      try {
        await listenerApi.dispatch(
          forkAndHydrate({ sourceCascadeId: sourceCascadeId!, newCascadeId, upToFunctionId })
        );
        return { status: 'SUCCESS' };
      } catch {
        return { status: 'FAILED' };
      }
    },

    waitUntil: async (predicate) => {
      await listenerApi.condition((_action, state) => predicate(state));
    },

    // ── Read ──────────────────────────────────────────────────────────────────
    getCascadeState: (cascadeId) => {
      return makeSelectCascadeState()(listenerApi.getState(), cascadeId);
    },

    getCascadeNodes: (cascadeId) => {
      return makeSelectCascadeNodes()(listenerApi.getState(), cascadeId);
    },

    isComplete: (cascadeId) => {
      const state = listenerApi.getState();
      return (
        makeSelectCascadeNodes()(state, cascadeId).length === 0 &&
        makeSelectCascadeState()(state, cascadeId) !== undefined
      );
    },

    exists: (cascadeId) => {
      const state = listenerApi.getState();
      return (
        makeSelectCascadeState()(state, cascadeId) !== undefined ||
        makeSelectCascadeNodes()(state, cascadeId).length > 0
      );
    },
    getState: () => {
      return listenerApi.getState();
    }
  };
}