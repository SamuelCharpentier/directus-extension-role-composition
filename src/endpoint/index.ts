import { getBootstrapState } from '../bootstrap/state.js';
import { CURRENT_DATA_VERSION, EXTENSION_NAME, LOG_PREFIX } from '../constants.js';
import { getReconcileIntervalSeconds, requestReconcile } from '../reconcile/worker.js';
import { EXTENSION_VERSION } from '../version.js';

interface EndpointRequest {
	accountability?: { admin?: boolean } | null;
}

interface EndpointResponse {
	status(code: number): EndpointResponse;
	json(body: unknown): void;
	type(value: string): EndpointResponse;
	send(body: string): void;
}

interface EndpointRouter {
	get(path: string, handler: (req: EndpointRequest, res: EndpointResponse) => void | Promise<void>): void;
	post(path: string, handler: (req: EndpointRequest, res: EndpointResponse) => void | Promise<void>): void;
}

function statusBody() {
	const state = getBootstrapState();
	return {
		extension: EXTENSION_NAME,
		extensionVersion: EXTENSION_VERSION,
		currentDataVersion: CURRENT_DATA_VERSION,
		reconcileIntervalSeconds: getReconcileIntervalSeconds(),
		...state,
	};
}

export default function registerEndpoint(router: EndpointRouter, context: { logger: { info(message: string): void } }): void {
	router.get('/toggle.js', (req, res) => {
		res.type('application/javascript').send(`(() => {
			const KEY = 'role-composition-show-ghosts';
			let enabled = localStorage.getItem(KEY) === '1';
			const style = document.createElement('style');
			style.textContent = 'tr[data-role-composition-ghost="1"]{display:none!important}';
			document.head.appendChild(style);
			function apply() {
				style.disabled = enabled;
				document.querySelectorAll('tr').forEach((tr) => {
					if (tr.textContent && tr.textContent.includes('(ghost)')) tr.dataset.roleCompositionGhost = '1';
				});
			}
			function button() {
				if (document.getElementById('role-composition-toggle')) return;
				const b = document.createElement('button');
				b.id = 'role-composition-toggle';
				b.type = 'button';
				b.textContent = enabled ? 'Hide system roles' : 'Show system roles';
				b.className = 'v-button';
				b.style.cssText = 'margin-right:8px;padding:8px 12px;border-radius:6px;border:1px solid var(--theme--border);background:var(--theme--background);color:var(--theme--foreground);cursor:pointer';
				b.onclick = function () {
					enabled = !enabled;
					localStorage.setItem(KEY, enabled ? '1' : '0');
					b.textContent = enabled ? 'Hide system roles' : 'Show system roles';
					apply();
				};
				const host = document.querySelector('.header-bar .actions') || document.querySelector('.header-bar') || document.body;
				host.prepend(b);
			}
			function tick() {
				if (/role/i.test(location.pathname)) { button(); apply(); }
			}
			new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
			setInterval(tick, 500);
			tick();
		})();`);
	});

	router.get('/status', (req, res) => {
		if (!req.accountability?.admin) {
			res.status(403).json({ errors: [{ message: 'Admin access required.' }] });
			return;
		}
		res.json({ data: statusBody() });
	});

	router.post('/reconcile', async (req, res) => {
		if (!req.accountability?.admin) {
			res.status(403).json({ errors: [{ message: 'Admin access required.' }] });
			return;
		}
		const result = await requestReconcile('manual');
		res.json({ data: { result, state: statusBody() } });
	});

	context.logger.info(`${LOG_PREFIX} Status endpoint registered at /${EXTENSION_NAME}/status.`);
}

