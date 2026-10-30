/**
 * Creates a demo data set for manual testing.
 *
 * Usage (PowerShell):
 *   $env:DIRECTUS_URL="http://localhost:8055"
 *   $env:DIRECTUS_ADMIN_EMAIL="admin@example.com"
 *   $env:DIRECTUS_ADMIN_PASSWORD="..."
 *   node examples/manual-demo.mjs
 *
 * The script is idempotent by name: running it again reuses the existing demo
 * policies, roles, and users.
 */
const base = (process.env.DIRECTUS_URL || 'http://localhost:8055').replace(/\/$/, '');
const adminEmail = process.env.DIRECTUS_ADMIN_EMAIL || 'admin@example.com';
const adminPassword = process.env.DIRECTUS_ADMIN_PASSWORD;
const demoPassword = process.env.DIRECTUS_DEMO_PASSWORD || 'test-password';

if (!adminPassword) {
	console.error('Set DIRECTUS_ADMIN_PASSWORD before running this script.');
	process.exit(1);
}

const login = await fetch(base + '/auth/login', {
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ email: adminEmail, password: adminPassword }),
});
if (!login.ok) {
	console.error('Login failed:', login.status, await login.text());
	process.exit(1);
}
const token = (await login.json()).data.access_token;
const headers = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };

async function api(method, path, body) {
	const response = await fetch(base + path, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let data;
	try { data = text ? JSON.parse(text) : null; } catch { data = text; }
	if (!response.ok) throw new Error(`${method} ${path} ${response.status}: ${text}`);
	return data?.data ?? data;
}

const read = (path) => api('GET', path);
const create = (path, body) => api('POST', path, body);
const patch = (path, body) => api('PATCH', path, body);
const escape = encodeURIComponent;

const collections = await read('/collections');
if (!collections.some((row) => row.collection === 'demo_articles')) {
	await create('/collections', {
		collection: 'demo_articles',
		meta: { icon: 'article', note: 'Role composition manual test collection' },
		schema: {},
		fields: [
			{ field: 'title', type: 'string', meta: { interface: 'input' }, schema: {} },
			{
				field: 'status',
				type: 'string',
				meta: {
					interface: 'select-dropdown',
					options: { choices: ['draft', 'published'].map((value) => ({ text: value, value })) },
				},
				schema: {},
			},
		],
	});
}

async function getOrCreate(collection, name, payload) {
	const rows = await read(`/${collection}?filter[name][_eq]=${escape(name)}&limit=1`);
	if (rows[0]) return rows[0];
	return create(`/${collection}`, { name, ...payload });
}

async function ensurePermission(policy, action, fields) {
	const rows = await read(
		`/permissions?filter[policy][_eq]=${policy}&filter[collection][_eq]=demo_articles&filter[action][_eq]=${action}&limit=1`,
	);
	if (rows[0]) return;
	await create('/permissions', { policy, collection: 'demo_articles', action, fields });
}

const editor = await getOrCreate('policies', 'Demo Editor', { admin_access: false, app_access: false });
const reader = await getOrCreate('policies', 'Demo Reader', { admin_access: false, app_access: false });
const viewer = await getOrCreate('policies', 'Demo Viewer', { admin_access: false, app_access: false });
for (const action of ['read', 'create', 'update']) await ensurePermission(editor.id, action, ['*']);
await ensurePermission(reader.id, 'read', ['*']);
await ensurePermission(viewer.id, 'read', ['*']);

async function ensureAccess(role, policy) {
	const all = await read(`/access?filter[role][_eq]=${role}&limit=-1`);
	if (!all.some((row) => row.policy === policy)) {
		await create('/access', { role, policy });
	}
}

const sourceA = await getOrCreate('roles', 'Demo Source A', {});
const sourceB = await getOrCreate('roles', 'Demo Source B', {});
const composite = await getOrCreate('roles', 'Demo Composite', {});
await ensureAccess(sourceA.id, editor.id);
await ensureAccess(sourceB.id, reader.id);
await ensureAccess(sourceB.id, viewer.id);
await ensureParentLink(composite.id, sourceA.id, 1);
await ensureParentLink(composite.id, sourceB.id, 2);

async function ensureParentLink(role, parent, sort) {
	const rows = await read(`/items/role_composition_parent_roles?filter[role][_eq]=${role}&limit=-1`);
	if (!rows.some((row) => row.parent === parent)) {
		await create('/items/role_composition_parent_roles', {
			id: crypto.randomUUID(),
			role,
			parent,
			sort,
		});
	}
}

async function ensureUser(email, role) {
	const rows = await read(`/users?filter[email][_eq]=${escape(email)}&limit=1`);
	if (rows[0]) {
		await patch('/users/' + rows[0].id, { role, password: demoPassword, status: 'active' });
		return rows[0];
	}
	return create('/users', {
		email,
		password: demoPassword,
		role,
		status: 'active',
		first_name: email.split('@')[0],
	});
}

await ensureUser('composite@example.com', composite.id);
await ensureUser('source-a@example.com', sourceA.id);
await ensureUser('source-b@example.com', sourceB.id);

await create('/role-composition/reconcile');

console.log(JSON.stringify({
	base,
	composite: composite.name,
	parents: [sourceA.name, sourceB.name],
	users: {
		'composite@example.com': demoPassword,
		'source-a@example.com': demoPassword,
		'source-b@example.com': demoPassword,
	},
	next: [
		'Open Settings -> Roles and confirm Demo Composite (ghost) is hidden by default.',
		'Use Show system roles to reveal the ghost role and inspect its copied policies.',
		'Log in as composite@example.com and read/create demo_articles.',
		'Log in as source-b@example.com: read works, create is denied.',
		'Edit Demo Composite Parents or policies, then wait for the interval or POST /role-composition/reconcile.',
	],
}, null, 2));


