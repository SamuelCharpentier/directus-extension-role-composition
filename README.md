# Directus Role Composition

A Directus 12 extension that lets a role inherit from one or more **Parents** while keeping Directus as the only authorization engine.

> **Status: manual-test build.** Select Parents in the role editor. One parent becomes the native parent; multiple parents are combined through a hidden shared ghost role. Permission changes reconcile asynchronously.

## Parents abstraction

The UI exposes one field, **Parents**, using Directus's native many-to-many reference selector (`list-m2m`). It has no Composition Kind setting.

| Selected Parents | Stored selection | Effective result |
| --- | --- | --- |
| None | No junction rows, native `parent = null` | No inherited permissions. |
| One | One junction row, native `parent = roleId` | Directus inherits that role's chain natively. |
| Two or more | Multiple junction rows, native `parent = ghostRoleId` | A hidden ghost role contains the union of the selected parents' effective policies. |

Ghost roles are shared by parent set: two roles with the same Parents use the same ghost role. When the last role using a parent set changes away or is deleted, the ghost role, its registry row, ledger links, and access rows are removed.

`composition_kind` remains as a hidden internal value (`composite` or `ghost`) so the extension can filter ghost roles from selectors and the roles list. It is derived automatically and is not editable.

## Requirements

- Directus **12.0.0 or newer**.
- `custom_permission_rules_enabled` entitlement if you use field-level permissions, custom permission rules, or presets.
- **One API instance only.** Multi-instance/server support is not implemented. Do not run several Directus API replicas with this extension.

## Single-server limitation

This release targets a single Directus API instance:

- There is no lease, cross-instance cache bus, Redis requirement, or distributed lock.
- Reconcile work runs asynchronously outside Directus transactions. Effective permissions can lag behind a Parents or policy change by up to `ROLE_COMPOSITION_RECONCILE_INTERVAL_SECONDS` plus the duration of the pass.
- With multiple API instances, caches are not coordinated and instances can disagree about effective permissions.

The accepted trade-off is eventual consistency in exchange for not maintaining a custom permission-cache layer.

## Why the old selector looked empty

The previous field was an `o2m` alias over the `role_composition_sources` junction. Directus's "Add Existing" drawer for an `o2m` alias lists **junction rows**, not roles. A new role has no junction rows, and deleting the last selected row removes the only junction row, so the drawer had nothing to show. It was a schema/interface mismatch, not a client-state cache bug.

Parents are stored in the `role_composition_parent_roles` junction. The **Add Existing** drawer lists roles (not junction rows), and selected roles appear in the field list with the native trash action. Ghost roles are the only roles filtered out. As with native Directus m2m fields, the Add Existing drawer shows only unselected roles.

## Bootstrap and migrations

Bootstrap is conservative and versioned. It never blocks Directus startup and never overwrites admin- or schema-sync-owned rows.

| `ROLE_COMPOSITION_BOOTSTRAP` | Behaviour |
| --- | --- |
| `full` (default) | Ensure schema, run ordered data migrations, initialise the version row, validate, start the worker. |
| `schema` | Ensure schema and validate existing data. **Never seeds or migrates data.** If imported data has an older version, reconcile is disabled with an actionable error. |
| `off` | Do not create or alter schema or data. Validate the existing schema and disable reconcile if required objects are missing. |

Data version 4 moves the selection to the native `role_composition_parent_roles` junction. Migration 3 -> 4 copies existing JSON Parents (v3), the legacy `role_composition_parents` junction (v2), legacy `role_composition_sources` rows (v1), or a single native parent. Older versions pass through the marker migrations. Legacy storage fields are hidden.

If the stored data version is newer than the running extension, the extension marks itself incompatible and refuses to modify data.

## Schema sync

`directus-extension-schema-sync` can move the extension's schema and rows between instances. Merge [`examples/schema-sync.config.js`](examples/schema-sync.config.js) into your `schema-sync/config.js` alongside the default `directus_roles`, `directus_policies`, `directus_permissions`, and `directus_access` entries.

| Environment | `SCHEMA_SYNC` | `ROLE_COMPOSITION_BOOTSTRAP` |
| --- | --- | --- |
| Local | `BOTH` | `full` |
| Remote | `IMPORT` | `schema` |

Parents live on `directus_roles` and sync with the default roles entry. The sync tool remaps `directus_access` ids, so **do not sync `role_composition_policy_links`**; the target adopts the synced ghost-role access rows and rebuilds the ledger. `role_composition_scores` is derived and skipped. `role_composition_meta` must be synced so the target checks `data_version`.

