// /lib/features/workflow/workflowSelectors.ts

import { createSelector } from 'reselect';
import { RootState } from './stores/createClientStore'
import { ActiveNode } from './types';

// Input Selectors
const selectActiveNodes = (state: RootState) => state.workflow.activeNodes;
const selectContext = (state: RootState) => state.workflow.context;
const selectCascadeId = (_state: RootState, cascadeId: string) => cascadeId;


export const makeSelectCascadeState = () => {
  return createSelector(
    [selectContext, selectCascadeId],
    (context, cascadeId) => {
      const arr = context[cascadeId];
      if (!arr || arr.length === 0) return undefined;

      const status = arr[arr.length - 1].status;
      const result: Record<string, any[]> = {};

      arr.forEach(step => {
        const { status: _, ...rest } = step;
        Object.entries(rest).forEach(([key, value]) => {
          if (value === undefined || value === null) return;
          if (!result[key]) result[key] = [];
          if (Array.isArray(value)) {
            result[key].push(...value);
          } else {
            result[key].push(value);
          }
        });
      });

      return {
        ...result,
        status,
      } as { status: string; history: any[]; [key: string]: any };
    }
  );
};

/**
 * Creates a memoized selector to get all active nodes for a specific cascade.
 * This is a "factory function" because it needs the `cascadeId` to work.
 */
export const makeSelectCascadeNodes = () => {
  return createSelector(
    [selectActiveNodes, selectCascadeId],
    (
      activeNodes: { [nodeId: string]: ActiveNode },
      cascadeId: string
    ) => {
   
      return Object.entries(activeNodes)
        .filter(([_, node]) => node.initialContext?.cascadeId === cascadeId)
        .map(([nodeId, node]) => ({
          nodeId,
          nodeName: node.nodeName,
          parentTriggerId: node.parentTriggerId,
          initialContext: node.initialContext,
          processed: node.processed,
        }));
    }
  );
};


export const selectAllCascadeIds = createSelector(
  [selectContext],
  (context) => Object.keys(context)
);