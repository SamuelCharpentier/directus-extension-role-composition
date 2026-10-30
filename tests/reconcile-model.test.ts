import { describe, expect, it } from 'vitest';
import {
	buildChain,
	policiesForChain,
	type AccessNode,
	type RoleNode,
} from '../src/reconcile/model.js';

function roles(entries: Array<[string, Partial<RoleNode>?]>): Map<string, RoleNode> {
	return new Map(
		entries.map(([id, role]) => [
			id,
			{ id, parent: role?.parent ?? null, compositionKind: role?.compositionKind ?? null },
		]),
	);
}

describe('buildChain', () => {
	it('walks parents from leaf to root', () => {
		const map = roles([['a', { parent: 'b' }], ['b', { parent: 'c' }], ['c']]);
		expect(buildChain(map, 'a')).toEqual(['a', 'b', 'c']);
	});

	it('stops safely on cycles and missing parents', () => {
		const map = roles([['a', { parent: 'b' }], ['b', { parent: 'a' }], ['x', { parent: 'missing' }]]);
		expect(buildChain(map, 'a')).toEqual(['a', 'b']);
		expect(buildChain(map, 'x')).toEqual(['x']);
		expect(buildChain(map, null)).toEqual([]);
	});
});

describe('policiesForChain', () => {
	const map = roles([['a', { parent: 'b' }], ['b']]);
	const access: AccessNode[] = [
		{ role: 'a', policy: 'p1' },
		{ role: 'b', policy: 'p2' },
		{ role: 'b', policy: 'p2' },
		{ role: 'b', policy: 'p3', user: 'u1' },
		{ role: null, policy: 'public' },
	];

	it('returns distinct policy ids from the whole chain', () => {
		expect([...policiesForChain(map, access, 'a')].sort()).toEqual(['p1', 'p2']);
	});

	it('ignores user-scoped and public rows', () => {
		expect([...policiesForChain(map, access, 'b')]).toEqual(['p2']);
	});
});

