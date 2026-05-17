"use client"

import { ClientWorkflowGraph, addActiveNode, updateContext, createClientStore } from '@cascaide-ts/core'
import React, { useRef } from 'react';
import { Provider} from 'react-redux';
import { Middleware } from '@reduxjs/toolkit';

export type ClientWorkflowConfig = {
  clientWorkflowGraph: ClientWorkflowGraph
  uiComponentRegistry: { [key: string]: React.ComponentType<any> };
};

export const ReactWorkflowContext = React.createContext<ClientWorkflowConfig | null>(null);

export function WorkflowProvider({
  children,
  initialNodeId,
  initialNodeName,
  initialContext = {},
  config,
  actionRelayEndpoint,
  persistenceEndpoint, 
  extraMiddlewares = []
}: {
  children: React.ReactNode;
  initialNodeId: string;
  initialNodeName: string;
  initialContext?: any;
  config: ClientWorkflowConfig;
  actionRelayEndpoint: string;
  persistenceEndpoint?: string; 
  extraMiddlewares?: Middleware[];  
}) {
  const storeRef = useRef<ReturnType<typeof createClientStore> | null>(null);

  if (!storeRef.current) {
    // createClientStore handles the internal if(persistenceEndpoint) logic
    storeRef.current = createClientStore(
      config.clientWorkflowGraph, 
      actionRelayEndpoint, 
      persistenceEndpoint, 
      extraMiddlewares
    );
    
    // Initializing state
    storeRef.current.dispatch(updateContext(initialContext));
    storeRef.current.dispatch(addActiveNode({ nodeId: initialNodeId, nodeName: initialNodeName }));
  }

  return (
    <Provider store={storeRef.current}>
      <ReactWorkflowContext.Provider value={config}>
        {children}
      </ReactWorkflowContext.Provider>
    </Provider>
  );
}