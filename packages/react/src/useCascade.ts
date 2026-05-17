"use client";

import { useDispatch, useSelector } from 'react-redux';
import { useMemo } from 'react';
import {
  AppDispatch,
  forkAndHydrate,
  RootState,
} from '@cascaide-ts/core';
import {
  makeSelectCascadeNodes,
  makeSelectCascadeState,
  selectAllCascadeIds,
} from '@cascaide-ts/core';

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
  const selectCascadeState = useMemo(makeSelectCascadeState, []);
  const selectCascadeNodes = useMemo(makeSelectCascadeNodes, []);
  const dispatch = useDispatch<AppDispatch>();

  const cascadeState = useSelector((state: RootState) =>
    selectCascadeState(state, cascadeId)
  ) as CascadeStateResult | undefined;

  const cascadeNodes = useSelector((state: RootState) =>
    selectCascadeNodes(state, cascadeId)
  ) as CascadeNode[];

  const isComplete = cascadeNodes.length === 0 && cascadeState !== undefined;
  const exists = cascadeState !== undefined || cascadeNodes.length > 0;

  const forkCascade = async (
    newCascadeId: string,
    upToFunctionId: number,
    sourceCascadeId?: string,
  ): Promise<{ status: 'SUCCESS' | 'FAILED' }> => {
    try {
      await dispatch(
        forkAndHydrate({
          sourceCascadeId: sourceCascadeId || cascadeId,
          newCascadeId,
          upToFunctionId,
        })
      );
      return { status: 'SUCCESS' };
    } catch {
      return { status: 'FAILED' };
    }
  };

  return {
    cascadeState,
    cascadeNodes,
    isComplete,
    exists,
    forkCascade,
  };
};

export const useAllCascades = () => {
  return useSelector(selectAllCascadeIds);
};