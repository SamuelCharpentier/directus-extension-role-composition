import type { ExtensionContext } from '../directus-types.js';
import { isReconcileRunning, requestReconcile } from './worker.js';

let timer: NodeJS.Timeout | null = null;
const DEBOUNCE_MS = 1500;

export function scheduleReconcile(ctx: ExtensionContext, reason: string): void {
	if (isReconcileRunning()) return;
	if (timer) clearTimeout(timer);
	timer = setTimeout(() => {
		timer = null;
		void requestReconcile(reason);
	}, DEBOUNCE_MS);
	timer.unref?.();
}
