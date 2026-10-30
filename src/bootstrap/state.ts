import type { BootstrapMode } from '../constants.js';

export type BootstrapStatus = 'pending' | 'ready' | 'incompatible' | 'error' | 'off';

export interface BootstrapState {
	status: BootstrapStatus;
	mode: BootstrapMode | null;
	schemaVersion: number | null;
	dataVersion: number | null;
	lastError: string | null;
	readyAt: string | null;
	lastReconcileAt: string | null;
	lastReconcileResult: string | null;
}

const state: BootstrapState = {
	status: 'pending',
	mode: null,
	schemaVersion: null,
	dataVersion: null,
	lastError: null,
	readyAt: null,
	lastReconcileAt: null,
	lastReconcileResult: null,
};

export function getBootstrapState(): Readonly<BootstrapState> {
	return state;
}

export function setBootstrapState(patch: Partial<BootstrapState>): void {
	Object.assign(state, patch);
}

export function resetBootstrapState(): void {
	Object.assign(state, {
		status: 'pending',
		mode: null,
		schemaVersion: null,
		dataVersion: null,
		lastError: null,
		readyAt: null,
		lastReconcileAt: null,
		lastReconcileResult: null,
	} satisfies BootstrapState);
}

export function markReconcileResult(result: string): void {
	state.lastReconcileAt = new Date().toISOString();
	state.lastReconcileResult = result;
}
