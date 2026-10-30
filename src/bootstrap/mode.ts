import {
	BOOTSTRAP_MODES,
	DEFAULT_BOOTSTRAP_MODE,
	DEFAULT_RECONCILE_INTERVAL_SECONDS,
	MIN_RECONCILE_INTERVAL_SECONDS,
	type BootstrapMode,
} from '../constants.js';

export interface BootstrapLogger {
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
}

export function resolveBootstrapMode(raw: unknown, logger?: BootstrapLogger): BootstrapMode {
	if (typeof raw !== 'string' || raw.trim() === '') return DEFAULT_BOOTSTRAP_MODE;
	const value = raw.trim().toLowerCase();
	if ((BOOTSTRAP_MODES as readonly string[]).includes(value)) return value as BootstrapMode;
	logger?.warn(
		`Unknown bootstrap mode "${raw}"; expected one of ${BOOTSTRAP_MODES.join(', ')}. Falling back to "${DEFAULT_BOOTSTRAP_MODE}".`,
	);
	return DEFAULT_BOOTSTRAP_MODE;
}

export function resolveReconcileIntervalSeconds(raw: unknown, logger?: BootstrapLogger): number {
	const parsed = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : Number.NaN;
	if (!Number.isFinite(parsed) || parsed <= 0) {
		if (raw !== undefined && raw !== '') {
			logger?.warn(
				`Invalid reconcile interval "${String(raw)}"; using ${DEFAULT_RECONCILE_INTERVAL_SECONDS}s.`,
			);
		}
		return DEFAULT_RECONCILE_INTERVAL_SECONDS;
	}
	if (parsed < MIN_RECONCILE_INTERVAL_SECONDS) {
		logger?.warn(
			`Reconcile interval ${parsed}s is below the ${MIN_RECONCILE_INTERVAL_SECONDS}s minimum; using ${MIN_RECONCILE_INTERVAL_SECONDS}s.`,
		);
		return MIN_RECONCILE_INTERVAL_SECONDS;
	}
	return Math.floor(parsed);
}

export function resolveReconcileOnStart(raw: unknown): boolean {
	if (typeof raw !== 'string') return true;
	return !['0', 'false', 'off', 'no'].includes(raw.trim().toLowerCase());
}
