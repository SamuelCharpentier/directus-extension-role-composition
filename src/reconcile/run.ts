import { createHash, randomUUID } from 'node:crypto';
import { COLLECTION, COMPOSITION_KIND } from '../constants.js';
import type {
	AccessServiceLike,
	ExtensionContext,
	ItemsServiceLike,
	RolesServiceLike,
	SchemaOverview,
} from '../directus-types.js';
import { buildChain, policiesForChain, type AccessNode, type RoleNode } from './model.js';

interface RoleRow {
	id: string;
	name: string;
	parent: string | null;
	composition_kind: string | null;
}

interface ParentRow {
	id: string;
	role: string;
	parent: string;
	sort: number | null;
}

interface AccessRow {
	id: string;
	role: string | null;
	policy: string | null;
	user: string | null;
}

interface CompositionRow {
	id: string;
	composite_role: string;
	ghost_role: string | null;
	version: number | null;
	status: string | null;
}

interface GhostSetRow {
	id: string;
	key: string;
	ghost_role: string;
	parent_ids: string[] | string | null;
}

interface LedgerRow {
	id: string;
	ghost_role: string;
	policy: string;
	access_id: string;
	link_seq: number;
}

export interface ReconcileSummary {
	roles: number;
	singleParents: number;
	multiParents: number;
	ghostsCreated: number;
	accessCreated: number;
	accessDeleted: number;
	repaired: number;
	errors: string[];
}

interface ReconcileState {
	roles: RoleRow[];
	roleMap: Map<string, RoleNode>;
	access: AccessRow[];
	parents: ParentRow[];
	compositions: CompositionRow[];
	ghostSets: GhostSetRow[];
	ledger: LedgerRow[];
}

function items(ctx: ExtensionContext, schema: SchemaOverview, collection: string): ItemsServiceLike {
	return new ctx.services.ItemsService(collection, { knex: ctx.database, schema, accountability: null });
}

function rolesService(ctx: ExtensionContext, schema: SchemaOverview): RolesServiceLike {
	return new ctx.services.RolesService({ knex: ctx.database, schema, accountability: null });
}

function accessService(ctx: ExtensionContext, schema: SchemaOverview): AccessServiceLike {
	return new ctx.services.AccessService({ knex: ctx.database, schema, accountability: null });
}

function decodeIds(value: GhostSetRow['parent_ids']): string[] {
	if (Array.isArray(value)) return value;
	if (typeof value !== 'string') return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
	} catch {
		return [];
	}
}

async function loadState(ctx: ExtensionContext): Promise<ReconcileState> {
	const roles = (await ctx.database('directus_roles').select('id', 'name', 'parent', 'composition_kind')) as unknown as RoleRow[];
	const access = (await ctx.database('directus_access').select('id', 'role', 'policy', 'user')) as unknown as AccessRow[];
	const parents = (await ctx.database(COLLECTION.parentRoles)
		.select('id', 'role', 'parent', 'sort')
		.orderBy('sort', 'asc')) as unknown as ParentRow[];
	const compositions = (await ctx.database(COLLECTION.composition).select(
		'id',
		'composite_role',
		'ghost_role',
		'version',
		'status',
	)) as unknown as CompositionRow[];
	const ghostSets = (await ctx.database(COLLECTION.ghostSets).select(
		'id',
		'key',
		'ghost_role',
		'parent_ids',
	)) as unknown as GhostSetRow[];
	const ledger = (await ctx.database(COLLECTION.links)
		.select('id', 'ghost_role', 'policy', 'access_id', 'link_seq')
		.orderBy('link_seq', 'asc')) as unknown as LedgerRow[];
	const roleMap = new Map<string, RoleNode>(
		roles.map((role) => [role.id, { id: role.id, parent: role.parent, compositionKind: role.composition_kind }]),
	);
	return { roles, roleMap, access, parents, compositions, ghostSets, ledger };
}

export function ghostKey(parentIds: readonly string[]): string {
	const normalized = [...new Set(parentIds)].sort().join('|');
	return createHash('sha256').update(normalized).digest('hex');
}

function ghostName(names: readonly string[], key: string): string {
	const joined = [...names].sort().join(' + ');
	const suffix = ` (ghost) #${key.slice(0, 6)}`;
	return `Parents: ${joined}`.slice(0, 100 - suffix.length) + suffix;
}

