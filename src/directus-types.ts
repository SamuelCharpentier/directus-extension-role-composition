import type { BootstrapLogger } from './bootstrap/mode.js';

export interface Logger extends BootstrapLogger {
	debug?(message: string): void;
}

export interface SchemaOverview {
	collections: Record<string, { fields: Record<string, unknown> }>;
	relations: Array<{ collection: string; field: string; related_collection?: string | null }>;
}

export interface ServiceOptions {
	knex: unknown;
	schema: SchemaOverview;
	accountability?: unknown;
}

export interface CollectionsServiceLike {
	createOne(payload: unknown): Promise<unknown>;
}

export interface FieldsServiceLike {
	createField(collection: string, field: unknown): Promise<unknown>;
	updateField(collection: string, field: unknown): Promise<unknown>;
	deleteField(collection: string, field: string): Promise<unknown>;
	readOne(collection: string, field: string): Promise<Record<string, unknown>>;
}

export interface RelationsServiceLike {
	createOne(payload: unknown): Promise<unknown>;
	updateOne(collection: string, field: string, payload: unknown): Promise<unknown>;
}

export interface ItemsServiceLike {
	readByQuery(query: Record<string, unknown>): Promise<Record<string, unknown>[]>;
	readOne(key: string): Promise<Record<string, unknown>>;
	createOne(payload: Record<string, unknown>, opts?: Record<string, unknown>): Promise<unknown>;
	updateOne(key: string, payload: Record<string, unknown>, opts?: Record<string, unknown>): Promise<unknown>;
	deleteOne(key: string, opts?: Record<string, unknown>): Promise<unknown>;
	deleteByQuery(query: Record<string, unknown>, opts?: Record<string, unknown>): Promise<unknown>;
}

export interface RolesServiceLike extends ItemsServiceLike {
	createOne(payload: Record<string, unknown>, opts?: Record<string, unknown>): Promise<string>;
	updateOne(key: string, payload: Record<string, unknown>, opts?: Record<string, unknown>): Promise<unknown>;
	deleteOne(key: string, opts?: Record<string, unknown>): Promise<unknown>;
}

export interface AccessServiceLike extends ItemsServiceLike {
	createOne(payload: Record<string, unknown>, opts?: Record<string, unknown>): Promise<string>;
	deleteMany(keys: string[], opts?: Record<string, unknown>): Promise<unknown>;
}

export interface ExtensionServices {
	CollectionsService: new (options: ServiceOptions) => CollectionsServiceLike;
	FieldsService: new (options: ServiceOptions) => FieldsServiceLike;
	RelationsService: new (options: ServiceOptions) => RelationsServiceLike;
	ItemsService: new (collection: string, options: ServiceOptions) => ItemsServiceLike;
	RolesService: new (options: ServiceOptions) => RolesServiceLike;
	AccessService: new (options: ServiceOptions) => AccessServiceLike;
}

export interface QueryBuilderLike extends Promise<Record<string, unknown>[]> {
	select(...columns: string[]): QueryBuilderLike;
	orderBy(column: string, direction?: 'asc' | 'desc'): QueryBuilderLike;
	where(conditions: Record<string, unknown>): QueryBuilderLike;
	insert(payload: Record<string, unknown>): Promise<unknown>;
	update(payload: Record<string, unknown>): Promise<unknown>;
	first(): Promise<Record<string, unknown> | undefined>;
}

export interface KnexLike {
	(table: string): QueryBuilderLike;
	schema: {
		hasTable(name: string): Promise<boolean>;
		hasColumn(table: string, column: string): Promise<boolean>;
		alterTable(table: string, callback: (table: TableBuilderLike) => void): Promise<void>;
	};
	raw(sql: string): Promise<unknown>;
}

export interface TableBuilderLike {
	unique(columns: string[], indexName?: string): void;
	dropUnique(columns: string[], indexName?: string): void;
	renameColumn(from: string, to: string): void;
}

export interface ExtensionContext {
	services: ExtensionServices;
	database: KnexLike;
	getSchema: (options?: { bypassCache?: boolean }) => Promise<SchemaOverview>;
	env: Record<string, unknown>;
	logger: Logger;
}




