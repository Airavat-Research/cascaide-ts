// core/workflowSlice.ts

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { WorkflowContext, WorkflowState, ActionMeta, StreamChunk, WorkflowStep } from './types';




export type addActiveNodePayload = {
  nodeId: string;
  nodeName: string;
  parentTriggerId?: string;
  contextData?: any;

}
 export type updateContextPayload ={
  [cascadeId: string]: WorkflowStep;
 }

 export type removeActiveNodePayload = {
  nodeId: string;
  hasSpawns: boolean;
  fullOutput?: any;
 }

 export type setErrorPayload ={
  nodeId: string;
  error: string;
 }

 export type markNodeProcessedPayload ={
  nodeId: string;

 }

const initialState: WorkflowState = {
    context: {},
    activeNodes: {},
    history: [],
    errors: {},
  };

  
  
export const workflowSlice = createSlice({
  name: 'workflow',
  initialState,
  reducers: {
    updateContext: {
      reducer: (
        state: WorkflowState,
        action: PayloadAction<updateContextPayload, string, ActionMeta>
      ) => {
        Object.entries(action.payload).forEach(([key, value]) => {
          if (!state.context[key]) {
            state.context[key] = [];
          }
          // Check if the value specifies a specific index for replacement
          if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'index' in value) {
            const index = value.index as number;
            state.context[key][index] = value;
          } else {
            state.context[key].push(value);
          }
        });
      },
      prepare: (payload: { [key: string]: any }, meta?: ActionMeta) => {
        return { payload, meta: meta || {} };
      },
    },

    addActiveNode: {
      reducer: (
        state: WorkflowState,
        action: PayloadAction< addActiveNodePayload, string, ActionMeta>
      ) => {
        const { nodeId, nodeName, parentTriggerId, contextData } = action.payload;
        const { origin, functionId, cascadeId } = action.meta;

        state.activeNodes[nodeId] = {
          nodeName,
          parentTriggerId,
          processed: false,
          initialContext: contextData,
          origin,
          functionId,
          cascadeId: cascadeId || contextData?.cascadeId,
        };

        if (state.errors[nodeId]) {
          delete state.errors[nodeId];
        }
      },
      prepare: (
        payload: addActiveNodePayload, // Use the type here
        meta?: ActionMeta
      ) => {
        const cascadeId = meta?.cascadeId || payload.contextData?.cascadeId;
        return { 
          payload, 
          meta: { ...meta, cascadeId } 
        };
      },
    },

    removeActiveNode: {
      reducer: (
        state: WorkflowState,
        action: PayloadAction<
          removeActiveNodePayload,
          string,
          ActionMeta
        >
      ) => {
        const {nodeId} = action.payload
        if (state.activeNodes[nodeId]) {
          state.history.push({
            nodeId,
            nodeName: state.activeNodes[nodeId].nodeName,
            timestamp: Date.now(),
          });
          delete state.activeNodes[nodeId];
        }
      },
      prepare: (
        payload: removeActiveNodePayload,
        meta?: ActionMeta
      ) => {
        return { payload, meta: meta || {} };
      },
    },

    setError: {
      reducer: (
        state: WorkflowState,
        action: PayloadAction<setErrorPayload, string, ActionMeta>
      ) => {
        const { nodeId, error } = action.payload;
        state.errors[nodeId] = error;
      },
      prepare: (payload: setErrorPayload, meta?: ActionMeta) => {
        return { payload, meta: meta || {} };
      },
    },

    markNodeProcessed: (state : WorkflowState, action: PayloadAction<markNodeProcessedPayload>) => {
      const {nodeId} = action.payload;
      if (state.activeNodes[nodeId]) {
        state.activeNodes[nodeId].processed = true;
      }
    },
    
    // reducer logic
    streamChunkReceived: (state: WorkflowState, action: PayloadAction<StreamChunk>) => {
      const { cascadeId, identity, value } = action.payload;
      if (!identity || value === undefined) return;
    
      const cascadeContextArray = state.context[cascadeId];
      
      if (!cascadeContextArray || cascadeContextArray.length === 0) return;
    
      const latestStateObject = cascadeContextArray[cascadeContextArray.length - 1];
      const history = latestStateObject.history;
      const lastMessage = history[history.length - 1];
      if (!lastMessage || lastMessage.role !== 'assistant') return;
    
      // ── Blind assembly — no provider knowledge ────────────────────────────────
      if (typeof lastMessage[identity] === 'string') {
        lastMessage[identity] += value;
      } else {
        lastMessage[identity] = value;
      }
    },

    hydrateContext: (state: WorkflowState, action: PayloadAction<WorkflowContext>) => {
      // action.payload is the object returned by your hydrateCascadeContext function
      Object.entries(action.payload).forEach(([key, value]) => {
        // We replace or initialize the context for the specific cascadeId
        state.context[key] = value;
      });
    },

  forkAndHydrate: {
    reducer: () => { /* No-op: Middleware intercepts this */ },
    prepare: (payload: { 
      sourceCascadeId: string; 
      newCascadeId: string; 
      upToFunctionId: number; 
    }) => ({ payload })
  },

  },

  
});

export const {
  updateContext,
  addActiveNode,
  removeActiveNode,
  setError,
  markNodeProcessed,
  streamChunkReceived,
  hydrateContext,
  forkAndHydrate,
} = workflowSlice.actions;

export default workflowSlice.reducer;