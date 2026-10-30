<!--
	Adapted from modernGraphTool src/lib/components/features/DevicePeq.svelte @ 23ddc4dd: connect
	(plus the demo device), device row, Device EQ, Read and Write, auto-write and the push dialog.
	Added: the profile's status and experimental badges, links to the profile in the eqcaps
	inspector and to its wrong-constraint form, list rows with the switch trailing and hints as
	supporting text, Device EQ as a select menu, the connection facts inline rather than in a
	popover; the status line moved to the EQ tab's sync bar (with the review dialog, now
	`devicePeqService.review`); the device's own settings (`DeviceControls`) and its firmware. On a
	phone this is the device sheet's body. The demo device (offered in every build) shows as
	simulated, without a status or eqcaps links: eqcaps doesn't list its profile.
-->
<script lang="ts">
	import { ChevronDown, FlaskConical, TriangleAlert, Usb } from '@lucide/svelte';
	import { domainBounds } from '@potatosalad775/eqcaps-core';
	import Badge from '#lib/components/atoms/Badge.svelte';
	import Button from '#lib/components/atoms/Button.svelte';
	import ListRow from '#lib/components/atoms/ListRow.svelte';
	import SelectMenu from '#lib/components/atoms/SelectMenu.svelte';
	import Switch from '#lib/components/atoms/Switch.svelte';
	import DeviceControls from './DeviceControls.svelte';
	import * as m from '#lib/paraglide/messages.js';
	import { environmentCopy } from '#lib/components/intro/environment-copy.js';
	import { ANDROID_DOWNLOAD_URL, environment } from '#lib/platform/environment.js';
	import { isNative } from '#lib/platform/native.js';
	import {
		canConnectUsb as canConnect,
		devicePeqService
	} from '#lib/services/device-peq-service.svelte.js';
	import { devicePeqStore } from '#lib/stores/device-peq-store.svelte.js';

	let {
		heading = true
	}: { /** Show the "Device" heading (not in the sheet, which has its own). */ heading?: boolean } =
		$props();

	const INSPECTOR_URL = 'https://potatosalad775.github.io/eqcaps/connect';
	const PROFILE_URL = 'https://potatosalad775.github.io/eqcaps/p/';
	const ISSUES_URL = 'https://github.com/potatosalad775/eqcaps/issues/new';

	/** Why this environment can't reach a device, if it can't. */
	const notice = environmentCopy(environment);
	const connection = $derived(devicePeqStore.connection);
	const caps = $derived(connection?.device.capabilities);
	/** The picked candidate; each new choice starts on its first one. */
	let chosenId = $derived(devicePeqService.choice?.candidates[0]?.id ?? '');

	// ── Device EQ: what the device plays, and what Read reaches ──────────────

	const eqOptions = $derived.by(() => {
		if (!caps) return [];
		const out: { value: string; label: string; disabled?: boolean }[] = [];
		const selection = devicePeqStore.selection;
		if (selection === null && caps.canEnable) {
			out.push({ value: 'unknown', label: m.device_peq_eq_unknown(), disabled: true });
		}
		if (selection === 'other') {
			out.push({ value: 'other', label: m.device_peq_eq_other(), disabled: true });
		}
		for (const slot of devicePeqStore.slots) out.push({ value: `p${slot.id}`, label: slot.name });
		if (caps.canEnable) out.push({ value: 'off', label: m.device_peq_eq_off() });
		return out;
	});
	/** Several memories: a dropdown. One or none (a walkplay dongle): an on/off switch. */
	const hasPresets = $derived(
		!!caps &&
			devicePeqStore.slots.length > 1 &&
			(caps.canEnable || caps.readsSlot || caps.writesSlot)
	);
	const hasOnOff = $derived(!!caps?.canEnable && devicePeqStore.slots.length <= 1);
	const eqLabel = $derived(caps?.canEnable ? m.device_peq_eq_label() : m.device_peq_preset());
	const eqValue = $derived.by(() => {
		const selection = devicePeqStore.selection;
		if (selection === null) return caps?.canEnable ? 'unknown' : '';
		if (selection === 'off' || selection === 'other') return selection;
		return `p${selection}`;
	});

	const limitsSummary = $derived.by(() => {
		const profile = connection?.profile;
		if (!profile) return '';
		const bands = profile.bandCount ?? profile.bands?.length ?? 0;
		const gain = profile.band.gain;
		if (!gain) return m.device_peq_limits_bands({ bands });
		const { min, max } = domainBounds(gain);
		return m.device_peq_limits({ bands, min, max });
	});

	// ── What's worth knowing about the profile: one popover in the device row ──

	/** The simulated demo device: no eqcaps status or links, a "simulated" note instead. */
	const isDemo = $derived(connection?.profileSource === 'demo');
	const isDraft = $derived(
		connection?.profileSource !== 'guess' && connection?.profile.meta.status === 'draft'
	);
	const isExperimental = $derived(!!caps?.experimental && connection?.profileSource !== 'guess');
	const isWriteOnly = $derived(!!caps && !caps.canRead);
	const noticesWarn = $derived(connection?.profileSource === 'guess' || isDraft || isExperimental);
	const profileUrl = $derived(
		connection?.profileId && !isDemo ? PROFILE_URL + encodeURIComponent(connection.profileId) : null
	);
	const hasNotices = $derived(
		isDemo || noticesWarn || connection?.profileSource === 'group' || isWriteOnly || !!profileUrl
	);

	/** How far the profile's limits are confirmed (eqcaps `meta.status`), as a badge. */
	const statusBadge = $derived.by(() => {
		if (!connection) return null;
		if (isDemo) return { text: m.device_peq_status_simulated(), tone: 'info' as const };
		if (connection.profileSource === 'guess') {
			return { text: m.device_peq_status_guessed(), tone: 'warning' as const };
		}
		const status = connection.profile.meta.status;
		if (status === 'draft') return { text: m.device_peq_status_draft(), tone: 'warning' as const };
		if (status === 'deprecated') {
			return { text: m.device_peq_status_deprecated(), tone: 'error' as const };
		}
		if (status === 'maintainer-verified') {
			return { text: m.device_peq_status_maintainer(), tone: 'success' as const };
		}
		return { text: m.device_peq_status_community(), tone: 'info' as const };
	});
	const reportUrl = $derived.by(() => {
		if (!connection?.profileId || isDemo) return null;
		const url = new URL(ISSUES_URL);
		url.searchParams.set('template', 'wrong-constraint.yml');
		url.searchParams.set('title', `Wrong constraint: ${connection.profileId}`);
		url.searchParams.set('profile', connection.profileId);
		url.searchParams.set('app', 'uniPEQ');
		return url.href;
	});

	const readTarget = $derived(devicePeqStore.readTarget);
	const writeTarget = $derived(devicePeqStore.writeTarget);
	/** Device EQ shows a built-in preset: Write is off by design, not because of where it is. */
	const builtIn = $derived(!!caps?.canWrite && !devicePeqStore.targetWritable);
	/** Auto-write needs a device that can be written without restarting after each save. */
	const canAutoWrite = $derived(!!caps?.canWrite && !caps.disconnectOnSave);

	/** Device EQ's choices for its menu: the listed presets, and off where it can be. */
	const eqChoices = $derived(
		eqOptions.flatMap((o) => (o.disabled ? [] : [{ value: o.value, label: o.label }]))
	);
	const eqCurrentLabel = $derived(eqOptions.find((o) => o.value === eqValue)?.label ?? '');
