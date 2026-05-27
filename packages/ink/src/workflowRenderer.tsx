import React, { useContext } from 'react';
import { Box } from 'ink';
import { useSelector } from 'react-redux';
import type { RootState } from '@cascaide-ts/core';
import { InkWorkflowContext } from './workflowProvider';

export function WorkflowRenderer() {
  const config = useContext(InkWorkflowContext); 

  if (!config) {
    throw new Error('WorkflowRenderer must be used within a WorkflowProvider.');
  }

  const { activeNodes } = useSelector((state: RootState) => state.workflow);
  const { clientWorkflowGraph, uiComponentRegistry } = config;

  const uiNodes = Object.keys(activeNodes).filter((nodeId) => {
    const node = activeNodes[nodeId];
    const nodeDefinition = clientWorkflowGraph[node.nodeName];
    return nodeDefinition?.isUINode;
  });

  if (uiNodes.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {uiNodes.map((nodeId) => {
        const node = activeNodes[nodeId];
        const ComponentToRender = uiComponentRegistry[node.nodeName];

        if (!ComponentToRender) {
          console.error(`Ink UI component for node '${node.nodeName}' not found.`);
          return null;
        }

        return (
          <Box key={nodeId}>
            <ComponentToRender nodeId={nodeId} />
          </Box>
        );
      })}
    </Box>
  );
}