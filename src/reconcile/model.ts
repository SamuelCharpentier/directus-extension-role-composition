export interface RoleNode {
	id: string;
	parent: string | null;
	compositionKind: string | null;
}

export interface AccessNode {
	role: string | null;
	policy: string | null;
	user?: string | null;
}

export function buildChain(roles: ReadonlyMap<string, RoleNode>, startId: string | null): string[] {
	if (!startId) return [];
	const chain: string[] = [];
	const seen = new Set<string>();
	let current: string | null = startId;
	while (current && !seen.has(current)) {
		const role = roles.get(current);
		if (!role) break;
		seen.add(current);
		chain.push(current);
		current = role.parent;
	}
	return chain;
}

export function policiesForChain(
	roles: ReadonlyMap<string, RoleNode>,
	access: readonly AccessNode[],
	startId: string | null,
): Set<string> {
	const chain = new Set(buildChain(roles, startId));
	const policies = new Set<string>();
	for (const row of access) {
		if (!row.policy || row.user) continue;
		if (row.role && chain.has(row.role)) policies.add(row.policy);
	}
	return policies;
}