function validParentIds(
	state: ReconcileState,
	roleId: string,
): string[] {
	const rows = state.parents.filter((row) => row.role === roleId);
	const result: string[] = [];
	for (const row of rows) {
		const parent = state.roleMap.get(row.parent);
		if (!parent) continue;
		if (row.parent === roleId) continue;
		if (parent.compositionKind === COMPOSITION_KIND.ghost) continue;
		if (buildChain(state.roleMap, row.parent).includes(roleId)) continue;
		if (!result.includes(row.parent)) result.push(row.parent);
	}
	return result;
}

async function ensureGhostSet(
	ctx: ExtensionContext,
	schema: SchemaOverview,
	state: ReconcileState,
	parentIds: string[],
	summary: ReconcileSummary,
): Promise<string> {
	const key = ghostKey(parentIds);
	const parentNames = parentIds
		.map((id) => state.roles.find((role) => role.id === id)?.name)
		.filter((name): name is string => Boolean(name));
	const desiredName = ghostName(parentNames, key);
	const existing = state.ghostSets.find((row) => row.key === key);
	if (existing) {
		const role = state.roles.find((item) => item.id === existing.ghost_role);
		if (role && role.composition_kind === COMPOSITION_KIND.ghost) {
			if (role.name !== desiredName) {
				await rolesService(ctx, schema).updateOne(role.id, { name: desiredName }, { emitEvents: false });
				role.name = desiredName;
			}
			return role.id;
		}
	}
	const id = await rolesService(ctx, schema).createOne(
		{
			name: desiredName,
			icon: 'account_tree',
			description: 'System role combining multiple Parents. Managed by role-composition.',
			parent: null,
			composition_kind: COMPOSITION_KIND.ghost,
		},
		{ emitEvents: false },
	);
	summary.ghostsCreated += 1;
	state.roles.push({
		id,
		name: desiredName,
		parent: null,
		composition_kind: COMPOSITION_KIND.ghost,
	});
	state.roleMap.set(id, { id, parent: null, compositionKind: COMPOSITION_KIND.ghost });
	const service = items(ctx, schema, COLLECTION.ghostSets);
	if (existing) {
		await service.updateOne(
			existing.id,
			{ ghost_role: id, parent_ids: parentIds },
			{ emitEvents: false },
		);
		existing.ghost_role = id;
		existing.parent_ids = parentIds;
	} else {
		const row = {
			id: randomUUID(),
			key,
			ghost_role: id,
			parent_ids: parentIds,
			created_at: new Date().toISOString(),
		};
		await service.createOne(row, { emitEvents: false });
		state.ghostSets.push(row as GhostSetRow);
	}
	return id;
}

