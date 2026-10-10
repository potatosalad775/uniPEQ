/**
 * Haptic feedback for device writes: a light tick when a write lands, an error buzz
 * when one fails. Native only, and loaded on first use; a no-op on the web.
 */
import { isNative } from './native';

const load = () => import('@capacitor/haptics');

export function hapticTick(): void {
	if (!isNative) return;
	void load()
		.then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }))
		.catch(() => {});
}

export function hapticError(): void {
	if (!isNative) return;
	void load()
		.then(({ Haptics, NotificationType }) => Haptics.notification({ type: NotificationType.Error }))
		.catch(() => {});
}
