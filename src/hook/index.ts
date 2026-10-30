import type { HookConfig } from '@directus/types';
import { kickBootstrap } from '../bootstrap/index.js';
import { COLLECTION, LOG_PREFIX } from '../constants.js';
import type { ExtensionContext } from '../directus-types.js';
import { scheduleReconcile } from '../reconcile/schedule.js';

const hook: HookConfig = ({ init, action, embed }, context) => {
	const ctx = context as unknown as ExtensionContext;
	ctx.logger.info(`${LOG_PREFIX} Hook registered.`);

	const start = (): void => {
		void kickBootstrap(ctx);
	};

	if (typeof init === 'function') {
		try {
			init('app.after', start);
		} catch {
			ctx.logger.warn(`${LOG_PREFIX} init("app.after") is unavailable; relying on server.start.`);
		}
	}
	action('server.start', start);

	for (const event of ['roles.create', 'roles.update', 'roles.delete'] as const) {
		action(event, () => scheduleReconcile(ctx, event));
	}
	for (const event of ['access.create', 'access.update', 'access.delete', 'policies.create', 'policies.update', 'policies.delete'] as const) {
		action(event, () => scheduleReconcile(ctx, event));
	}
	for (const event of ['items.create', 'items.update', 'items.delete'] as const) {
		action(event, (meta) => {
			if (meta && typeof meta === 'object' && 'collection' in meta && meta.collection === COLLECTION.sources) {
				scheduleReconcile(ctx, `${event}:sources`);
			}
		});
	}

	if (typeof embed === 'function') {
		embed('body', () => '<script src="/role-composition/toggle.js"></script>');
	}
};

export default hook;
