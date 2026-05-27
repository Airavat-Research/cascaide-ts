// No "use client" — Ink runs in Node.js, not Next.js

import { useDispatch, useSelector, useStore } from 'react-redux';
import { useMemo, useCallback } from 'react';
import type { RootState, AppDispatch } from '@cascaide-ts/core';
import { createCascadeWorkflowActions } from './cascadeActions';

export const useWorkflow = (nodeId: string) => {
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();

  const nodeData = useSelector(
    (state: RootState) => state.workflow.activeNodes[nodeId],
  );

  const getNodeData = useCallback(
    () => store.getState().workflow.activeNodes[nodeId],
    [store, nodeId],
  );

  const getState = useCallback(
    () => store.getState(),
    [store],
  );

  const { updateContext, addActiveNode, signalCompletion } = useMemo(
    () => createCascadeWorkflowActions(dispatch, nodeId, getNodeData),
    [dispatch, nodeId, getNodeData],
  );

  return useMemo(
    () => ({ nodeData, getState, updateContext, addActiveNode, signalCompletion }),
    [nodeData, getState, updateContext, addActiveNode, signalCompletion],
  );
};