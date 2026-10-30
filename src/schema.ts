import { COLLECTION, COMPOSITION_KIND, ROLE_FIELD } from './constants.js';

export interface FieldPayload {
	field: string;
	type: string;
	meta?: Record<string, unknown>;
	schema?: Record<string, unknown> | null;
}

export interface CollectionPayload {
	collection: string;
	meta: Record<string, unknown>;
	schema: Record<string, unknown>;
	fields: FieldPayload[];
}

export interface RelationPayload {
	collection: string;
	field: string;
	related_collection: string;
	meta: Record<string, unknown>;
	schema: Record<string, unknown>;
}

const uuidPk: FieldPayload = {
	field: 'id',
	type: 'uuid',
	meta: { hidden: true, readonly: true, interface: 'input', special: ['uuid'] },
	schema: { is_primary_key: true, has_auto_increment: false },
};

const integer = (field: string, note?: string): FieldPayload => ({
	field,
	type: 'integer',
	meta: { interface: 'input', width: 'half', ...(note ? { note } : {}) },
	schema: { default_value: 0 },
});

const timestamp = (field: string): FieldPayload => ({
	field,
	type: 'timestamp',
	meta: { interface: 'datetime', width: 'half', readonly: true },
	schema: {},
});

export const ALL_COLLECTIONS: readonly CollectionPayload[] = [
	{
		collection: COLLECTION.composition,
		meta: {
			icon: 'account_tree',
			note: 'Mapping from a multi-parent role to its shared ghost role.',
			hidden: true,
		},
		schema: {},
		fields: [
			uuidPk,
			{ field: 'composite_role', type: 'uuid', meta: { interface: 'select-dropdown-m2o', special: ['m2o'], hidden: true }, schema: {} },
			{ field: 'ghost_role', type: 'uuid', meta: { interface: 'select-dropdown-m2o', special: ['m2o'], hidden: true }, schema: {} },
			{ field: 'selected_parent', type: 'uuid', meta: { interface: 'select-dropdown-m2o', special: ['m2o'], hidden: true }, schema: {} },
			integer('baseline_policy_count'),
			integer('baseline_formula_version'),
			{ field: 'status', type: 'string', meta: { interface: 'select-dropdown', options: { choices: ['ok', 'conflict', 'error'].map((value) => ({ text: value, value })) } }, schema: { default_value: 'ok' } },
			{ field: 'conflict_reason', type: 'json', meta: { interface: 'input-code', hidden: true }, schema: {} },
			integer('version'),
			timestamp('last_reconciled_at'),
			{ field: 'last_error', type: 'text', meta: { interface: 'input-multiline', readonly: true }, schema: {} },
			integer('unowned_count'),
			integer('unowned_required_count'),
			integer('missing_required_count'),
			integer('duplicate_row_count'),
			integer('duplicate_policy_count'),
			integer('unrequired_row_count'),
			integer('ledger_mismatch_count'),
			integer('x_g'),
			integer('repairs_applied'),
			integer('residual_missing_required_count'),
			{ field: 'pending_token', type: 'string', meta: { interface: 'input', hidden: true }, schema: {} },
			timestamp('pending_set_at'),
		],
	},
	{
		collection: COLLECTION.links,
		meta: {
			icon: 'link',
			note: 'Ownership ledger: links extension-created access rows to ghost roles and policies.',
			hidden: true,
		},
		schema: {},
		fields: [
			uuidPk,
			{ field: 'ghost_role', type: 'uuid', meta: { interface: 'select-dropdown-m2o', special: ['m2o'], hidden: true }, schema: {} },
			{ field: 'policy', type: 'uuid', meta: { interface: 'select-dropdown-m2o', special: ['m2o'], hidden: true }, schema: {} },
			{ field: 'access_id', type: 'uuid', meta: { interface: 'select-dropdown-m2o', special: ['m2o'], hidden: true }, schema: {} },
			integer('link_seq'),
			timestamp('created_at'),
		],
	},
	{
		collection: COLLECTION.scores,
		meta: {
			icon: 'speed',
			note: 'Derived policy counts and depth per role. Rebuildable.',
			hidden: true,
		},
		schema: {},
		fields: [
			uuidPk,
			{ field: 'role_id', type: 'uuid', meta: { hidden: true }, schema: { is_unique: true } },
			integer('policy_count'),
			integer('attachment_count'),
			integer('duplicate_count'),
			integer('depth'),
			timestamp('computed_at'),
		],
	},
	{
		collection: COLLECTION.meta,
		meta: {
			icon: 'settings',
			note: 'Extension metadata and schema/data version markers.',
			hidden: true,
		},
		schema: {},
		fields: [
			{ field: 'key', type: 'string', meta: { interface: 'input', readonly: true }, schema: { is_primary_key: true, is_nullable: false } },
			{ field: 'value', type: 'text', meta: { interface: 'input-code', hidden: true }, schema: {} },
		],
	},
	{
		collection: COLLECTION.parentRoles,
		meta: {
			icon: 'account_tree',
			note: 'Native many-to-many selection backing the Parents field.',
			hidden: true,
		},
		schema: {},
		fields: [
			uuidPk,
			{ field: 'role', type: 'uuid', meta: { interface: 'select-dropdown-m2o', special: ['m2o'], hidden: true }, schema: {} },
			{ field: 'parent', type: 'uuid', meta: { interface: 'select-dropdown-m2o', special: ['m2o'], hidden: true }, schema: {} },
			{ field: 'sort', type: 'integer', meta: { interface: 'input', hidden: true }, schema: { default_value: 0 } },
		],
	},
	{
		collection: COLLECTION.ghostSets,
		meta: {
			icon: 'group_work',
			note: 'Shared ghost roles keyed by their exact Parent set.',
			hidden: true,
		},
		schema: {},
		fields: [
			uuidPk,
			{ field: 'key', type: 'string', meta: { interface: 'input', readonly: true }, schema: { is_unique: true } },
			{ field: 'ghost_role', type: 'uuid', meta: { interface: 'select-dropdown-m2o', special: ['m2o'], hidden: true }, schema: { is_unique: true } },
			{ field: 'parent_ids', type: 'json', meta: { interface: 'input-code', hidden: true }, schema: {} },
			timestamp('created_at'),
		],
	},
];

