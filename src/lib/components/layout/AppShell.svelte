<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onBack } from '$lib/platform/back-button';
	import * as m from '$lib/paraglide/messages';
	import { TABS, activeTab } from './tabs';
	import LinkApprovalDialog from '$lib/components/link/LinkApprovalDialog.svelte';
	import Toast from './Toast.svelte';

	let { children }: { children: Snippet } = $props();

	// The route id, not the URL path: it leaves out the base path (GitHub Pages serves under /uniPEQ).
	const current = $derived(activeTab(page.route.id ?? '/'));

	// Lowest back handler: from another tab, back goes home. On home it declines, and native.ts
	// backgrounds the app. Tab switches replace history, so there is no tab history to walk.
	$effect(() =>
		onBack(() => {
			if (current === TABS[0]) return false;
			void goto(TABS[0].href, { replaceState: true });
			return true;
		})
	);
</script>

<!--
	Phone: content above a bottom tab bar. `wide:` and up: a side rail beside the content.
	The nav comes first in the DOM (landmark order); flex-col-reverse puts it at the bottom on phones.
-->
<div class="flex h-dvh flex-col-reverse wide:flex-row">
	<nav
		aria-label={m.nav_label()}
		class="shrink-0 border-base-content/10 bg-base-100 pr-(--inset-right) pb-(--inset-bottom) pl-(--inset-left)
			max-wide:border-t wide:w-24 wide:border-r wide:pt-[calc(var(--inset-top)+0.75rem)] wide:pr-0"
	>
		<ul class="flex wide:flex-col wide:gap-2">
			{#each TABS as tab (tab.path)}
				{@const active = tab === current}
				<li class="flex-1 wide:flex-none">
					<a
						href={tab.href}
						data-sveltekit-replacestate
						aria-current={active ? 'page' : undefined}
						class="group flex flex-col items-center gap-1 py-2 text-xs font-medium focus-visible:outline-none
							{active ? 'text-base-content' : 'text-base-content/60 hover:text-base-content'}"
					>
						<span
							class="flex h-8 w-14 items-center justify-center rounded-full group-focus-visible:ring-2 group-focus-visible:ring-accent
								{active ? 'bg-primary/15 text-primary' : 'group-hover:bg-base-content/5'}"
						>
							<tab.icon class="size-5" aria-hidden="true" />
						</span>
						{tab.label()}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<main
		class="flex min-h-0 flex-1 flex-col pt-(--inset-top) pr-(--inset-right) max-wide:pl-(--inset-left) wide:pb-(--inset-bottom)"
	>
		{@render children()}
	</main>
</div>

<Toast />
<LinkApprovalDialog />
