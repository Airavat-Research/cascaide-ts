
import { configureStore, combineReducers, Middleware } from '@reduxjs/toolkit';
import { workflowSlice } from '@cascaide-ts/core';
import { createClientHydrationMiddleware } from '@cascaide-ts/core';
import { createClientPersistenceMiddleware } from '@cascaide-ts/core';
import { ClientWorkflowGraph } from '@cascaide-ts/core';
import { setupWorkflowListeners, workflowListenerMiddleware } from '../middlewares/clientWorkflowListenerMiddleware';
const rootReducer = combineReducers({ workflow: workflowSlice.reducer });


export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = ReturnType<typeof configureStore>['dispatch'];
  

  
export const createClientStore = (
  workflowGraph: ClientWorkflowGraph,
  actionRelayEndpoint: string,
  persistenceEndpoint?: string,
  extraMiddlewares: Middleware[] = [] 
) => {

  const isLite = !persistenceEndpoint;

  setupWorkflowListeners({
    workflowGraph,
    actionRelayEndpoint,
    isLite
  });

  const additionalMiddleware: Middleware[] = [];

  // 2. Add Persistence and Hydration first
  if (persistenceEndpoint) {
    additionalMiddleware.push(
      createClientPersistenceMiddleware({ persistenceEndpoint }),
      createClientHydrationMiddleware({ persistenceEndpoint })
    );
  }


  additionalMiddleware.push(...extraMiddlewares);

  additionalMiddleware.push(workflowListenerMiddleware.middleware);

  return configureStore({
    reducer: rootReducer,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false,
      }).concat(additionalMiddleware),
    devTools: process.env.NODE_ENV !== 'production',
  });
};