import { describe, expect, it } from 'vitest';
import {
	resolveBootstrapMode,
	resolveReconcileIntervalSeconds,
	resolveReconcileOnStart,
} from '../src/bootstrap/mode.js';

describe('resolveBootstrapMode', () => {
	it('defaults to full', () => {
		expect(resolveBootstrapMode(undefined)).toBe('full');
		expect(resolveBootstrapMode('')).toBe('full');
	});

	it('accepts the three documented modes case-insensitively', () => {
		expect(resolveBootstrapMode('full')).toBe('full');
		expect(resolveBootstrapMode(' SCHEMA ')).toBe('schema');
		expect(resolveBootstrapMode('off')).toBe('off');
	});

	it('warns and falls back on an unknown mode', () => {
		const warnings: string[] = [];
		const logger = {
			info: () => undefined,
			warn: (message: string) => warnings.push(message),
			error: () => undefined,
		};
		expect(resolveBootstrapMode('chaos', logger)).toBe('full');
		expect(warnings).toHaveLength(1);
	});
});

describe('resolveReconcileIntervalSeconds', () => {
	it('uses the default when unset or invalid', () => {
		expect(resolveReconcileIntervalSeconds(undefined)).toBe(60);
		expect(resolveReconcileIntervalSeconds('')).toBe(60);
		expect(resolveReconcileIntervalSeconds('nope')).toBe(60);
	});

	it('clamps to the minimum', () => {
		expect(resolveReconcileIntervalSeconds('1')).toBe(5);
	});

	it('floors valid values', () => {
		expect(resolveReconcileIntervalSeconds('42.9')).toBe(42);
	});
});

describe('resolveReconcileOnStart', () => {
	it('defaults to true and parses falsey values', () => {
		expect(resolveReconcileOnStart(undefined)).toBe(true);
		expect(resolveReconcileOnStart('false')).toBe(false);
		expect(resolveReconcileOnStart('0')).toBe(false);
		expect(resolveReconcileOnStart('yes')).toBe(true);
	});
});