async function syncGhostAccess(
	ctx: ExtensionContext,
	schema: SchemaOverview,
	ghostId: string,
	requiredPolicies: string[],
	state: ReconcileState,
	summary: ReconcileSummary,
): Promise<void> {
	const access = accessService(ctx, schema);
	const links = items(ctx, schema, COLLECTION.links);
	const ghostAccess = state.access.filter((row) => row.role === ghostId && !row.user);
	const ghostLedger = state.ledger.filter((row) => row.ghost_role === ghostId);
	const required = new Set(requiredPolicies);
	const byPolicy = new Map<string, AccessRow[]>();
	for (const row of ghostAccess) {
		if (!row.policy) continue;
		const list = byPolicy.get(row.policy) ?? [];
		list.push(row);
		byPolicy.set(row.policy, list);
	}
	const ledgerByPolicy = new Map<string, LedgerRow[]>();
	for (const row of ghostLedger) {
		const list = ledgerByPolicy.get(row.policy) ?? [];
		list.push(row);
		ledgerByPolicy.set(row.policy, list);
	}
	let nextSeq = state.ledger.reduce((max, row) => Math.max(max, row.link_seq), 0) + 1;

	for (const policy of new Set([...ledgerByPolicy.keys()].filter((id) => !required.has(id)))) {
		const rows = ledgerByPolicy.get(policy) ?? [];
		const accessIds = [...new Set(rows.map((row) => row.access_id))].filter((id) =>
			state.access.some((accessRow) => accessRow.id === id),
		);
		if (accessIds.length > 0) {
			await access.deleteMany(accessIds, { emitEvents: false });
			summary.accessDeleted += accessIds.length;
		}
		for (const row of rows) {
			await links.deleteOne(row.id, { emitEvents: false });
		}
	}
	const strayAccess = ghostAccess.filter(
		(row) => row.policy && !required.has(row.policy) && !ledgerByPolicy.has(row.policy),
	);
	if (strayAccess.length > 0) {
		await access.deleteMany(strayAccess.map((row) => row.id), { emitEvents: false });
		summary.accessDeleted += strayAccess.length;
	}

	for (const policy of requiredPolicies) {
		const existingLedger = ledgerByPolicy.get(policy) ?? [];
		const existingAccess = byPolicy.get(policy) ?? [];
		if (existingLedger.length > 0) {
			const keep = existingLedger[0];
			if (!keep) continue;
			for (const row of existingLedger.slice(1)) {
				await links.deleteOne(row.id, { emitEvents: false });
				summary.repaired += 1;
			}
			if (!existingAccess.some((row) => row.id === keep.access_id)) {
				const adopted = existingAccess[0];
				if (adopted) {
					await links.updateOne(
						keep.id,
						{ access_id: adopted.id, link_seq: nextSeq++ },
						{ emitEvents: false },
					);
					summary.repaired += 1;
				} else {
					const accessId = await access.createOne({ role: ghostId, policy }, { emitEvents: false });
					await links.updateOne(
						keep.id,
						{ access_id: accessId, link_seq: nextSeq++ },
						{ emitEvents: false },
					);
					state.access.push({ id: accessId, role: ghostId, policy, user: null });
					summary.accessCreated += 1;
					summary.repaired += 1;
				}
			}
			continue;
		}
		let accessId = existingAccess[0]?.id;
		if (!accessId) {
			accessId = await access.createOne({ role: ghostId, policy }, { emitEvents: false });
			state.access.push({ id: accessId, role: ghostId, policy, user: null });
			summary.accessCreated += 1;
		}
		await links.createOne(
			{ id: randomUUID(), ghost_role: ghostId, policy, access_id: accessId, link_seq: nextSeq++ },
			{ emitEvents: false },
		);
	}
}

async function setRole(
	ctx: ExtensionContext,
	schema: SchemaOverview,
	state: ReconcileState,
	role: RoleRow,
	parent: string | null,
	kind: string | null,
): Promise<void> {
	if ((role.parent ?? null) === parent && (role.composition_kind ?? null) === kind) return;
	await rolesService(ctx, schema).updateOne(role.id, { parent, composition_kind: kind }, { emitEvents: false });
	role.parent = parent;
	role.composition_kind = kind;
	const node = state.roleMap.get(role.id);
	if (node) {
		node.parent = parent;
		node.compositionKind = kind;
	}
}

async function upsertComposition(
	ctx: ExtensionContext,
	schema: SchemaOverview,
	state: ReconcileState,
	role: RoleRow,
	ghostId: string,
): Promise<void> {
	const service = items(ctx, schema, COLLECTION.composition);
	const existing = state.compositions.find((row) => row.composite_role === role.id);
	const payload = {
		ghost_role: ghostId,
		selected_parent: null,
		status: 'ok',
		conflict_reason: [],
		last_reconciled_at: new Date().toISOString(),
		last_error: null,
		version: (existing?.version ?? 0) + 1,
	};
	if (existing) {
		await service.updateOne(existing.id, payload, { emitEvents: false });
		existing.ghost_role = ghostId;
	} else {
		const id = randomUUID();
		await service.createOne({ id, composite_role: role.id, ...payload }, { emitEvents: false });
		state.compositions.push({
			id,
			composite_role: role.id,
			ghost_role: ghostId,
			version: 1,
			status: 'ok',
		});
	}
}

async function deleteComposition(
	ctx: ExtensionContext,
	schema: SchemaOverview,
	state: ReconcileState,
	existing: CompositionRow,
): Promise<void> {
	await items(ctx, schema, COLLECTION.composition).deleteOne(existing.id, { emitEvents: false });
	state.compositions = state.compositions.filter((row) => row.id !== existing.id);
}

