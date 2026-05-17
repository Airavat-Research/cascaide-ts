// core/middleware/serverHydrationMiddleware.ts
import { Middleware } from '@reduxjs/toolkit';
import { addActiveNode, hydrateContext, forkAndHydrate } from '../workflowSlice';
import { CascadePersistence } from '../persistence';

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
        if (isDev) console.error(`[SERVER HYDRATION] ❌ All ${maxRetries} attempts failed:`, error);
        return null;
      }
      const delay = baseDelay * Math.pow(2, attempt - 1);
      if (isDev) console.warn(`[SERVER HYDRATION] ⚠️ Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
}

export const createServerHydrationMiddleware = (
  persistor: CascadePersistence
): Middleware => {
  return (store) => (next) => async (action: any) => {

    // --- Existing: addActiveNode cold-start hydration ---
    if (addActiveNode.match(action)) {
      const { origin, functionId, cascadeId } = action.meta;

      if (cascadeId && functionId > 0 && origin) {
        const state = store.getState() as any;
        const existingContext = state.workflow.context[cascadeId];

        if (!existingContext || Object.keys(existingContext).length === 0) {
          if (isDev) console.log(`[SERVER HYDRATION] 🧊 Cold start for ${cascadeId}`);

          const hydratedContext = await retryWithBackoff(async () => {
            return await persistor.hydrateCascadeContext(cascadeId, functionId + 1);
          });

          if (!hydratedContext) {
            const errorMsg = `[SERVER HYDRATION] 🛑 Critical: Hydration failed for ${cascadeId}. Terminating action.`;
            if (isDev) console.error(errorMsg);
            throw new Error('Server-side hydration failed: persistence unreachable.');
          }

          if (Object.keys(hydratedContext).length > 0) {
            await store.dispatch(hydrateContext(hydratedContext));
            if (isDev) console.log(`[SERVER HYDRATION] ✅ State restored successfully`);
          }
        }
      }
    }

    // --- New: forkAndHydrate interception ---
    if (forkAndHydrate.match(action)) {
      const { sourceCascadeId, newCascadeId, upToFunctionId } = action.payload;

      if (isDev) console.log(`[SERVER FORK] 🍴 Forking ${sourceCascadeId} → ${newCascadeId} at fn ${upToFunctionId}`);

      const forkedData = await retryWithBackoff(async () => {
        return await persistor.forkCascadeWithContext({ sourceCascadeId, newCascadeId, upToFunctionId });
      });

      if (!forkedData) {
        const errorMsg = `[SERVER FORK] 🛑 Critical: Fork failed for ${sourceCascadeId}. Terminating action.`;
        if (isDev) console.error(errorMsg);
        throw new Error('Server-side fork failed: persistence unreachable.');
      }

      if (forkedData.context && Object.keys(forkedData.context).length > 0) {
        await store.dispatch(hydrateContext(forkedData.context));
        if (isDev) console.log(`[SERVER FORK] ✅ Fork complete, context hydrated for ${newCascadeId}`);
      } else {
        if (isDev) console.log(`[SERVER FORK] ✅ Fork complete, no context to hydrate for ${newCascadeId}`);
      }

      // Falls through to next(action) — no-op in store, fine
    }

    return next(action);
  };
};