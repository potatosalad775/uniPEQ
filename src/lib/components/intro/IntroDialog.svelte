<!--
	The first-launch introduction, a few pages with Back and Next: what uniPEQ does, connecting,
	presets, the modernGraphTool link. Where no device can be reached, a first page says why and
	what to do instead; an Android browser gets only that page, since the app it points to has its
	own intro. Full screen on a phone, a card on `wide:`. On bits-ui's Dialog rather than
	`ModalDialog`, whose title sits above the body: here each page leads with its picture.
	Mounted once in the shell, so Settings can reopen it from its tab.
-->
<script lang="ts">
	import {
		ExternalLink,
		FlaskConical,
		Library,
		Link,
		SlidersHorizontal,
		Usb
	} from '@lucide/svelte';
	import { Dialog } from 'bits-ui';
	import type { Component } from 'svelte';
	import { goto } from '$app/navigation';
	import { page as appPage } from '$app/state';
	import Button from '$lib/components/atoms/Button.svelte';
	import { TABS, activeTab } from '$lib/components/layout/tabs';
	import { linkStore } from '$lib/link/link-store.svelte';
	import * as m from '$lib/paraglide/messages';
	import { onBack } from '$lib/platform/back-button';
	import { ANDROID_DOWNLOAD_URL, environment } from '$lib/platform/environment';
	import { isNative } from '$lib/platform/native';
	import { devicePeqService } from '$lib/services/device-peq-service.svelte';
	import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
	import { introStore } from '$lib/stores/intro-store.svelte';
	import { environmentCopy } from './environment-copy';

	interface Page {
		title: string;
		icon: Component;
		body: string[];
		/** Pages outside the app, under the body. */
		links?: { label: string; href: string }[];
	}

	// eqcaps' catalogue filtered to what uniPEQ drives: hardware over USB HID.
	const COMPATIBLE_URL = 'https://potatosalad775.github.io/eqcaps/?kind=hardware&connection=hid';
	const DATABASES_URL = 'https://github.com/potatosalad775/modernGraphTool/discussions/86';
	const LINK_DOCS_URL =
		'https://potatosalad775.github.io/modernGraphTool/docs/features/unipeq-link/';

	const notice = environmentCopy(environment);
	const pages: Page[] = [
		...(notice
			? [{ title: notice.title, icon: notice.icon, body: [notice.body, m.env_demo_hint()] }]
			: []),
		...(environment === 'android'
			? []
			: [
					{
						title: m.intro_welcome_title(),
						icon: SlidersHorizontal,
						body: [m.intro_welcome_body(), m.intro_welcome_hardware()],
						links: [{ label: m.intro_url_compatible(), href: COMPATIBLE_URL }]
					},
					{
						title: m.intro_connect_title(),
						icon: Usb,
						body: [
							isNative ? m.intro_connect_body_native() : m.intro_connect_body_web(),
							m.intro_connect_fit()
						]
					},
					{ title: m.intro_presets_title(), icon: Library, body: [m.intro_presets_body()] },
					{
						title: m.intro_link_title(),
						icon: Link,
						body: isNative ? [m.intro_link_body(), m.intro_link_native()] : [m.intro_link_body()],
						links: [
							{ label: m.intro_url_databases(), href: DATABASES_URL },
							{ label: m.intro_url_docs(), href: LINK_DOCS_URL }
						]
					}
				])
	];

	let content = $state<HTMLElement | null>(null);
	let index = $state(0);
	const current = $derived(pages[index]);
	const last = $derived(index === pages.length - 1);
	/** An Android browser: the only page sends the user to the app. */
	const getApp = environment === 'android';

	function close() {
		index = 0;
		introStore.close();
	}

	function step(by: number) {
		index = Math.min(pages.length - 1, Math.max(0, index + by));
	}

	function tryDemo() {
		close();
		if (activeTab(appPage.route.id ?? '/') !== TABS[0]) {
			void goto(TABS[0].href, { replaceState: true });
		}
		void devicePeqService.connect('demo');
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowRight') step(1);
		else if (event.key === 'ArrowLeft') step(-1);
	}

	$effect(() => {
		if (!introStore.open) return;
		return onBack(() => {
			close();
			return true;
		});
	});

	// A link joining (opened from modernGraphTool) asks "Link with …?": the first-launch intro
	// gives it the screen and comes back next launch.
	$effect(() => {
		if (introStore.open && linkStore.active) introStore.deferForLink();
	});
