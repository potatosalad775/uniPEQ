/**
 * Handing the user a text file. In a browser it's a download. The Android WebView drops
 * downloads, so there the file is written to the app's cache and offered through the system share
 * sheet (save to Files, Drive, a chat, …). Android's FileProvider already exposes the cache
 * (`res/xml/file_paths.xml`). The plugins load only on native.
 */
import { isNative } from './native';

/** `cancelled`: the share sheet was closed without picking anything. */
export type SaveOutcome = 'downloaded' | 'shared' | 'cancelled';

export async function saveTextFile(name: string, text: string, type: string): Promise<SaveOutcome> {
	if (isNative) return shareFile(name, text);
	const url = URL.createObjectURL(new Blob([text], { type }));
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
	return 'downloaded';
}

async function shareFile(name: string, text: string): Promise<SaveOutcome> {
	const [{ Directory, Encoding, Filesystem }, { Share }] = await Promise.all([
		import('@capacitor/filesystem'),
		import('@capacitor/share')
	]);
	const { uri } = await Filesystem.writeFile({
		path: `exports/${name}`,
		data: text,
		directory: Directory.Cache,
		encoding: Encoding.UTF8,
		recursive: true
	});
	try {
		await Share.share({ title: name, files: [uri] });
		return 'shared';
	} catch (e) {
		// The plugin rejects with "Share canceled" when the sheet is dismissed.
		if (e instanceof Error && /cancel/i.test(e.message)) return 'cancelled';
		throw e;
	}
}
