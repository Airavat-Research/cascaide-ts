// No "use client" — Ink runs in Node.js, not Next.js

import { useDispatch, useSelector } from 'react-redux';
import { useMemo } from 'react';
import type { AppDispatch, RootState } from '@cascaide-ts/core';
import {
  makeSelectCascadeNodes,
  makeSelectCascadeState,
  selectAllCascadeIds,
} from '@cascaide-ts/core';

import {   createCascadeObserveActions } from "./cascadeActions"

export type CascadeNode = {
  nodeId: string;
  nodeName: string;
  parentTriggerId?: string;
  initialContext?: any;
  processed?: boolean;
};

export type CascadeStateResult = {
  status: string;
  history: any[];
  [key: string]: any;
};

export const useCascade = (cascadeId: string) => {
  const dispatch = useDispatch<AppDispatch>();

  const selectCascadeState = useMemo(makeSelectCascadeState, []);
  const selectCascadeNodes = useMemo(makeSelectCascadeNodes, []);

  const cascadeState = useSelector(
    (state: RootState) => selectCascadeState(state, cascadeId),
  ) as CascadeStateResult | undefined;

  const cascadeNodes = useSelector(
    (state: RootState) => selectCascadeNodes(state, cascadeId),
  ) as CascadeNode[];

  const isComplete = cascadeNodes.length === 0 && cascadeState !== undefined;
  const exists = cascadeState !== undefined || cascadeNodes.length > 0;

  const { forkCascade } = useMemo(
    () => createCascadeObserveActions(dispatch, cascadeId),
    [dispatch, cascadeId],
  );

  return { cascadeState, cascadeNodes, isComplete, exists, forkCascade };
};

export const useAllCascades = () => {
  return useSelector(selectAllCascadeIds);
};