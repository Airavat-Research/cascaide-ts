// core/middleware/clientPersistenceMiddleware.ts

import { Middleware } from '@reduxjs/toolkit';
import { addActiveNode, removeActiveNode, setError, updateContext } from '../workflowSlice';

export interface ClientPersistenceConfig {
  persistenceEndpoint: string; // e.g., '/api/workflow/persistence'
}

// Development mode check
const isDev = process.env.NODE_ENV === 'development';

// Retry helper with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 100
): Promise<T | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        if (isDev) console.error(`[CLIENT MW] ❌ All ${maxRetries} retry attempts failed:`, error);
        return null;
      }
      const delay = baseDelay * Math.pow(2, attempt - 1);
      if (isDev) console.warn(`[CLIENT MW] ⚠️ Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
}

export const createClientPersistenceMiddleware = (
  config: ClientPersistenceConfig
): Middleware => {
  return (store) => (next) => async (action: any) => {
    
    if (addActiveNode.match(action)) {

      const { origin, functionId, cascadeId } = action.meta;
      const { nodeId, nodeName, contextData } = action.payload;
 
      if (!cascadeId || origin) return next(action);

      const initialFunctionId = functionId ?? 0;

      const data = await retryWithBackoff(async () => {
        const response = await fetch(config.persistenceEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify({
            action: 'claim',
            nodeInstanceId: nodeId,
            cascadeId,
            userId: contextData.userId,
            nodeName,
            functionId: initialFunctionId,
            inputContext: contextData,
            location: 'client'
          }),
        });

        if (!response.ok) throw new Error(`Persistence sync failed: ${response.status}`);

        return await response.json();
      });

      if (!data) {
        if (isDev) console.error(`[CLIENT MW] ❌ Failed to claim node ${nodeId} after retries`);
        return; // Return nothing on failure
      }

      const actualFunctionId = data.functionId; 

      if (isDev) console.log(`[CLIENT MW] ✅ Node ${nodeId} bound to FnId: ${actualFunctionId}`);

      const claimedAction = {
        ...action,
        meta: { 
          ...action.meta, 
          origin: 'client', 
          functionId: actualFunctionId, 
          cascadeId 
        }
      };

      return next(claimedAction);
    }

    if (removeActiveNode.match(action)) {
      const { origin, functionId, cascadeId } = action.meta;
      const nodeId = typeof action.payload === 'string' ? action.payload : action.payload.nodeId;
      const hasSpawns = (action.payload as { hasSpawns?: boolean }).hasSpawns;
      const fullOutput = (action.payload as { fullOutput?: any }).fullOutput;

      const state = store.getState() as any;
      const node = state.workflow.activeNodes[nodeId];
      
      const finalCascadeId = cascadeId || node?.cascadeId;
      const finalFunctionId = functionId ?? node?.functionId ?? 0;

      if (!finalCascadeId || origin) return next(action);

      const output = fullOutput || state.workflow.context[finalCascadeId];
      
      const result = await retryWithBackoff(async () => {
        const response = await fetch(config.persistenceEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'finalize',
            nodeInstanceId: nodeId,
            cascadeId: finalCascadeId,
            fullOutput: output,
            hasSpawns
          }),
        });

        if (!response.ok) throw new Error(`Persistence sync failed: ${response.status}`);

        return await response.json();
      });

      if (!result) {
        if (isDev) console.error(`[CLIENT MW] ❌ Failed to finalize node ${nodeId} after retries`);
        return; // Return nothing on failure
      }

      return next({
        ...action,
        meta: { ...action.meta, origin: 'client', functionId: finalFunctionId, cascadeId: finalCascadeId }
      });
    }

    if (setError.match(action)) {
      const { origin, functionId, cascadeId } = action.meta;
      const { nodeId, error } = action.payload;
      const state = store.getState() as any;
      const node = state.workflow.activeNodes[nodeId];
      
      const finalCascadeId = cascadeId || node?.cascadeId;
      if (!finalCascadeId || origin) return next(action);

      const result = await retryWithBackoff(async () => {
        const response = await fetch(config.persistenceEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'error', nodeInstanceId: nodeId, cascadeId: finalCascadeId, error }),
        });

        if (!response.ok) throw new Error(`Persistence sync failed: ${response.status}`);

        return await response.json();
      });

      if (!result) {
        if (isDev) console.error(`[CLIENT MW] ❌ Failed to mark node ${nodeId} as failed after retries`);
        return; // Return nothing on failure
      }

      return next({ ...action, meta: { ...action.meta, origin: 'client', cascadeId: finalCascadeId } });
    }

    if (updateContext.match(action)) {
      const { origin, functionId, cascadeId, uiUpdates } = action.meta;
      const updates = action.payload;
      const finalCascadeId = cascadeId;
      const finalFunctionId = functionId ?? 0;

      if (!finalCascadeId || origin) return next(action);
      
      if (isDev) {
        console.log(`[CLIENT MW] 🔄 Persisting context:`, JSON.stringify(updates, null, 2));
      }

      // Skip streaming init
      if (updates[finalCascadeId]?.status === 'streaming') return next(action);

      const result = await retryWithBackoff(async () => {
        const response = await fetch(config.persistenceEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'context',
            cascadeId: finalCascadeId,
            functionId: finalFunctionId,
            updates,
            uiUpdates
          }),
        });

        if (!response.ok) throw new Error(`Persistence sync failed: ${response.status}`);

        return await response.json();
      });

      if (!result) {
        if (isDev) console.error(`[CLIENT MW] ❌ Failed to record context for cascade ${finalCascadeId} after retries`);
        return; // Return nothing on failure
      }

      return next({ ...action, meta: { ...action.meta, origin: 'client', functionId: finalFunctionId, cascadeId: finalCascadeId } });
    }

    return next(action);
  };
};