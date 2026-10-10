/** Built by scripts/third-party-licenses.ts. */
declare module 'virtual:third-party-licenses' {
	export type Notice = import('../scripts/third-party-licenses.ts').Notice;
	/** uniPEQ's own LICENSE (GPL-3.0). */
	export const license: string;
	/** What the app ships, packages by name then the non-npm entries; null on the dev server. */
	export const notices: Notice[] | null;
}
