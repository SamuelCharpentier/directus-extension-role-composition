import { markReconcileResult } from '../bootstrap/state.js';
import { LOG_PREFIX } from '../constants.js';
import type { ExtensionContext } from '../directus-types.js';
import { reconcileAll } from './run.js';

let timer: NodeJS.Timeout | null = null;
let running = false;
let pending = false;
let currentContext: ExtensionContext | null = null;
let intervalSeconds = 60;

export function isReconcileRunning(): boolean {
	return running;
}

export function configureReconcileWorker(ctx: ExtensionContext, seconds: number): void {
	currentContext = ctx;
	intervalSeconds = seconds;
}

export async function requestReconcile(reason: string): Promise<string> {
	if (!currentContext) return 'not-ready';
	if (running) {
		pending = true;
		return 'already-running';
	}
	running = true;
	try {
		do {
			pending = false;
			const result = await reconcileOnce(currentContext, reason);
			markReconcileResult(result);
			if (pending) reason = 'queued';
		} while (pending);
		return 'ok';
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		markReconcileResult(`error: ${message}`);
		currentContext.logger.error(`${LOG_PREFIX} Reconcile failed: ${message}`);
		return 'error';
	} finally {
		running = false;
	}
}

async function reconcileOnce(ctx: ExtensionContext, reason: string): Promise<string> {
	const summary = await reconcileAll(ctx);
	const result =
		`${reason}: ${summary.roles} role(s), ${summary.singleParents} single / ${summary.multiParents} multi, ` +
		`+${summary.ghostsCreated} ghost(s), +${summary.accessCreated}/-${summary.accessDeleted} access, ` +
		`${summary.repaired} repaired` +
		(summary.errors.length ? `, errors: ${summary.errors.join(' | ')}` : '');
	if (summary.errors.length) {
		ctx.logger.warn(`${LOG_PREFIX} ${result}`);
	} else {
		ctx.logger.info(`${LOG_PREFIX} ${result}`);
	}
	return result;
}

export function startReconcileWorker(ctx: ExtensionContext, seconds: number): void {
	configureReconcileWorker(ctx, seconds);
	if (timer) return;
	timer = setInterval(() => {
		void requestReconcile('scheduled');
	}, seconds * 1000);
	timer.unref?.();
	ctx.logger.info(`${LOG_PREFIX} Reconcile worker started (every ${seconds}s).`);
}

export function stopReconcileWorker(): void {
	if (timer) clearInterval(timer);
	timer = null;
}

export function getReconcileIntervalSeconds(): number {
	return intervalSeconds;
}

