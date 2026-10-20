// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
	const __APP_VERSION__: string;

	interface ImportMetaEnv {
		/** `github` for the sideloaded APK; see `distribution` in #lib/platform/build.js. */
		readonly VITE_DISTRIBUTION?: string;
	}
}

export {};
