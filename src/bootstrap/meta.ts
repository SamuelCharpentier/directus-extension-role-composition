import { COLLECTION, META_KEY } from '../constants.js';
import type { ExtensionContext, SchemaOverview } from '../directus-types.js';

export interface MetaRow {
	key: string;
	value: unknown;
}

function metaService(ctx: ExtensionContext, schema: SchemaOverview) {
	return new ctx.services.ItemsService(COLLECTION.meta, {
		knex: ctx.database,
		schema,
		accountability: null,
	});
}

export async function readMeta(
	ctx: ExtensionContext,
	schema: SchemaOverview,
	key: string,
): Promise<unknown> {
	try {
		const rows = (await metaService(ctx, schema).readByQuery({
			filter: { key: { _eq: key } },
			limit: 1,
		})) as unknown as MetaRow[];
		const value = rows[0]?.value ?? null;
		if (typeof value !== 'string') return value;
		try {
			return JSON.parse(value);
		} catch {
			return value;
		}
	} catch {
		return null;
	}
}

export async function writeMeta(
	ctx: ExtensionContext,
	schema: SchemaOverview,
	key: string,
	value: unknown,
): Promise<void> {
	const service = metaService(ctx, schema);
	const stored = typeof value === 'string' ? value : JSON.stringify(value);
	const existing = (await service.readByQuery({
		filter: { key: { _eq: key } },
		limit: 1,
	})) as unknown as MetaRow[];
	if (existing.length > 0) {
		await service.updateOne(key, { value: stored }, { emitEvents: false });
	} else {
		await service.createOne({ key, value: stored }, { emitEvents: false });
	}
}

export async function readDataVersion(
	ctx: ExtensionContext,
	schema: SchemaOverview,
): Promise<unknown> {
	return readMeta(ctx, schema, META_KEY.dataVersion);
}

export async function writeVersionRows(
	ctx: ExtensionContext,
	schema: SchemaOverview,
	dataVersion: number,
	schemaVersion: number,
	extensionVersion: string,
): Promise<void> {
	await writeMeta(ctx, schema, META_KEY.dataVersion, dataVersion);
	await writeMeta(ctx, schema, META_KEY.schemaVersion, schemaVersion);
	await writeMeta(ctx, schema, META_KEY.extensionVersion, extensionVersion);
}

export async function collectionHasRows(
	ctx: ExtensionContext,
	schema: SchemaOverview,
	collection: string,
): Promise<boolean> {
	try {
		const rows = await new ctx.services.ItemsService(collection, {
			knex: ctx.database,
			schema,
			accountability: null,
		}).readByQuery({ limit: 1 });
		return rows.length > 0;
	} catch {
		return false;
	}
}
