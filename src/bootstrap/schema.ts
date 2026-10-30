import { LOG_PREFIX } from '../constants.js';
import type {
	ExtensionContext,
	SchemaOverview,
} from '../directus-types.js';
import {
	ALL_COLLECTIONS,
	ALL_RELATIONS,
	ROLE_FIELD_PAYLOADS,
	SYSTEM_FIELD_OVERRIDES,
	UNIQUE_INDEXES,
	REMOVED_UNIQUE_INDEXES,
	type CollectionPayload,
	type FieldPayload,
	type RelationPayload,
} from '../schema.js';
import { COLLECTION, META_KEY, ROLE_FIELD } from '../constants.js';

export interface SchemaEnsureResult {
	createdCollections: string[];
	createdFields: string[];
	createdRelations: string[];
	createdOverrides: string[];
	indexWarnings: string[];
	issues: string[];
}

function hasCollection(schema: SchemaOverview, collection: string): boolean {
	return Object.prototype.hasOwnProperty.call(schema.collections, collection);
}

function hasField(schema: SchemaOverview, collection: string, field: string): boolean {
	return Boolean(schema.collections[collection]?.fields?.[field]);
}

async function ensureCollection(
	ctx: ExtensionContext,
	payload: CollectionPayload,
	schema: SchemaOverview,
	result: SchemaEnsureResult,
): Promise<SchemaOverview> {
	if (hasCollection(schema, payload.collection)) return schema;
	const service = new ctx.services.CollectionsService({ knex: ctx.database, schema });
	await service.createOne({ ...payload, accountability: null });
	result.createdCollections.push(payload.collection);
	ctx.logger.info(`${LOG_PREFIX} Created collection ${payload.collection}.`);
	return ctx.getSchema();
}

async function ensureField(
	ctx: ExtensionContext,
	collection: string,
	payload: FieldPayload,
	schema: SchemaOverview,
	result: SchemaEnsureResult,
): Promise<SchemaOverview> {
	if (!hasCollection(schema, collection)) return schema;
	if (hasField(schema, collection, payload.field)) return schema;
	const service = new ctx.services.FieldsService({ knex: ctx.database, schema });
	await service.createField(collection, payload);
	result.createdFields.push(`${collection}.${payload.field}`);
	ctx.logger.info(`${LOG_PREFIX} Created field ${collection}.${payload.field}.`);
	return ctx.getSchema();
}

async function ensureFieldMeta(
	ctx: ExtensionContext,
	collection: string,
	payload: FieldPayload,
	schema: SchemaOverview,
	result: SchemaEnsureResult,
): Promise<void> {
	if (!payload.meta || !hasField(schema, collection, payload.field)) return;
	const service = new ctx.services.FieldsService({ knex: ctx.database, schema });
	let current: Record<string, unknown>;
	try {
		const field = await service.readOne(collection, payload.field);
		current = (typeof field['meta'] === 'object' && field['meta'] !== null
			? field['meta']
			: field) as Record<string, unknown>;
	} catch {
		return;
	}
	const decode = (value: unknown): unknown => {
		if (typeof value !== 'string') return value;
		try {
			return JSON.parse(value);
		} catch {
			return value;
		}
	};
	const changed = Object.entries(payload.meta).some(
		([key, value]) => JSON.stringify(decode(current[key])) !== JSON.stringify(decode(value)),
	);
	if (!changed) return;
	await service.updateField(collection, {
		field: payload.field,
		meta: { ...current, ...payload.meta },
	});
	result.createdFields.push(`${collection}.${payload.field} (meta)`);
	ctx.logger.info(`${LOG_PREFIX} Updated field meta ${collection}.${payload.field}.`);
}

