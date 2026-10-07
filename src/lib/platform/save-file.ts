/**
 * Handing the user a text file. In a browser it's a download. The Android WebView drops
 * downloads, so there the text goes to the clipboard until the app shares files natively
 * (docs/rebuild-plan.md, decision 20).
 */
import { isNative } from './native';

export async function saveTextFile(
	name: string,
	text: string,
	type: string
): Promise<'downloaded' | 'copied'> {
	if (isNative) {
		await navigator.clipboard.writeText(text);
		return 'copied';
	}
	const url = URL.createObjectURL(new Blob([text], { type }));
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
	return 'downloaded';
}
