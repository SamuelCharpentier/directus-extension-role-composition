import { randomUUID } from 'node:crypto';
import { CURRENT_DATA_VERSION, ENV, LOG_PREFIX, META_KEY, COLLECTION, COMPOSITION_KIND } from '../constants.js';
import type { ExtensionContext } from '../directus-types.js';
import { resolveBootstrapMode, resolveReconcileIntervalSeconds, resolveReconcileOnStart } from './mode.js';
import { readDataVersion, readMeta, writeVersionRows } from './meta.js';
import { ensureSchema, validateSchema } from './schema.js';
import {
	setBootstrapState,
} from './state.js';
import { evaluateDataVersion } from './version.js';
import { EXTENSION_VERSION, CURRENT_SCHEMA_VERSION } from '../version.js';
import { requestReconcile, startReconcileWorker } from '../reconcile/worker.js';

let bootstrapRan = false;
let bootstrapInFlight: Promise<void> | null = null;

interface Migration {
	from: number;
	to: number;
	run: (ctx: ExtensionContext) => Promise<void>;
}

function decodeIds(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
	if (typeof value !== 'string' || !value.trim()) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
	} catch {
		return [];
	}
}

const MIGRATIONS: readonly Migration[] = [
	{
		from: 0,
		to: 1,
		run: async (ctx) => {
			ctx.logger.info(`${LOG_PREFIX} Applying data migration 0 -> 1 (no-op; initial shape).`);
		},
	},
	{
		from: 1,
		to: 2,
		run: async (ctx) => {
			ctx.logger.info(`${LOG_PREFIX} Applying data migration 1 -> 2 (legacy junction marker).`);
		},
	},
	{
		from: 2,
		to: 3,
		run: async (ctx) => {
			ctx.logger.info(`${LOG_PREFIX} Applying data migration 2 -> 3 (legacy JSON marker).`);
		},
	},
	{
		from: 3,
		to: 4,
		run: async (ctx) => {
			const roles = (await ctx.database('directus_roles')
				.select('id', 'parent', 'composition_kind')) as Array<{
				id: string;
				parent: string | null;
				composition_kind: string | null;
			}>;
			const roleKinds = new Map(roles.map((role) => [role.id, role.composition_kind]));
			const jsonByRole = new Map<string, string[]>();
			if (await ctx.database.schema.hasColumn('directus_roles', 'parents_legacy')) {
				const rows = (await ctx.database('directus_roles')
					.select('id', 'parents_legacy')) as Array<{ id: string; parents_legacy: unknown }>;
				for (const row of rows) {
					const list = decodeIds(row.parents_legacy);
					if (list.length > 0) jsonByRole.set(row.id, list);
				}
			}
			const byRole = new Map<string, string[]>();
			if (await ctx.database.schema.hasTable(COLLECTION.parents)) {
				const rows = (await ctx.database(COLLECTION.parents)
					.select('role', 'parent', 'sort')
					.orderBy('sort', 'asc')) as Array<{ role: string; parent: string; sort: number | null }>;
				for (const row of rows) {
					const list = byRole.get(row.role) ?? [];
					if (!list.includes(row.parent)) list.push(row.parent);
					byRole.set(row.role, list);
				}
			} else if (await ctx.database.schema.hasTable(COLLECTION.sources)) {
				const rows = (await ctx.database(COLLECTION.sources)
					.select('composite_role', 'source_role', 'sort')
					.orderBy('sort', 'asc')) as Array<{
					composite_role: string;
					source_role: string;
					sort: number | null;
				}>;
				for (const row of rows) {
					const list = byRole.get(row.composite_role) ?? [];
					if (!list.includes(row.source_role)) list.push(row.source_role);
					byRole.set(row.composite_role, list);
				}
			}
			const existing = (await ctx.database(COLLECTION.parentRoles)
				.select('role', 'parent')) as Array<{ role: string; parent: string }>;
			const seen = new Set(existing.map((row) => `${row.role}|${row.parent}`));
			let migrated = 0;
			for (const role of roles) {
				if (role.composition_kind === COMPOSITION_KIND.ghost) continue;
				const ids = jsonByRole.get(role.id) ?? byRole.get(role.id) ?? [];
				if (ids.length === 0 && role.parent && roleKinds.get(role.parent) !== COMPOSITION_KIND.ghost) {
					ids.push(role.parent);
				}
				for (const [index, parent] of ids.entries()) {
					if (seen.has(`${role.id}|${parent}`)) continue;
					seen.add(`${role.id}|${parent}`);
					await ctx.database(COLLECTION.parentRoles).insert({
						id: randomUUID(),
						role: role.id,
						parent,
						sort: index + 1,
					});
					migrated += 1;
				}
			}
			ctx.logger.info(`${LOG_PREFIX} Migrated ${migrated} Parent selection(s) to the native relation.`);
		},
	},
];

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function kickBootstrap(ctx: ExtensionContext): Promise<void> {
	if (bootstrapRan) return Promise.resolve();
	if (bootstrapInFlight) return bootstrapInFlight;
	bootstrapInFlight = runBootstrap(ctx).catch((error) => {
		const message = errorMessage(error);
		setBootstrapState({ status: 'error', lastError: message });
		ctx.logger.error(`${LOG_PREFIX} Bootstrap failed: ${message}`);
	}).finally(() => {
		bootstrapInFlight = null;
		bootstrapRan = true;
	});
	return bootstrapInFlight;
}

