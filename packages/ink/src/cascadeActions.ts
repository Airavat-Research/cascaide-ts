import { v7 as uuidv7 } from 'uuid';
import {
  type AppDispatch,
  type RootState,
  type Spawns,
  type Updates,
  addActiveNode as reduxAddActiveNode,
  removeActiveNode,
  updateContext as reduxUpdateContext,
  forkAndHydrate,
} from '@cascaide-ts/core';

const isDev = process.env.NODE_ENV === 'development';

// ── Types ──────────────────────────────────────────────────────────────────────

export type NodeDataGetter = () => RootState['workflow']['activeNodes'][string] | undefined;

export type CascadeWorkflowActions = {
  updateContext: (updates: Updates) => Promise<void>;
  addActiveNode: (spawns: Spawns) => Promise<Record<string, string> | undefined>;
  signalCompletion: (hasSpawns: boolean, fullOutput?: any) => Promise<void>;
};

export type CascadeObserveActions = {
  forkCascade: (
    newCascadeId: string,
    upToFunctionId: number,
    sourceCascadeId?: string,
  ) => Promise<{ status: 'SUCCESS' | 'FAILED' }>;
};

// ── createCascadeWorkflowActions ───────────────────────────────────────────────
//
// Extracts all dispatch logic that was previously inlined in useWorkflow.
// Takes a raw dispatch function and a getter for the current node's data.
// The getter is a plain function (not a hook) so any framework can supply it.
//
// Used by: @cascaide-ts/react, @cascaide-ts/vue, @cascaide-ts/solid, etc.

export function createCascadeWorkflowActions(
  dispatch: AppDispatch,
  nodeId: string,
  getNodeData: NodeDataGetter,
): CascadeWorkflowActions {

  // ── Update Context ───────────────────────────────────────────────────────────
  const updateContext = async (updates: Updates): Promise<void> => {
    const nodeData = getNodeData();
    const isPersisted = !!(nodeData?.cascadeId && nodeData?.origin);

    if (!isPersisted) {
      if (isDev) {
        console.warn(
          `[cascaide] updateContext called on ephemeral node "${nodeId}". ` +
          `This node has no cascadeId or origin — context will not be persisted. ` +
          `If persistence is required, ensure the node is spawned with a cascadeId.`
        );
      }
      return;
    }

    await dispatch(
      reduxUpdateContext(updates, {
        origin: 'client',
        cascadeId: nodeData.cascadeId,
        functionId: nodeData.functionId,
      })
    );
  };

  // ── Add Active Node ──────────────────────────────────────────────────────────
  const addActiveNode = async (
    spawns: Spawns
  ): Promise<Record<string, string> | undefined> => {
    const cascadeMap: Record<string, string> = {};

    for (const [name, spawnContext] of Object.entries(spawns)) {
      const newNodeId = `${name}_${uuidv7()}`;
      const { cascadeId, ...contextData } = spawnContext;

      await dispatch(
        reduxAddActiveNode({
          nodeId: newNodeId,
          nodeName: name,
          parentTriggerId: nodeId,
          contextData: {
            ...contextData,
            sentFromClient: true,
            ...(cascadeId && { cascadeId }),
          },
        })
      );

      if (cascadeId) {
        cascadeMap[name] = cascadeId;
      }
    }

    return Object.keys(cascadeMap).length > 0 ? cascadeMap : undefined;
  };

  // ── Signal Completion ────────────────────────────────────────────────────────
  const signalCompletion = async (
    hasSpawns: boolean,
    fullOutput?: any
  ): Promise<void> => {
    const nodeData = getNodeData();
    const isPersisted = !!(nodeData?.cascadeId && nodeData?.origin);

    if (isDev && isPersisted && !fullOutput) {
      console.warn(
        `[cascaide] signalCompletion called on persisted node "${nodeId}" without fullOutput. ` +
        `The node's output will not be recorded. Pass fullOutput to capture the result of this node execution.`
      );
    }

    await dispatch(
      removeActiveNode(
        { nodeId, hasSpawns, fullOutput },
        {
          functionId: nodeData?.functionId,
          cascadeId: nodeData?.cascadeId,
        }
      )
    );
  };

  return { updateContext, addActiveNode, signalCompletion };
}

// ── createCascadeObserveActions ────────────────────────────────────────────────
//
// Extracts the forkCascade dispatch logic from useCascade.
// Scoped to a cascadeId, takes raw dispatch only.
//
// Used by: @cascaide-ts/react, @cascaide-ts/vue, @cascaide-ts/solid, etc.

export function createCascadeObserveActions(
  dispatch: AppDispatch,
  cascadeId: string,
): CascadeObserveActions {

  const forkCascade = async (
    newCascadeId: string,
    upToFunctionId: number,
    sourceCascadeId?: string,
  ): Promise<{ status: 'SUCCESS' | 'FAILED' }> => {
    try {
      await dispatch(
        forkAndHydrate({
          sourceCascadeId: sourceCascadeId ?? cascadeId,
          newCascadeId,
          upToFunctionId,
        })
      );
      return { status: 'SUCCESS' };
    } catch {
      return { status: 'FAILED' };
    }
  };

  return { forkCascade };
}