export const EXTENSION_NAME = 'role-composition';
export const LOG_PREFIX = '[role-composition]';

export const BOOTSTRAP_MODES = ['full', 'schema', 'off'] as const;
export type BootstrapMode = (typeof BOOTSTRAP_MODES)[number];

export const DEFAULT_BOOTSTRAP_MODE: BootstrapMode = 'full';
export const DEFAULT_RECONCILE_INTERVAL_SECONDS = 60;
export const MIN_RECONCILE_INTERVAL_SECONDS = 5;

export const CURRENT_DATA_VERSION = 4;

export const ENV = {
	bootstrap: 'ROLE_COMPOSITION_BOOTSTRAP',
	interval: 'ROLE_COMPOSITION_RECONCILE_INTERVAL_SECONDS',
	reconcileOnStart: 'ROLE_COMPOSITION_RECONCILE_ON_START',
} as const;

export const COLLECTION = {
	composition: 'role_composition',
	links: 'role_composition_policy_links',
	scores: 'role_composition_scores',
	meta: 'role_composition_meta',
	parents: 'role_composition_parents',
	parentRoles: 'role_composition_parent_roles',
	ghostSets: 'role_composition_ghost_sets',
	sources: 'role_composition_sources',
} as const;

export const META_KEY = {
	schemaVersion: 'schema_version',
	dataVersion: 'data_version',
	extensionVersion: 'extension_version',
} as const;

export const ROLE_FIELD = {
	compositionKind: 'composition_kind',
	parents: 'parents',
	parentsLegacy: 'parents_legacy',
	parentRoles: 'parent_roles',
	compositionSources: 'composition_sources',
} as const;

export const COMPOSITION_KIND = {
	composite: 'composite',
	ghost: 'ghost',
} as const;

export type CompositionKind = (typeof COMPOSITION_KIND)[keyof typeof COMPOSITION_KIND];






