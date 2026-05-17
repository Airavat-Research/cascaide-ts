"use client";

import { useDispatch, useSelector, useStore } from 'react-redux';
import { useMemo, useCallback } from 'react';
import {
  type RootState,
  type Spawns,
  type AppDispatch,
  type Updates,
  addActiveNode as reduxAddActiveNode,
  removeActiveNode,
  updateContext as reduxUpdateContext,
} from '@cascaide-ts/core';
import { v7 as uuidv7 } from 'uuid';


const isDev = process.env.NODE_ENV === 'development';

export const useWorkflow = (nodeId: string) => {
  const dispatch = useDispatch<AppDispatch>();
  const store = useStore<RootState>();

  // ── Node Data ──────────────────────────────────────────────────────────────
  const nodeData = useSelector(
    (state: RootState) => state.workflow.activeNodes[nodeId]
  );

  // A node is persisted if it has both a cascadeId and an origin
  const isPersisted = !!(nodeData?.cascadeId && nodeData?.origin);

  // ── Escape Hatch ───────────────────────────────────────────────────────────
  const getState = useCallback(
    () => store.getState(),
    [store]
  );

  // ── Update Context (persisted nodes only) ──────────────────────────────────
  const updateContext = useCallback(
    async (updates: Updates) => {
      if (!isPersisted) {
        if (isDev) {
          console.warn(
            `[useWorkflow] updateContext called on ephemeral node "${nodeId}". ` +
            `This node has no cascadeId or origin — context will not be persisted. ` +
            `If persistence is required, ensure the node is spawned with a cascadeId.`
          );
        }
        return;
      }

      return await dispatch(
        reduxUpdateContext(updates, {
          origin: 'client',
          cascadeId: nodeData.cascadeId,
          functionId: nodeData.functionId,
        })
      );
    },
    [dispatch, isPersisted, nodeId, nodeData]
  );

  // ── Add Active Node ────────────────────────────────────────────────────────
  const addActiveNode = useCallback(
    async (spawns: Spawns): Promise<Record<string, string> | undefined> => {
      const cascadeMap: Record<string, string> = {};

      for (const [name, spawnContext] of Object.entries(spawns)) {
        const newNodeId = `${name}_${uuidv7()}`;
        const { cascadeId, ...contextData } = spawnContext;

        await dispatch(
          reduxAddActiveNode(
            {
              nodeId: newNodeId,
              nodeName: name,
              parentTriggerId: nodeId,
              contextData: {
                ...contextData,
                sentFromClient: true,
                ...(cascadeId && { cascadeId }),
              },
            }
          )
        );

        if (cascadeId) {
          cascadeMap[name] = cascadeId;
        }
      }

      return Object.keys(cascadeMap).length > 0 ? cascadeMap : undefined;
    },
    [dispatch, nodeId]
  );

  // ── Signal Completion ──────────────────────────────────────────────────────
  const signalCompletion = useCallback(
    async (hasSpawns: boolean, fullOutput?: any) => {
      if (isDev && isPersisted && !fullOutput) {
        console.warn(
          `[useWorkflow] signalCompletion called on persisted node "${nodeId}" without fullOutput. ` +
          `The node's output will not be recorded. Pass fullOutput to capture the result of this node execution.`
        );
      }

      return await dispatch(
        removeActiveNode(
          {
            nodeId,
            hasSpawns,
            fullOutput,
          },
          {
            functionId: nodeData?.functionId,
            cascadeId: nodeData?.cascadeId,
          }
        )
      );
    },
    [dispatch, nodeId, isPersisted, nodeData]
  );

  // ── Return ─────────────────────────────────────────────────────────────────
  return useMemo(
    () => ({
      nodeData,
      getState,
      updateContext,
      addActiveNode,
      signalCompletion,
    }),
    [
      nodeData,
      getState,
      updateContext,
      addActiveNode,
      signalCompletion,
    ]
  );
};