async function ensureRelation(
	ctx: ExtensionContext,
	payload: RelationPayload,
	schema: SchemaOverview,
	result: SchemaEnsureResult,
): Promise<SchemaOverview> {
	if (!hasCollection(schema, payload.collection)) return schema;
	const exists = schema.relations.some(
		(relation) => relation.collection === payload.collection && relation.field === payload.field,
	);
	const service = new ctx.services.RelationsService({ knex: ctx.database, schema });
	if (exists) {
		const row = (await ctx.database('directus_relations')
			.where({ many_collection: payload.collection, many_field: payload.field })
			.first()) as Record<string, unknown> | undefined;
		const changed = Object.entries(payload.meta).some(
			([key, value]) => JSON.stringify(row?.[key] ?? null) !== JSON.stringify(value ?? null),
		);
		if (changed) {
			await service.updateOne(payload.collection, payload.field, payload);
			result.createdRelations.push(`${payload.collection}.${payload.field} (meta)`);
			ctx.logger.info(`${LOG_PREFIX} Updated relation meta ${payload.collection}.${payload.field}.`);
			return ctx.getSchema();
		}
		return schema;
	}
	await service.createOne(payload);
	result.createdRelations.push(`${payload.collection}.${payload.field}`);
	ctx.logger.info(`${LOG_PREFIX} Created relation ${payload.collection}.${payload.field}.`);
	let next = await ctx.getSchema();
	const persisted = next.relations.some(
		(relation) => relation.collection === payload.collection && relation.field === payload.field,
	);
	if (!persisted) {
		await service.updateOne(payload.collection, payload.field, payload);
		result.createdRelations.push(`${payload.collection}.${payload.field} (metadata fallback)`);
		next = await ctx.getSchema();
	}
	return next;
}

async function ensureSystemFieldOverride(
	ctx: ExtensionContext,
	collection: string,
	field: string,
	patch: { options?: Record<string, unknown>; conditions?: unknown[]; hidden?: boolean; readonly?: boolean },
	schema: SchemaOverview,
	result: SchemaEnsureResult,
): Promise<void> {
	const fields = new ctx.services.FieldsService({ knex: ctx.database, schema });
	const items = new ctx.services.ItemsService('directus_fields', {
		knex: ctx.database,
		schema,
		accountability: null,
	});
	let existing = (await items.readByQuery({
		filter: { collection: { _eq: collection }, field: { _eq: field } },
		limit: 1,
	})) as Array<Record<string, unknown> & { id?: number }>;
	// Older builds wrote overrides before unwrapping the meta envelope and
	// produced rows with empty special/interface. Drop the override once so
	// readOne can fall back to the canonical system definition.
	if (existing[0] && (!existing[0]['special'] || !existing[0]['interface'])) {
		await items.deleteOne(String(existing[0].id), { emitEvents: false });
		existing = [];
	}
	let systemMeta: Record<string, unknown>;
	try {
		const fieldRow = await fields.readOne(collection, field);
		systemMeta = (typeof fieldRow['meta'] === 'object' && fieldRow['meta'] !== null
			? fieldRow['meta']
			: fieldRow) as Record<string, unknown>;
	} catch {
		result.issues.push(`Cannot read system field metadata for ${collection}.${field}.`);
		return;
	}
	const data = {
		collection,
		field,
		special: Array.isArray(systemMeta['special']) ? systemMeta['special'].join(',') : systemMeta['special'] ?? null,
		interface: systemMeta['interface'] ?? null,
		options: {
			...(typeof systemMeta['options'] === 'object' && systemMeta['options'] !== null
				? (systemMeta['options'] as Record<string, unknown>)
				: {}),
			...(patch.options ?? {}),
		},
		display: systemMeta['display'] ?? null,
		display_options: systemMeta['display_options'] ?? null,
		readonly: patch.readonly ?? Boolean(systemMeta['readonly']),
		hidden: patch.hidden ?? Boolean(systemMeta['hidden']),
		sort: systemMeta['sort'] ?? null,
		width: systemMeta['width'] ?? null,
		note: systemMeta['note'] ?? null,
		conditions: patch.conditions ?? systemMeta['conditions'] ?? null,
		required: Boolean(systemMeta['required']),
		searchable: systemMeta['searchable'] !== false,
		translations: systemMeta['translations'] ?? null,
		group: systemMeta['group'] ?? null,
		validation: systemMeta['validation'] ?? null,
		validation_message: systemMeta['validation_message'] ?? null,
	};
	const decode = (value: unknown): unknown => {
		if (typeof value !== 'string') return value;
		try {
			return JSON.parse(value);
		} catch {
			return value;
		}
	};
	const same = (key: string, left: unknown, right: unknown): boolean => {
		if (key === 'special') {
			const normalize = (value: unknown): string => {
				const decoded = decode(value);
				return (Array.isArray(decoded) ? decoded.join(',') : String(decoded ?? '')).trim();
			};
			return normalize(left) === normalize(right);
		}
		return JSON.stringify(decode(left)) === JSON.stringify(decode(right));
	};
	if (
		existing[0] &&
		Object.entries(data).every(([key, value]) => same(key, existing[0]?.[key], value))
	) {
		return;
	}
	if (existing[0]?.id !== undefined) {
		await items.updateOne(String(existing[0].id), data, { emitEvents: false });
	} else {
		await items.createOne(data, { emitEvents: false });
	}
	result.createdOverrides.push(`${collection}.${field}`);
	ctx.logger.info(`${LOG_PREFIX} Wrote system-field override ${collection}.${field}.`);
}

