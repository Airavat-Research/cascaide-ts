// core/middleware/clientHydrationMiddleware.ts

import { Middleware } from '@reduxjs/toolkit';
import { addActiveNode, hydrateContext, forkAndHydrate } from '../workflowSlice';

export interface ClientHydrationConfig {
  persistenceEndpoint: string;
}

const isDev = process.env.NODE_ENV === 'development';

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
        if (isDev) console.error(`[HYDRATION] ❌ All ${maxRetries} attempts failed:`, error);
        return null;
      }
      const delay = baseDelay * Math.pow(2, attempt - 1);
      if (isDev) console.warn(`[HYDRATION] ⚠️ Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
}

export const createClientHydrationMiddleware = (
  config: ClientHydrationConfig
): Middleware => {
  return (store) => (next) => async (action: any) => {

    // --- Existing: addActiveNode cold-start hydration ---
    if (addActiveNode.match(action)) {
      const { origin, functionId, cascadeId } = action.meta;

      if (cascadeId && functionId > 0 && origin === 'client') {
        const state = store.getState() as any;
        const existingContext = state.workflow.context[cascadeId];

        if (!existingContext || Object.keys(existingContext).length === 0) {
          if (isDev) console.log(`[HYDRATION] 🧊 Cold start for ${cascadeId}`);

          const hydratedData = await retryWithBackoff(async () => {
            const response = await fetch(config.persistenceEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'hydrate',
                cascadeId,
                functionId,
                ui: true
               }),
            });
            if (!response.ok) throw new Error(`Status ${response.status}`);
            return await response.json();
          });

          if (!hydratedData) {
            const errorMsg = `[HYDRATION] Critical Failure: Could not hydrate cascade ${cascadeId}. Action terminated.`;
            if (isDev) console.error(errorMsg);
            throw new Error('Hydration failed');
          }

          if (Object.keys(hydratedData).length > 0) {
            store.dispatch(hydrateContext(hydratedData));
            if (isDev) console.log(`[HYDRATION] ✅ State restored successfully`);
          }
        }
      }
    }

    if (forkAndHydrate.match(action)) {
      const { sourceCascadeId, newCascadeId, upToFunctionId } = action.payload;

      if (isDev) console.log(`[FORK] 🍴 Forking ${sourceCascadeId} → ${newCascadeId} at fn ${upToFunctionId}`);

      const forkedData = await retryWithBackoff(async () => {
        const response = await fetch(config.persistenceEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'forkAndHydrate', sourceCascadeId, newCascadeId, upToFunctionId }),
        });
        if (!response.ok) throw new Error(`Fork failed with status ${response.status}`);
        return await response.json(); // expects { newCascadeId, status, context: WorkflowContext }
      });

      if (!forkedData) {
        const errorMsg = `[FORK] Critical Failure: Could not fork cascade ${sourceCascadeId}. Action terminated.`;
        if (isDev) console.error(errorMsg);
        throw new Error('Fork failed');
      }

      if (forkedData.context && Object.keys(forkedData.context).length > 0) {
        store.dispatch(hydrateContext(forkedData.context));
        if (isDev) console.log(`[FORK] ✅ Fork complete, context hydrated for ${newCascadeId}`);
      } else {
        if (isDev) console.log(`[FORK] ✅ Fork complete, no context to hydrate for ${newCascadeId}`);
      }

      // Falls through to next(action) — no-op in store, fine
    }

    return next(action);
  };
};