export async function runBootstrap(ctx: ExtensionContext): Promise<void> {
	const mode = resolveBootstrapMode(ctx.env[ENV.bootstrap], ctx.logger);
	const intervalSeconds = resolveReconcileIntervalSeconds(ctx.env[ENV.interval], ctx.logger);
	setBootstrapState({ mode, status: 'pending', lastError: null });
	ctx.logger.info(`${LOG_PREFIX} Bootstrap started (mode=${mode}, interval=${intervalSeconds}s).`);

	if (mode === 'off') {
		const issues = validateSchema(await ctx.getSchema());
		if (issues.length > 0) {
			setBootstrapState({ status: 'incompatible', lastError: issues.join(' ') });
			ctx.logger.error(`${LOG_PREFIX} Bootstrap disabled and schema is incompatible: ${issues.join(' ')}`);
			return;
		}
		setBootstrapState({ status: 'off', readyAt: new Date().toISOString() });
		ctx.logger.info(`${LOG_PREFIX} Bootstrap disabled (${ENV.bootstrap}=off); schema is compatible.`);
		return;
	}

	let schema = await ctx.getSchema();
	const ensure = await ensureSchema(ctx);
	schema = await ctx.getSchema();
	const issues = [...ensure.issues, ...validateSchema(schema)];
	if (issues.length > 0) {
		setBootstrapState({ status: 'incompatible', lastError: issues.join(' ') });
		ctx.logger.error(`${LOG_PREFIX} Schema is incompatible: ${issues.join(' ')}`);
		return;
	}

	const stored = await readDataVersion(ctx, schema);
	const version = evaluateDataVersion(stored, CURRENT_DATA_VERSION);
	if (version.status === 'newer' || version.status === 'invalid') {
		setBootstrapState({ status: 'incompatible', dataVersion: version.stored, lastError: version.message });
		ctx.logger.error(`${LOG_PREFIX} ${version.message}`);
		return;
	}
	if (mode === 'schema' && version.status === 'migratable') {
		const message = `Data version ${version.stored} requires a data migration, but bootstrap mode is "schema". Run mode "full" or import migrated data.`;
		setBootstrapState({ status: 'incompatible', dataVersion: version.stored, lastError: message });
		ctx.logger.error(`${LOG_PREFIX} ${message}`);
		return;
	}

	let finalVersion = version.stored;
	if (mode === 'full') {
		if (version.status === 'uninitialized') {
			finalVersion = CURRENT_DATA_VERSION;
		} else if (version.status === 'migratable') {
			let current = version.stored as number;
			while (current < CURRENT_DATA_VERSION) {
				const migration = MIGRATIONS.find((item) => item.from === current);
				if (!migration) {
					const message = `No migration path from data version ${current} to ${CURRENT_DATA_VERSION}.`;
					setBootstrapState({ status: 'incompatible', dataVersion: current, lastError: message });
					ctx.logger.error(`${LOG_PREFIX} ${message}`);
					return;
				}
				await migration.run(ctx);
				current = migration.to;
			}
			finalVersion = current;
		}
		await writeVersionRows(ctx, schema, finalVersion ?? CURRENT_DATA_VERSION, CURRENT_SCHEMA_VERSION, EXTENSION_VERSION);
	}

	const schemaVersionRaw = mode === 'schema' ? await readMeta(ctx, schema, META_KEY.schemaVersion) : CURRENT_SCHEMA_VERSION;
	const schemaVersion = Number.isInteger(Number(schemaVersionRaw)) ? Number(schemaVersionRaw) : null;
	setBootstrapState({
		status: 'ready',
		schemaVersion,
		dataVersion: finalVersion,
		readyAt: new Date().toISOString(),
	});
	ctx.logger.info(
		`${LOG_PREFIX} Bootstrap ready (mode=${mode}, schema=${schemaVersion ?? 'unknown'}, data=${finalVersion ?? 'unknown'}, created=${ensure.createdCollections.length} collections, ${ensure.createdFields.length} fields, ${ensure.createdRelations.length} relations).`,
	);
	startReconcileWorker(ctx, intervalSeconds);
	if (resolveReconcileOnStart(ctx.env[ENV.reconcileOnStart])) {
		// Startup reconcile is deliberately asynchronous; it runs after
		// bootstrap and never inside a Directus transaction.
		setTimeout(() => {
			void requestReconcile('startup');
		}, 0);
	}
}

export function resetBootstrapForTests(): void {
	bootstrapRan = false;
	bootstrapInFlight = null;
}