</script>

<Dialog.Root bind:open={() => introStore.open, (open) => !open && close()}>
	<Dialog.Portal>
		<Dialog.Overlay class="fixed inset-0 z-40 animate-fade-in bg-black/40" />
		<!-- Focus starts on the page itself, not its first link, so no ring shows until Tab. -->
		<Dialog.Content
			bind:ref={content}
			aria-label={m.intro_label()}
			{onkeydown}
			onOpenAutoFocus={(event) => {
				event.preventDefault();
				content?.focus();
			}}
			class="fixed inset-0 z-50 flex flex-col gap-6 bg-base-100 pt-[calc(2rem+var(--inset-top))] pr-[calc(1.5rem+var(--inset-right))] pb-[calc(1rem+var(--inset-bottom))] pl-[calc(1.5rem+var(--inset-left))] outline-none
				wide:inset-auto wide:top-1/2 wide:left-1/2 wide:min-h-[26rem] wide:w-11/12 wide:max-w-md wide:-translate-x-1/2 wide:-translate-y-1/2 wide:rounded-2xl wide:bg-base-200 wide:px-6 wide:pt-8 wide:pb-5 wide:shadow-2xl"
		>
			<div
				class="flex min-h-0 flex-1 flex-col justify-center gap-4 overflow-y-auto wide:justify-start"
			>
				<span
					class="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
					aria-hidden="true"
				>
					<current.icon class="size-8" />
				</span>
				<Dialog.Title class="text-xl font-semibold text-base-content">{current.title}</Dialog.Title>
				<Dialog.Description class="flex flex-col gap-3 text-sm text-base-content/70">
					{#each current.body as paragraph, i (i)}
						<span class="block">{paragraph}</span>
					{/each}
				</Dialog.Description>
				{#if current.links}
					<ul class="flex flex-col items-start">
						{#each current.links as link (link.href)}
							<li>
								<a
									href={link.href}
									target="_blank"
									rel="noopener noreferrer"
									class="inline-flex items-center gap-1.5 rounded py-1 text-sm font-medium text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none touch:min-h-10"
								>
									{link.label}
									<ExternalLink class="size-3.5" aria-hidden="true" />
								</a>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			{#if pages.length > 1}
				<div class="flex justify-center gap-1.5" aria-hidden="true">
					{#each pages as _, i (i)}
						<span
							class="h-1.5 rounded-full transition-all {i === index
								? 'w-5 bg-primary'
								: 'w-1.5 bg-base-content/20'}"
						></span>
					{/each}
				</div>
				<p class="sr-only" aria-live="polite">
					{m.intro_step({ current: index + 1, total: pages.length })}
				</p>
			{/if}

			<div class="flex flex-wrap-reverse items-center justify-end gap-2">
				{#if getApp}
					<Button title={m.env_continue()} variant="ghost" class="mr-auto" onclick={close}>
						{m.env_continue()}
					</Button>
					<Button
						title={m.env_download()}
						href={ANDROID_DOWNLOAD_URL}
						target="_blank"
						rel="noopener noreferrer"
						onclick={close}
					>
						{m.env_download()}
					</Button>
				{:else}
					{#if index === 0}
						<Button title={m.intro_skip()} variant="ghost" class="mr-auto" onclick={close}>
							{m.intro_skip()}
						</Button>
					{:else}
						<Button title={m.intro_back()} variant="ghost" class="mr-auto" onclick={() => step(-1)}>
							{m.intro_back()}
						</Button>
					{/if}
					{#if !last}
						<Button title={m.intro_next()} onclick={() => step(1)}>{m.intro_next()}</Button>
					{:else}
						<Button title={m.intro_start()} onclick={close}>{m.intro_start()}</Button>
						{#if !devicePeqStore.connection}
							<Button
								title={m.device_peq_connect_demo_title()}
								variant="ghost"
								class="gap-2"
								disabled={devicePeqStore.isConnecting}
								onclick={tryDemo}
							>
								<FlaskConical class="size-4" aria-hidden="true" />
								{m.device_peq_connect_demo()}
							</Button>
						{/if}
					{/if}
				{/if}
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
