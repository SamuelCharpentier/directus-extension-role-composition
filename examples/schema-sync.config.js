/**
 * Merge this into the `syncCustomCollections` object of
 * `schema-sync/config.js` created by directus-extension-schema-sync.
 *
 * Parents are stored in `role_composition_parent_roles`, a junction
 * between two role ids. Keep the default `directus_roles`,
 * `directus_policies`, `directus_permissions`, and `directus_access` entries
 * too.
 *
 * Do not sync `role_composition_policy_links` or
 * `role_composition_scores`.
 *
 * The ledger contains directus_access ids. Schema sync remaps those ids
 * (it keys access rows by role/policy), so importing the ledger would either
 * violate its FK or point at the wrong rows. The target rebuilds the ledger
 * from the synced ghost-role access rows on the first reconcile pass.
 * Scores are derived and rebuilt too.
 */
export const roleCompositionSyncCollections = {
	role_composition_parent_roles: {
		watch: ['role_composition_parent_roles.items'],
		linkedFields: ['role', 'parent'],
		query: { sort: ['role', 'sort'] },
	},
	role_composition_meta: {
		watch: ['role_composition_meta.items'],
		query: { sort: ['key'] },
	},
	role_composition: {
		watch: ['role_composition.items'],
		linkedFields: ['composite_role', 'ghost_role'],
		query: { sort: ['composite_role'] },
	},
	role_composition_ghost_sets: {
		watch: ['role_composition_ghost_sets.items'],
		linkedFields: ['ghost_role'],
		query: { sort: ['key'] },
	},
};

