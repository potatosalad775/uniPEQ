/**
 * One short-lived message for things that happen in a dialog that has already closed ("Loaded
 * “Bass boost”. 1 band was turned off."), shown by the shell's `Toast`. The device's own outcomes
 * stay in its status line (device-peq invariant 6).
 */
const SHOW_MS = 6000;

class NoticeStore {
	text = $state<string | null>(null);
	isError = $state(false);
	#timer: ReturnType<typeof setTimeout> | undefined;

	say(text: string, isError = false): void {
		clearTimeout(this.#timer);
		this.text = text;
		this.isError = isError;
		this.#timer = setTimeout(() => this.clear(), isError ? SHOW_MS * 2 : SHOW_MS);
	}

	clear(): void {
		clearTimeout(this.#timer);
		this.text = null;
		this.isError = false;
	}
}

export const noticeStore = new NoticeStore();
