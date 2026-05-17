// core/middleware/serverPersistenceMiddleware.ts

import { Middleware } from '@reduxjs/toolkit';
import { addActiveNode, removeActiveNode, setError, updateContext } from '../workflowSlice';
import { CascadePersistence } from '../persistence';

// Check for development environment
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
        if (isDev) console.error(`[SERVER MW] ❌ All ${maxRetries} retry attempts failed:`, error);
        return null;
      }
      const delay = baseDelay * Math.pow(2, attempt - 1);
      if (isDev) console.warn(`[SERVER MW] ⚠️ Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
}

export const createServerPersistenceMiddleware = (
  persistor: CascadePersistence
): Middleware => {
  return (store) => (next) => async (action: any) => {
    
    // ========================================
    // ADD ACTIVE NODE
    // ========================================
    if (addActiveNode.match(action)) {
      const { origin, functionId, cascadeId, userId } = action.meta;
      const { nodeId, nodeName, contextData } = action.payload;

      if (!cascadeId || origin) return next(action);

      const initialFunctionId = functionId ?? 0;

      const result = await retryWithBackoff(async () => {
        return await persistor.claimNodeExecution({
          nodeInstanceId: nodeId,
          cascadeId,
          userId: userId || contextData.userId,
          nodeName,
          functionId: initialFunctionId, 
          inputContext: contextData,
          location: 'server',
        });
      });

      if (!result) {
        if (isDev) console.error(`[SERVER MW] ❌ Failed to claim node ${nodeId} after retries`);
        return; // Return nothing on failure
      }

      if (isDev) console.log(`[SERVER MW] ✅ Claimed node ${nodeId} with FnId: ${result.functionId}`);

      const claimedAction = {
        ...action,
        meta: { 
          ...action.meta, 
          origin: 'server', 
          functionId: result.functionId, 
          cascadeId 
        }
      };

      return next(claimedAction);
    }

    // ========================================
    // REMOVE ACTIVE NODE
    // ========================================
    if (removeActiveNode.match(action)) {
      const { origin, functionId, cascadeId } = action.meta;
      const nodeId = typeof action.payload === 'string' ? action.payload : action.payload.nodeId;
    
      const hasSpawns = (action.payload as { hasSpawns?: boolean }).hasSpawns ?? false;
      const fullOutput = (action.payload as { fullOutput?: any }).fullOutput;

      const state = store.getState() as any;
      const node = state.workflow.activeNodes[nodeId];
      
      const finalCascadeId = cascadeId || node?.cascadeId;
      const finalFunctionId = functionId ?? node?.functionId ?? 0;

      if (!finalCascadeId || origin) return next(action);

      const output = fullOutput || state.workflow.context[finalCascadeId];
      
      const result = await retryWithBackoff(async () => {
        return await persistor.finalizeNodeExecution({
          nodeInstanceId: nodeId,
          cascadeId: finalCascadeId,
          fullOutput: output,
          hasSpawns
        });
      });

      if (!result) {
        if (isDev) console.error(`[SERVER MW] ❌ Failed to finalize node ${nodeId} after retries`);
        return; // Return nothing on failure
      }

      const claimedAction = {
        ...action,
        meta: { ...action.meta, origin: 'server', functionId: finalFunctionId, cascadeId: finalCascadeId }
      };

      return next(claimedAction);
    }

    // ========================================
    // SET ERROR
    // ========================================
    if (setError.match(action)) {
      const { origin, functionId, cascadeId } = action.meta;
      const { nodeId, error } = action.payload;

      const state = store.getState() as any;
      const node = state.workflow.activeNodes[nodeId];
      
      const finalCascadeId = cascadeId || node?.cascadeId;
      const finalFunctionId = functionId ?? node?.functionId ?? 0;

      if (!finalCascadeId || origin) return next(action);

      const result = await retryWithBackoff(async () => {
        return await persistor.markExecutionFailed(nodeId, finalCascadeId, error);
      });

      if (!result) {
        if (isDev) console.error(`[SERVER MW] ❌ Failed to mark node ${nodeId} as failed after retries`);
        return; // Return nothing on failure
      }

      const claimedAction = {
        ...action,
        meta: { ...action.meta, origin: 'server', functionId: finalFunctionId, cascadeId: finalCascadeId }
      };
      
      return next(claimedAction);
    }

    // ========================================
    // UPDATE CONTEXT
    // ========================================
    if (updateContext.match(action)) {
      const { origin, functionId, cascadeId, uiUpdates } = action.meta;
      const updates = action.payload;

      const finalCascadeId = cascadeId;
      const finalFunctionId = functionId ?? 0;

      if (!finalCascadeId || origin) return next(action);

      // Skip streaming init
      const updateValue = updates[finalCascadeId];
      if (updateValue && updateValue.status === 'streaming') return next(action);

      const result = await retryWithBackoff(async () => {
        return await persistor.recordContextEvents({
          cascadeId: finalCascadeId,
          functionId: finalFunctionId,
          updates,
          uiUpdates
        });
      });

      if (!result) {
        if (isDev) console.error(`[SERVER MW] ❌ Failed to record context for cascade ${finalCascadeId} after retries`);
        return; // Return nothing on failure
      }

      const claimedAction = {
        ...action,
        meta: { ...action.meta, origin: 'server', functionId: finalFunctionId, cascadeId: finalCascadeId }
      };

      return next(claimedAction);
    }

    return next(action);
  };
};