export const ALL_RELATIONS: readonly RelationPayload[] = [
	{
		collection: COLLECTION.composition,
		field: 'composite_role',
		related_collection: 'directus_roles',
		meta: { one_field: null },
		schema: { on_delete: 'CASCADE' },
	},
	{
		collection: COLLECTION.composition,
		field: 'ghost_role',
		related_collection: 'directus_roles',
		meta: { one_field: null },
		schema: { on_delete: 'RESTRICT' },
	},
	{
		collection: COLLECTION.composition,
		field: 'selected_parent',
		related_collection: 'directus_roles',
		meta: { one_field: null },
		schema: { on_delete: 'SET NULL' },
	},
	{
		collection: COLLECTION.links,
		field: 'ghost_role',
		related_collection: 'directus_roles',
		meta: { one_field: null },
		schema: { on_delete: 'CASCADE' },
	},
	{
		collection: COLLECTION.links,
		field: 'policy',
		related_collection: 'directus_policies',
		meta: { one_field: null },
		schema: { on_delete: 'CASCADE' },
	},
	{
		collection: COLLECTION.links,
		field: 'access_id',
		related_collection: 'directus_access',
		meta: { one_field: null },
		schema: { on_delete: 'CASCADE' },
	},
	{
		collection: COLLECTION.scores,
		field: 'role_id',
		related_collection: 'directus_roles',
		meta: { one_field: null },
		schema: { on_delete: 'CASCADE' },
	},
	{
		collection: COLLECTION.parentRoles,
		field: 'role',
		related_collection: 'directus_roles',
		meta: {
			one_field: ROLE_FIELD.parents,
			junction_field: 'parent',
			sort_field: 'sort',
			one_deselect_action: 'delete',
		},
		schema: { on_delete: 'CASCADE' },
	},
	{
		collection: COLLECTION.parentRoles,
		field: 'parent',
		related_collection: 'directus_roles',
		meta: { one_field: null, junction_field: 'role' },
		schema: { on_delete: 'CASCADE' },
	},
	{
		collection: COLLECTION.ghostSets,
		field: 'ghost_role',
		related_collection: 'directus_roles',
		meta: { one_field: null },
		schema: { on_delete: 'CASCADE' },
	},
];

export const GHOST_FILTER = {
	_or: [
		{ [ROLE_FIELD.compositionKind]: { _null: true } },
		{ [ROLE_FIELD.compositionKind]: { _neq: COMPOSITION_KIND.ghost } },
	],
};

export const PARENT_SELECTION_FILTER = GHOST_FILTER;

export const ROLE_FIELD_PAYLOADS: readonly FieldPayload[] = [
	{
		field: ROLE_FIELD.compositionKind,
		type: 'string',
		meta: {
			interface: 'input',
			hidden: true,
			readonly: true,
			note: 'Derived by the extension: composite when Parents has more than one selection, ghost for system containers.',
		},
		schema: {},
	},
	{
		field: ROLE_FIELD.parents,
		type: 'alias',
		meta: {
			special: ['m2m'],
			interface: 'list-m2m',
			options: {
				template: '{{ parent.name }}',
				enableCreate: false,
				enableSelect: true,
				filter: PARENT_SELECTION_FILTER,
			},
			note: 'Select one or more Parent roles. One parent maps to the native hierarchy; multiple parents are combined through a hidden shared role.',
		},
		schema: null,
	},
];

export const SYSTEM_FIELD_OVERRIDES: ReadonlyArray<{
	collection: string;
	field: string;
	patch: { options?: Record<string, unknown>; conditions?: unknown[]; hidden?: boolean; readonly?: boolean };
}> = [
	{
		collection: 'directus_roles',
		field: 'parent',
		patch: { hidden: true, readonly: true },
	},
	{ collection: 'directus_users', field: 'role', patch: { options: { filter: GHOST_FILTER } } },
];

export const UNIQUE_INDEXES: ReadonlyArray<{ collection: string; name: string; columns: string[] }> = [
	{ collection: COLLECTION.parentRoles, name: 'role_composition_parent_roles_unique', columns: ['role', 'parent'] },
	{ collection: COLLECTION.ghostSets, name: 'role_composition_ghost_sets_key_unique', columns: ['key'] },
	{ collection: COLLECTION.ghostSets, name: 'role_composition_ghost_sets_role_unique', columns: ['ghost_role'] },
	{ collection: COLLECTION.composition, name: 'role_composition_composite_unique', columns: ['composite_role'] },
	{ collection: COLLECTION.links, name: 'role_composition_links_access_unique', columns: ['access_id'] },
	{ collection: COLLECTION.links, name: 'role_composition_links_seq_unique', columns: ['link_seq'] },
];

export const REMOVED_UNIQUE_INDEXES: ReadonlyArray<{ collection: string; name: string }> = [
	{ collection: COLLECTION.composition, name: 'role_composition_ghost_unique' },
];



