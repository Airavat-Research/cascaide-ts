
'use client';

import React, { useContext } from 'react';
import { ReactWorkflowContext } from './workflowProvider';

import { useDispatch, useSelector, TypedUseSelectorHook } from 'react-redux';
import type { RootState, AppDispatch } from '@cascaide-ts/core'

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;

export function WorkflowRenderer() {
  const config = useContext(ReactWorkflowContext);
  if (!config) {
    throw new Error('WorkflowRenderer must be used within a WorkflowProvider.');
  }

  const { activeNodes } = useAppSelector((state) => state.workflow);
  const { clientWorkflowGraph, uiComponentRegistry } = config;

  // The fix is here: remove the check for `currentPhase`.
  const uiNodes = Object.keys(activeNodes).filter(nodeId => {
    const node = activeNodes[nodeId];
    const nodeDefinition = clientWorkflowGraph[node.nodeName];
    // Check if the node is defined as a UI node in the graph
    return nodeDefinition?.isUINode;
  });

  if (uiNodes.length === 0) {
    return null;
  }

  return (
    <div>
      {uiNodes.map(nodeId => {
        const node = activeNodes[nodeId];
        const ComponentToRender = uiComponentRegistry[node.nodeName];
        if (!ComponentToRender) {
          console.error(`UI component for node '${node.nodeName}' not found.`);
          return null;
        }
        return (
          <div key={nodeId}>
            <ComponentToRender nodeId={nodeId} />
          </div>
        );
      })}
    </div>
  );
}