export async function reconcileAll(ctx: ExtensionContext): Promise<ReconcileSummary> {
	const schema = await ctx.getSchema();
	const state = await loadState(ctx);
	const summary: ReconcileSummary = {
		roles: 0,
		singleParents: 0,
		multiParents: 0,
		ghostsCreated: 0,
		accessCreated: 0,
		accessDeleted: 0,
		repaired: 0,
		errors: [],
	};

	const managed = state.roles.filter((role) => role.composition_kind !== COMPOSITION_KIND.ghost);
	const desiredByRole = new Map<string, string[]>();
	for (const role of managed) {
		desiredByRole.set(role.id, validParentIds(state, role.id));
	}

	// Remove invalid selections (missing/ghost/self/cyclic parents) so the
	// field cannot retain a selection the extension refuses to honor.
	for (const row of state.parents) {
		const desired = desiredByRole.get(row.role) ?? [];
		if (!desired.includes(row.parent)) {
			await items(ctx, schema, COLLECTION.parentRoles).deleteOne(row.id, { emitEvents: false });
		}
	}

	const byGhostKey = new Map<string, string[]>();
	for (const parentIds of desiredByRole.values()) {
		if (parentIds.length <= 1) continue;
		byGhostKey.set(ghostKey(parentIds), parentIds);
	}
	const ghostByKey = new Map<string, string>();
	for (const [key, parentIds] of byGhostKey) {
		try {
			const ghostId = await ensureGhostSet(ctx, schema, state, parentIds, summary);
			ghostByKey.set(key, ghostId);
			const required = new Set<string>();
			for (const parentId of parentIds) {
				for (const policy of policiesForChain(state.roleMap, state.access, parentId)) {
					required.add(policy);
				}
			}
			await syncGhostAccess(ctx, schema, ghostId, [...required].sort(), state, summary);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			summary.errors.push(`ghost ${key.slice(0, 8)}: ${message}`);
		}
	}

	for (const role of managed) {
		try {
			const parentIds = desiredByRole.get(role.id) ?? [];
			if (parentIds.length === 0) {
				await setRole(ctx, schema, state, role, null, null);
				const existing = state.compositions.find((row) => row.composite_role === role.id);
				if (existing) await deleteComposition(ctx, schema, state, existing);
				summary.roles += 1;
			} else if (parentIds.length === 1) {
				await setRole(ctx, schema, state, role, parentIds[0] ?? null, null);
				const existing = state.compositions.find((row) => row.composite_role === role.id);
				if (existing) await deleteComposition(ctx, schema, state, existing);
				summary.singleParents += 1;
				summary.roles += 1;
			} else {
				const ghostId = ghostByKey.get(ghostKey(parentIds));
				if (!ghostId) continue;
				await setRole(ctx, schema, state, role, ghostId, COMPOSITION_KIND.composite);
				await upsertComposition(ctx, schema, state, role, ghostId);
				summary.multiParents += 1;
				summary.roles += 1;
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			summary.errors.push(`${role.name}: ${message}`);
			const existing = state.compositions.find((row) => row.composite_role === role.id);
			if (existing) {
				await items(ctx, schema, COLLECTION.composition)
					.updateOne(
						existing.id,
						{ status: 'error', last_error: message, last_reconciled_at: new Date().toISOString() },
						{ emitEvents: false },
					)
					.catch(() => undefined);
			}
		}
	}

	const usedGhostIds = new Set(
		[...desiredByRole.values()]
			.filter((ids) => ids.length > 1)
			.map((ids) => ghostByKey.get(ghostKey(ids)))
			.filter((id): id is string => Boolean(id)),
	);
	for (const ghostSet of [...state.ghostSets]) {
		if (usedGhostIds.has(ghostSet.ghost_role)) continue;
		const ghost = state.roles.find((role) => role.id === ghostSet.ghost_role);
		if (ghost) {
			const hasUsers = await ctx.database('directus_users').where({ role: ghost.id }).first();
			if (!hasUsers) {
				await rolesService(ctx, schema).deleteOne(ghost.id, { emitEvents: false });
				summary.repaired += 1;
			}
		}
		await items(ctx, schema, COLLECTION.ghostSets)
			.deleteOne(ghostSet.id, { emitEvents: false })
			.catch(() => undefined);
		state.ghostSets = state.ghostSets.filter((row) => row.id !== ghostSet.id);
	}

	// Legacy or orphaned ghost roles that are not in the shared registry.
	const registryGhosts = new Set(state.ghostSets.map((row) => row.ghost_role));
	for (const role of state.roles) {
		if (role.composition_kind !== COMPOSITION_KIND.ghost) continue;
		if (registryGhosts.has(role.id)) continue;
		const hasUsers = await ctx.database('directus_users').where({ role: role.id }).first();
		if (hasUsers) continue;
		await rolesService(ctx, schema).deleteOne(role.id, { emitEvents: false });
		summary.repaired += 1;
	}

	return summary;
}










