import { configureStore, createListenerMiddleware, Middleware } from '@reduxjs/toolkit';
import workflowReducer from '../workflowSlice';
import { createServerPersistenceMiddleware } from '../middlewares/serverPersistenceMiddleware';
import { createServerHydrationMiddleware } from '../middlewares/serverHydrationMiddleware';

import { CascadePersistence } from '../persistence';


export const createServerStore = (
  persistor?: CascadePersistence,
  extraMiddlewares: Middleware[] = [] 
) => {
  const serverListenerMiddleware = createListenerMiddleware();
  
  const middlewares: Middleware[] = [];

  // Persistence and Hydration run first
  if (persistor) {
    middlewares.push(
      createServerPersistenceMiddleware(persistor),
      createServerHydrationMiddleware(persistor)
    );
  }


  middlewares.push(...extraMiddlewares);

  middlewares.push(serverListenerMiddleware.middleware);

  const store = configureStore({
    reducer: {
      workflow: workflowReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false, // risky - future TODO for non serializables (maybe)
      }).concat(middlewares),
    devTools: process.env.NODE_ENV !== 'production',
  });
  
  return { store, serverListener: serverListenerMiddleware };
};