export type DataVersionStatus =
	| 'uninitialized'
	| 'current'
	| 'migratable'
	| 'newer'
	| 'invalid';

export interface DataVersionResult {
	status: DataVersionStatus;
	stored: number | null;
	current: number;
	message: string;
}

export function evaluateDataVersion(stored: unknown, current: number): DataVersionResult {
	if (stored === null || stored === undefined || stored === '') {
		return {
			status: 'uninitialized',
			stored: null,
			current,
			message: `No data version recorded; current version is ${current}.`,
		};
	}
	const value =
		typeof stored === 'number'
			? stored
			: typeof stored === 'string' && stored.trim() !== ''
				? Number(stored)
				: Number.NaN;
	if (!Number.isInteger(value) || value < 0) {
		return {
			status: 'invalid',
			stored: null,
			current,
			message: `Invalid data version ${JSON.stringify(stored)}; expected a non-negative integer.`,
		};
	}
	if (value === current) {
		return {
			status: 'current',
			stored: value,
			current,
			message: `Data version ${value} is current.`,
		};
	}
	if (value < current) {
		return {
			status: 'migratable',
			stored: value,
			current,
			message: `Data version ${value} can be migrated to ${current}.`,
		};
	}
	return {
		status: 'newer',
		stored: value,
		current,
		message: `Data version ${value} is newer than this extension (${current}); refusing to modify data.`,
	};
}

export function isReconcileAllowed(
	status: DataVersionStatus,
	mode: 'full' | 'schema' | 'off',
): boolean {
	if (status === 'current' || status === 'uninitialized') return true;
	if (status === 'migratable' && mode === 'full') return true;
	return false;
}