</script>

{#snippet link(href: string, text: string)}
	<!-- External: `resolve()` is for app routes. -->
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<a
		{href}
		target="_blank"
		rel="noopener noreferrer"
		class="text-primary underline-offset-4 hover:underline">{text}</a
	>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
{/snippet}

<section
	aria-labelledby={heading ? 'device-heading' : undefined}
	aria-label={heading ? undefined : m.device_peq_label()}
	class="flex flex-col gap-3 {heading ? 'rounded-xl bg-base-100 p-4' : ''}"
>
	{#if heading}
		<h2 id="device-heading" class="text-sm font-semibold">{m.device_peq_label()}</h2>
	{/if}

	{#if !connection}
		{#if devicePeqService.choice}
			<fieldset class="flex flex-col gap-1">
				<legend class="mb-1 text-sm text-base-content/70">
					{isNative ? m.device_peq_choose_device_prompt() : m.device_peq_choose_prompt()}
				</legend>
				{#each devicePeqService.choice.candidates as candidate (candidate.id)}
					<label
						class="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-1 text-sm touch:min-h-12 touch:text-base"
					>
						<input
							type="radio"
							name="device-choice"
							value={candidate.id}
							bind:group={chosenId}
							class="size-4 accent-primary touch:size-5"
						/>
						{candidate.label}
					</label>
				{/each}
				<div class="mt-1 flex gap-2">
					<Button
						title={m.device_peq_choose_confirm()}
						class="flex-1"
						disabled={!chosenId || devicePeqStore.isConnecting}
						onclick={() => devicePeqService.choose(chosenId)}
					>
						{m.device_peq_choose_confirm()}
					</Button>
					<Button
						title={m.device_peq_choose_cancel()}
						variant="ghost"
						class="flex-1"
						onclick={() => devicePeqService.cancelChoice()}
					>
						{m.device_peq_choose_cancel()}
					</Button>
				</div>
			</fieldset>
		{:else}
			{#if notice}
				<p class="text-sm text-base-content/70">{notice.body}</p>
			{/if}
			<div class="flex flex-col gap-2">
				{#if environment === 'android'}
					<Button
						title={m.env_download()}
						href={ANDROID_DOWNLOAD_URL}
						target="_blank"
						rel="noopener noreferrer"
					>
						{m.env_download()}
					</Button>
				{/if}
				{#if canConnect}
					<Button
						title={m.device_peq_connect_usb()}
						class="gap-2"
						disabled={devicePeqStore.isConnecting}
						onpointerenter={() => devicePeqService.warmUp()}
						onfocus={() => devicePeqService.warmUp()}
						onclick={() => devicePeqService.connect('hid')}
					>
						<Usb class="size-4" aria-hidden="true" />
						{devicePeqStore.isConnecting ? m.device_peq_connecting() : m.device_peq_connect_usb()}
					</Button>
				{/if}
				<Button
					title={m.device_peq_connect_demo_title()}
					variant="outline"
					class="gap-2"
					disabled={devicePeqStore.isConnecting}
					onclick={() => devicePeqService.connect('demo')}
				>
					<FlaskConical class="size-4" aria-hidden="true" />
					{m.device_peq_connect_demo()}
				</Button>
			</div>
		{/if}

		{#if devicePeqService.notFound === 'unsupported'}
			<p class="text-sm text-base-content/70">
				{m.device_peq_unsupported()}
				{@render link(INSPECTOR_URL, m.device_peq_help_add())}
			</p>
		{:else if devicePeqService.notFound === 'no-device'}
			<p class="text-sm text-base-content/70">{m.device_peq_no_device()}</p>
		{/if}

		{#if devicePeqStore.statusMessage}
			<p
				class="text-sm {devicePeqStore.statusIsError ? 'text-error' : 'text-base-content/70'}"
				role="status"
			>
				{devicePeqStore.statusMessage}
			</p>
		{/if}
	{:else}
		<div class="flex items-start justify-between gap-2">
			<div class="min-w-0">
				<p class="truncate font-medium">{connection.name}</p>
				<p class="text-xs text-base-content/60 touch:text-sm">
					{limitsSummary}{#if devicePeqStore.firmware}
						· {m.device_peq_firmware({ version: devicePeqStore.firmware })}{/if}
				</p>
				<p class="mt-1.5 flex flex-wrap gap-1">
					{#if statusBadge}
						<Badge tone={statusBadge.tone}>{statusBadge.text}</Badge>
					{/if}
					{#if isExperimental}
						<Badge tone="warning">
							<FlaskConical class="size-3" aria-hidden="true" />
							{m.device_peq_experimental_badge()}
						</Badge>
					{/if}
				</p>
			</div>
			<Button
				title={m.device_peq_disconnect()}
				variant="destructive"
				size="sm"
				class="mt-1 shrink-0"
				onclick={() => devicePeqService.disconnect()}
			>
				{m.device_peq_disconnect()}
			</Button>
		</div>

		<!-- What's worth knowing about the profile, as text rather than behind a popover. -->
		{#if hasNotices}
			<div
				class="-mb-2 flex flex-row gap-2.5 rounded-lg px-3 py-2 text-xs touch:text-sm {noticesWarn
					? 'bg-warning/10'
					: 'bg-base-200'}"
				aria-label={m.device_peq_facts()}
				role="group"
			>
				{#if noticesWarn}
					<TriangleAlert class="size-4 text-warning" aria-hidden="true" />
				{/if}
				<div class="flex flex-col gap-1">
					{#if isDemo}
						<p>{m.device_peq_demo_notice()}</p>
					{:else if connection.profileSource === 'guess'}
						<p>
							{m.device_peq_guess_notice()}
							{@render link(INSPECTOR_URL, m.device_peq_help_add())}
						</p>
					{:else if connection.profileSource === 'group'}
						<p>{m.device_peq_group_notice()}</p>
					{/if}
					{#if isDraft}
						<p>
							{m.device_peq_draft_notice()}
							{#if reportUrl}{@render link(reportUrl, m.device_peq_report_limits())}{/if}
						</p>
					{/if}
					{#if isExperimental}
						<p>{m.device_peq_experimental()}</p>
					{/if}
					{#if isWriteOnly}
						<p>{m.device_peq_write_only()}</p>
					{/if}
					{#if profileUrl}
						<p class="flex flex-wrap gap-x-3">
							{@render link(profileUrl, m.device_peq_view_profile())}
							{#if reportUrl && !isDraft}{@render link(
									reportUrl,
									m.device_peq_report_limits()
								)}{/if}
						</p>
					{/if}
				</div>
			</div>
		{/if}

		{#if devicePeqStore.needsReconnect}
			<div class="flex items-center justify-between gap-2">
				<p class="text-sm text-base-content/70">
					{devicePeqStore.isConnecting
						? m.device_peq_reconnecting()
						: m.device_peq_reconnect_prompt()}
				</p>
				<Button
					title={m.device_peq_reconnect()}
					size="sm"
					variant="outline"
					disabled={devicePeqStore.isConnecting}
					onclick={() => devicePeqService.reconnect({ choose: true })}
				>
					{m.device_peq_reconnect()}
				</Button>
			</div>
		{:else}
			<div class="-mx-4 flex flex-col divide-y divide-base-content/10">
				{#if hasPresets}
					<SelectMenu
						label={eqLabel}
						value={eqValue}
						options={eqChoices}
						onValueChange={(next) => void devicePeqService.switchTo(next)}
					>
						{#snippet trigger(props)}
							<ListRow
								label={eqLabel}
								description={caps?.canEnable ? m.device_peq_eq_hint() : m.device_peq_preset_hint()}
								disabled={devicePeqStore.isBusy}
								buttonProps={props}
							>
								{#snippet trailing()}
									<span class="max-w-32 truncate">{eqCurrentLabel}</span>
									<ChevronDown class="ml-1 size-4" aria-hidden="true" />
								{/snippet}
							</ListRow>
						{/snippet}
					</SelectMenu>
				{:else if hasOnOff}
					<ListRow label={m.device_peq_eq_label()} for="device-eq-on">
						{#snippet trailing()}
							<Switch
								id="device-eq-on"
								bind:checked={
									() => devicePeqStore.eqEnabled !== false,
									(on) => void devicePeqService.switchTo(on ? 'on' : 'off')
								}
								disabled={devicePeqStore.isBusy}
							/>
						{/snippet}
					</ListRow>
				{/if}
				{#if canAutoWrite}
					<ListRow
						label={m.device_peq_auto_write()}
						description={m.settings_auto_write_hint()}
						for="device-auto-write"
					>
						{#snippet trailing()}
							<Switch
								id="device-auto-write"
								bind:checked={
									() => devicePeqService.autoWriteOn, (on) => devicePeqService.setAutoWrite(on)
								}
							/>
						{/snippet}
					</ListRow>
				{/if}
			</div>

			<div class="flex gap-2">
				{#if caps?.canRead}
					<Button
						title={readTarget ? m.device_peq_read_title() : m.device_peq_unreachable()}
						variant="outline"
						class="flex-1"
						disabled={!readTarget || devicePeqStore.isBusy}
						onclick={() => devicePeqService.read()}
					>
						{devicePeqStore.isReading ? m.device_peq_reading() : m.device_peq_read()}
					</Button>
				{/if}
				{#if caps?.canWrite}
					<Button
						title={writeTarget
							? m.device_peq_write_title()
							: builtIn
								? m.device_peq_builtin()
								: m.device_peq_unreachable()}
						class="flex-1"
						disabled={!writeTarget || devicePeqStore.isBusy}
						onclick={() => devicePeqService.requestWrite()}
					>
						{devicePeqStore.isWriting ? m.device_peq_writing() : m.device_peq_write()}
					</Button>
				{/if}
			</div>

			<DeviceControls />
		{/if}
	{/if}
</section>