async function prepareLegacyParentsField(
	ctx: ExtensionContext,
	schema: SchemaOverview,
	result: SchemaEnsureResult,
): Promise<SchemaOverview> {
	if (!hasField(schema, 'directus_roles', ROLE_FIELD.parents)) return schema;
	const hasColumn = await ctx.database.schema.hasColumn('directus_roles', ROLE_FIELD.parents);
	let storedVersion = 0;
	if (await ctx.database.schema.hasTable(COLLECTION.meta)) {
		const row = (await ctx.database(COLLECTION.meta).where({ key: META_KEY.dataVersion }).first()) as { value?: unknown } | undefined;
		storedVersion = Number(row?.value ?? 0) || 0;
	}
	if (!hasColumn && storedVersion >= 4) return schema;
	const fields = new ctx.services.FieldsService({ knex: ctx.database, schema });
	if (hasColumn) {
		try {
			await ctx.database.schema.alterTable('directus_roles', (table) => {
				table.renameColumn(ROLE_FIELD.parents, ROLE_FIELD.parentsLegacy);
			});
			await ctx.database('directus_fields')
				.where({ collection: 'directus_roles', field: ROLE_FIELD.parents })
				.update({
					field: ROLE_FIELD.parentsLegacy,
					hidden: true,
					readonly: true,
					note: 'Deprecated JSON storage. Migrated to the native Parents relation.',
				});
			result.createdFields.push(`directus_roles.${ROLE_FIELD.parentsLegacy} (renamed legacy JSON)`);
			ctx.logger.info(`${LOG_PREFIX} Renamed legacy JSON field to ${ROLE_FIELD.parentsLegacy}.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			result.issues.push(`Could not prepare legacy Parents field: ${message}`);
		}
	} else {
		try {
			await fields.deleteField('directus_roles', ROLE_FIELD.parents);
			result.createdFields.push('directus_roles.parents (replaced legacy alias)');
			ctx.logger.info(`${LOG_PREFIX} Removed legacy Parents alias before creating the native relation.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			result.issues.push(`Could not replace legacy Parents alias: ${message}`);
		}
	}
	return ctx.getSchema({ bypassCache: true });
}

async function hideLegacyUi(
	ctx: ExtensionContext,
	schema: SchemaOverview,
	result: SchemaEnsureResult,
): Promise<void> {
	const fields = new ctx.services.FieldsService({ knex: ctx.database, schema });
	for (const field of [ROLE_FIELD.compositionSources, ROLE_FIELD.parentRoles, ROLE_FIELD.parentsLegacy]) {
		if (!hasField(schema, 'directus_roles', field)) continue;
		try {
			const hasColumn = await ctx.database.schema.hasColumn('directus_roles', field);
			if (!hasColumn) {
				await fields.deleteField('directus_roles', field);
				result.createdFields.push(`directus_roles.${field} (removed legacy alias)`);
				ctx.logger.info(`${LOG_PREFIX} Removed legacy alias field directus_roles.${field}.`);
				continue;
			}
			const fieldRow = await fields.readOne('directus_roles', field);
			const meta = (typeof fieldRow['meta'] === 'object' && fieldRow['meta'] !== null
				? fieldRow['meta']
				: fieldRow) as Record<string, unknown>;
			if (meta['hidden'] === true) continue;
			await fields.updateField('directus_roles', {
				field,
				meta: {
					...meta,
					hidden: true,
					readonly: true,
					note: 'Deprecated storage. Use the native Parents field instead.',
				},
			});
			result.createdFields.push(`directus_roles.${field} (hidden legacy)`);
			ctx.logger.info(`${LOG_PREFIX} Hid legacy field directus_roles.${field}.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			result.indexWarnings.push(`legacy field ${field}: ${message}`);
		}
	}
}
async function replaceLegacyParentsField(
	ctx: ExtensionContext,
	schema: SchemaOverview,
	result: SchemaEnsureResult,
): Promise<SchemaOverview> {
	if (!hasField(schema, 'directus_roles', ROLE_FIELD.parents)) return schema;
	const hasColumn = await ctx.database.schema.hasColumn('directus_roles', ROLE_FIELD.parents);
	let storedVersion = 0;
	if (await ctx.database.schema.hasTable(COLLECTION.meta)) {
		const row = (await ctx.database(COLLECTION.meta).where({ key: META_KEY.dataVersion }).first()) as { value?: unknown } | undefined;
		storedVersion = Number(row?.value ?? 0) || 0;
	}
	if (!hasColumn && storedVersion >= 4) return schema;
	if (hasColumn) return schema;
	const fields = new ctx.services.FieldsService({ knex: ctx.database, schema });
	try {
		await fields.deleteField('directus_roles', ROLE_FIELD.parents);
		result.createdFields.push('directus_roles.parents (replaced legacy alias)');
		ctx.logger.info(`${LOG_PREFIX} Replaced legacy alias field directus_roles.parents with JSON.`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		result.issues.push(`Could not replace legacy parents field: ${message}`);
	}
	return ctx.getSchema();
}

export async function ensureSchema(ctx: ExtensionContext): Promise<SchemaEnsureResult> {
	const result: SchemaEnsureResult = {
		createdCollections: [],
		createdFields: [],
		createdRelations: [],
		createdOverrides: [],
		indexWarnings: [],
		issues: [],
	};
	let schema = await ctx.getSchema();

	for (const payload of ALL_COLLECTIONS) {
		schema = await ensureCollection(ctx, payload, schema, result);
	}
	schema = await prepareLegacyParentsField(ctx, schema, result);

	for (const payload of ALL_COLLECTIONS) {
		for (const field of payload.fields) {
			schema = await ensureField(ctx, payload.collection, field, schema, result);
		}
	}
	for (const payload of ALL_COLLECTIONS) {
		for (const field of payload.fields) {
			await ensureFieldMeta(ctx, payload.collection, field, schema, result);
		}
	}
	for (const field of ROLE_FIELD_PAYLOADS) {
		schema = await ensureField(ctx, 'directus_roles', field, schema, result);
	}
	for (const field of ROLE_FIELD_PAYLOADS) {
		await ensureFieldMeta(ctx, 'directus_roles', field, schema, result);
	}

	for (const relation of ALL_RELATIONS) {
		schema = await ensureRelation(ctx, relation, schema, result);
	}

	await hideLegacyUi(ctx, schema, result);

	for (const override of SYSTEM_FIELD_OVERRIDES) {
		await ensureSystemFieldOverride(
			ctx,
			override.collection,
			override.field,
			override.patch,
			schema,
			result,
		);
	}

	for (const index of REMOVED_UNIQUE_INDEXES) {
		try {
			await ctx.database.schema.alterTable(index.collection, (table) => {
				table.dropUnique([], index.name);
			});
		} catch {
			// Already absent or the dialect does not track it by name.
		}
	}

	for (const index of UNIQUE_INDEXES) {
		try {
			await ctx.database.schema.alterTable(index.collection, (table) => {
				table.unique(index.columns, index.name);
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (!/already exists|duplicate|unique constraint/i.test(message)) {
				result.indexWarnings.push(`${index.name}: ${message}`);
				ctx.logger.warn(`${LOG_PREFIX} Could not create index ${index.name}: ${message}`);
			}
		}
	}

	return result;
}

export function validateSchema(schema: SchemaOverview): string[] {
	const issues: string[] = [];
	const requiredCollections = ALL_COLLECTIONS.map((item) => item.collection);
	for (const collection of requiredCollections) {
		if (!hasCollection(schema, collection)) {
			issues.push(`Missing collection ${collection}.`);
			continue;
		}
		const payload = ALL_COLLECTIONS.find((item) => item.collection === collection);
		for (const field of payload?.fields ?? []) {
			if (!hasField(schema, collection, field.field)) {
				issues.push(`Missing field ${collection}.${field.field}.`);
			}
		}
	}
	for (const field of ROLE_FIELD_PAYLOADS) {
		if (!hasField(schema, 'directus_roles', field.field)) {
			issues.push(`Missing field directus_roles.${field.field}.`);
		}
	}
	for (const relation of ALL_RELATIONS) {
		const found = schema.relations.some(
			(item) => item.collection === relation.collection && item.field === relation.field,
		);
		if (!found) issues.push(`Missing relation ${relation.collection}.${relation.field}.`);
	}
	return issues;
}











