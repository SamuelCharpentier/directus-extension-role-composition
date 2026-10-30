import { describe, expect, it } from 'vitest';
import { evaluateDataVersion, isReconcileAllowed } from '../src/bootstrap/version.js';

describe('evaluateDataVersion', () => {
	it('reports uninitialized for missing values', () => {
		expect(evaluateDataVersion(null, 1).status).toBe('uninitialized');
		expect(evaluateDataVersion(undefined, 1).status).toBe('uninitialized');
		expect(evaluateDataVersion('', 1).status).toBe('uninitialized');
	});

	it('accepts numeric and numeric-string current versions', () => {
		expect(evaluateDataVersion(1, 1).status).toBe('current');
		expect(evaluateDataVersion('1', 1).status).toBe('current');
	});

	it('detects an older version as migratable', () => {
		const result = evaluateDataVersion(0, 1);
		expect(result.status).toBe('migratable');
		expect(result.stored).toBe(0);
	});

	it('refuses a newer version', () => {
		expect(evaluateDataVersion(2, 1).status).toBe('newer');
	});

	it('rejects malformed versions', () => {
		expect(evaluateDataVersion('v1', 1).status).toBe('invalid');
		expect(evaluateDataVersion(-1, 1).status).toBe('invalid');
		expect(evaluateDataVersion({}, 1).status).toBe('invalid');
	});
});

describe('isReconcileAllowed', () => {
	it('allows current data in every mode', () => {
		expect(isReconcileAllowed('current', 'full')).toBe(true);
		expect(isReconcileAllowed('current', 'schema')).toBe(true);
		expect(isReconcileAllowed('current', 'off')).toBe(true);
	});

	it('allows uninitialized data for a first boot', () => {
		expect(isReconcileAllowed('uninitialized', 'full')).toBe(true);
		expect(isReconcileAllowed('uninitialized', 'schema')).toBe(true);
	});

	it('only allows migratable data in full mode', () => {
		expect(isReconcileAllowed('migratable', 'full')).toBe(true);
		expect(isReconcileAllowed('migratable', 'schema')).toBe(false);
		expect(isReconcileAllowed('migratable', 'off')).toBe(false);
	});

	it('refuses newer and invalid data', () => {
		expect(isReconcileAllowed('newer', 'full')).toBe(false);
		expect(isReconcileAllowed('invalid', 'full')).toBe(false);
	});
});
