// core/persistence.ts

import { ClaimRequest, ClaimResponse, WorkflowContext } from './types';

export interface CascadePersistence {
  claimNodeExecution(params: ClaimRequest): Promise<ClaimResponse>;
  
  finalizeNodeExecution(params: {
    nodeInstanceId: string;
    cascadeId: string;
    fullOutput: any;
    hasSpawns: boolean;
  }): Promise<{ status: string }>;
  
  markExecutionFailed(
    nodeInstanceId: string,
    cascadeId: string,
    error: string
  ): Promise<{ status: string }>;
  
  recordContextEvents(params: {
    cascadeId: string;
    functionId: number;
    updates: { [key: string]: any };
    uiUpdates?: { [key: string]: any };  // ADD THIS
  }): Promise<{ status: string }>;
  
  hydrateCascadeContext(
    cascadeId: string,
    upToFunctionId: number,
    ui?:boolean
  ): Promise<WorkflowContext>;

 

  forkCascadeWithContext(params: {
    sourceCascadeId: string;
    newCascadeId: string;
    upToFunctionId: number;
  }): Promise<{ newCascadeId: string; status: string; context: WorkflowContext }>;
}

export async function handlePersistenceAction(persistor: CascadePersistence, action: string, body: any) {
  switch (action) {
    case 'claim': return await persistor.claimNodeExecution(body);
    case 'finalize': return await persistor.finalizeNodeExecution(body);
    case 'error': return await persistor.markExecutionFailed(body.nodeInstanceId, body.cascadeId, body.error);
    case 'context': return await persistor.recordContextEvents(body);
    case 'hydrate': return await persistor.hydrateCascadeContext(body.cascadeId, body.functionId, body.ui);
    case 'forkAndHydrate': 
      return await persistor.forkCascadeWithContext({
        sourceCascadeId: body.sourceCascadeId,
        newCascadeId: body.newCascadeId,
        upToFunctionId: body.upToFunctionId,
      });
    default: throw new Error('Invalid action');
  }
}