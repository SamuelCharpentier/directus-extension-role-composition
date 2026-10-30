import { describe, expect, it } from 'vitest';
import { ghostKey } from '../src/reconcile/run.js';

describe('ghostKey', () => {
	it('is stable regardless of selection order', () => {
		expect(ghostKey(['b', 'a'])).toBe(ghostKey(['a', 'b']));
	});

	it('deduplicates repeated ids', () => {
		expect(ghostKey(['a', 'a', 'b'])).toBe(ghostKey(['a', 'b']));
	});

	it('changes when the parent set changes', () => {
		expect(ghostKey(['a', 'b'])).not.toBe(ghostKey(['a', 'c']));
	});
});