After an import, call `POST /role-composition/reconcile` or wait for the startup/interval pass.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ROLE_COMPOSITION_BOOTSTRAP` | `full` | `full`, `schema`, or `off`. |
| `ROLE_COMPOSITION_RECONCILE_INTERVAL_SECONDS` | `60` | Background reconcile interval, minimum 5 seconds. |
| `ROLE_COMPOSITION_RECONCILE_ON_START` | `true` | Run one asynchronous pass after bootstrap. |

## Admin endpoint

- `GET /role-composition/status` (admin only): bootstrap mode, ready/incompatible state, versions, last error, interval, last reconcile result.
- `POST /role-composition/reconcile` (admin only): request an immediate pass. Requests coalesce.

## Local test stack

The project ships a disposable Directus 12.5.1 stack:

- Compose file: `docker-compose.test.yml`
- Seed script: `test/seed.mjs`
- Optional licence: copy `.env.test.example` to `.env.test` (ignored by git)
- URL: `http://localhost:8160`
- Admin: `admin@example.com` / `test-password`

```sh
npm run test:start   # build the extension and start Directus + PostgreSQL
npm run test:seed    # create the demo roles/policies/users
npm run test:stop    # stop the containers, keep the database
npm run test:reset   # delete the database volume and start clean
npm run test:rm      # delete the containers and database volume
npm run test:logs    # follow Directus logs
```

The database lives in the Docker named volume `role-composition-test_dbdata`, not in this directory. `test:stop` preserves it for inspection; `test:reset` and `test:rm` delete it. The extension is mounted from this project's `package.json` and `dist/`, so rebuild before restarting after code changes.

The demo uses full-field permissions and works on Directus Core. Field-level restrictions and presets require `custom_permission_rules_enabled`.

## Manual test walkthrough

1. Build and install: `npm ci && npm run build`, then copy `package.json` and `dist/` into `EXTENSIONS_PATH/directus-extension-role-composition`.
2. Restart Directus with `ROLE_COMPOSITION_BOOTSTRAP=full`. Confirm `Bootstrap ready` and `Reconcile worker started`.
3. Seed demo data:
   ```powershell
   $env:DIRECTUS_URL="http://localhost:8055"
   $env:DIRECTUS_ADMIN_EMAIL="admin@example.com"
   $env:DIRECTUS_ADMIN_PASSWORD="..."
   node examples/manual-demo.mjs
   ```

   The seeded demo uses full-field permissions so it works on Directus Core. Field-level restrictions and presets require `custom_permission_rules_enabled`.
4. In **Settings -> Roles**, open **Demo Composite**. The **Parents** field lists Demo Source A and B with the native trash action. Use **Add Existing** to show the native role selector. There is no Composition Kind field and no native Parent field.
5. The ghost role is hidden by default. On **Settings -> Roles**, use **Show system roles** in the roles-list header to inspect `Parents: Demo Source A + Demo Source B (ghost) #...`. It has no native parent and contains the copied union of both sources' policies.
6. Log in as `composite@example.com` / `test-password`: reading and creating `demo_articles` works. `source-a@example.com` can create; `source-b@example.com` can only read.
7. Uncheck one parent, save, and run reconcile. The role switches to a direct native parent and the ghost is removed if unused. Uncheck all: native parent becomes null and permissions are removed.
8. Attach a new policy to a source or change the Parents selection, then wait for the interval or call `POST /role-composition/reconcile`.

`GET /role-composition/status` shows the last reconcile result and any errors.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build
```

`npm run dev` rebuilds on change. `npm run validate` checks the built bundle metadata.

## Data model

- `role_composition_parent_roles`: native m2m junction (`role` -> `parent`) backing the `parents` field, labelled **Parents**.
- `directus_roles.parents`: hidden legacy JSON storage (migrated to the junction).
- `directus_roles.composition_kind`: hidden derived value (`composite` or `ghost`).
- `directus_roles.parent`: hidden derived native parent (`null`, one Parent, or a ghost role).
- `role_composition`: maps a multi-parent role to its ghost role.
- `role_composition_ghost_sets`: shared registry keyed by the sorted Parent set.
- `role_composition_policy_links`: ownership ledger for extension-created access rows.
- `role_composition_scores`: reserved derived scores (not used by the current pass).
- `role_composition_meta`: schema/data version and extension metadata.

Ghost roles are ordinary Directus roles hidden in the Studio roles list by a best-effort embed toggle. If the toggle script fails to load, ghost roles remain visible; authorization is unaffected.





