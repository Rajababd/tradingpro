import { useSyncExternalStore } from 'react';
import type { IndicatorWorkspace, WorkspaceSnapshot } from '../indicators/IndicatorWorkspace';

export const EMPTY_WORKSPACE: WorkspaceSnapshot = { indicators: [], smas: [] };
const NO_SUBSCRIPTION = () => () => {};

/** Subscribes React to the workspace's snapshots (stable between changes). */
export function useWorkspaceSnapshot(workspace: IndicatorWorkspace | null): WorkspaceSnapshot {
  return useSyncExternalStore(workspace ? workspace.subscribe : NO_SUBSCRIPTION, workspace ? workspace.getSnapshot : () => EMPTY_WORKSPACE);
}
