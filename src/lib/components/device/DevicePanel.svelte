<!--
	Adapted from modernGraphTool src/lib/components/features/DevicePeq.svelte @ 23ddc4dd: connect
	(plus the demo device), device row, Device EQ, Read and Write, auto-write and the push dialog.
	The Phase 4 Main screen re-lays this out around the graph.
-->
<script lang="ts">
	import { FlaskConical, Info, TriangleAlert, Usb } from '@lucide/svelte';
	import { domainBounds } from '@potatosalad775/eqcaps-core';
	import Button from '$lib/components/atoms/Button.svelte';
	import InfoPopover from '$lib/components/atoms/InfoPopover.svelte';
	import Switch from '$lib/components/atoms/Switch.svelte';
	import { panelStatus } from '$lib/device-peq/panel-status';
	import { needsConfirmation, type PushPlan } from '$lib/device-peq/push-plan';
	import * as m from '$lib/paraglide/messages';
	import { isNative } from '$lib/platform/native';
	import { devicePeqService } from '$lib/services/device-peq-service.svelte';
	import { devicePeqStore } from '$lib/stores/device-peq-store.svelte';
	import PushDialog from './PushDialog.svelte';

	const INSPECTOR_URL = 'https://potatosalad775.github.io/eqcaps/connect';
	const ISSUES_URL = 'https://github.com/potatosalad775/eqcaps/issues/new';

	/** USB HID: the DeviceIo plugin on Android, WebHID in Chrome and Edge. */
	const canConnect = isNative || (typeof navigator !== 'undefined' && 'hid' in navigator);

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

	const isDraft = $derived(
		connection?.profileSource !== 'guess' && connection?.profile.meta.status === 'draft'
	);
	const isExperimental = $derived(!!caps?.experimental && connection?.profileSource !== 'guess');
	const isWriteOnly = $derived(!!caps && !caps.canRead);
	const noticesWarn = $derived(connection?.profileSource === 'guess' || isDraft || isExperimental);
	const hasNotices = $derived(noticesWarn || connection?.profileSource === 'group' || isWriteOnly);
	const reportUrl = $derived.by(() => {
		if (!connection?.profileId) return null;
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

	/** The one line under Read and Write. */
	const status = $derived(
		panelStatus({
			message: devicePeqStore.statusMessage,
			messageIsError: devicePeqStore.statusIsError,
			autoWriting: devicePeqService.autoWriting,
			autoPaused: devicePeqStore.autoPaused,
			autoClipRisk: devicePeqStore.autoClipRisk,
			builtIn,
			unreachable:
				(!!caps?.canWrite && !builtIn && !writeTarget) || (!!caps?.canRead && !readTarget),
			inSync: devicePeqStore.inSync
		})
	);

	// ── Writing: straight away when the device holds the list exactly, else after a review ──

	let showPushDialog = $state(false);
	let pendingPlan = $state.raw<PushPlan | null>(null);

	async function write() {
		const plan = await devicePeqService.prepare();
		if (!plan) return;
		if (needsConfirmation(plan)) {
			pendingPlan = plan;
			showPushDialog = true;
		} else {
			void devicePeqService.write(plan);
		}
	}
	const toneClass = {
		muted: 'text-base-content/70',
		success: 'text-success',
		warning: 'text-warning',
		error: 'text-error'
	} as const;
</script>

<section aria-labelledby="device-heading" class="flex flex-col gap-3 rounded-xl bg-base-100 p-4">
	<h2 id="device-heading" class="text-sm font-semibold">{m.device_peq_label()}</h2>

	{#if !connection}
		{#if devicePeqService.choice}
			<fieldset class="flex flex-col gap-2">
				<legend class="mb-1 text-sm text-base-content/70">
					{isNative ? m.device_peq_choose_device_prompt() : m.device_peq_choose_prompt()}
				</legend>
				{#each devicePeqService.choice.candidates as candidate (candidate.id)}
					<label class="flex items-center gap-2 text-sm">
						<input type="radio" name="device-choice" value={candidate.id} bind:group={chosenId} />
						{candidate.label}
					</label>
				{/each}
				<div class="flex gap-2">
					<Button
						title={m.device_peq_choose_confirm()}
						size="sm"
						disabled={!chosenId || devicePeqStore.isConnecting}
						onclick={() => devicePeqService.choose(chosenId)}
					>
						{m.device_peq_choose_confirm()}
					</Button>
					<Button
						title={m.device_peq_choose_cancel()}
						size="sm"
						variant="ghost"
						onclick={() => devicePeqService.cancelChoice()}
					>
						{m.device_peq_choose_cancel()}
					</Button>
				</div>
			</fieldset>
		{:else}
			{#if !canConnect}
				<p class="text-sm text-base-content/70">{m.device_peq_no_webhid()}</p>
			{/if}
			<div class="flex flex-wrap gap-2">
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
				<a
					href={INSPECTOR_URL}
					target="_blank"
					rel="noopener noreferrer"
					class="text-primary underline-offset-4 hover:underline"
				>
					{m.device_peq_help_add()}
				</a>
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
				<p class="truncate text-sm font-medium">{connection.name}</p>
				<p class="text-xs text-base-content/60">{limitsSummary}</p>
			</div>
			<div class="flex shrink-0 items-center gap-1">
				{#if hasNotices}
					<InfoPopover label={m.device_peq_facts()} size="sm" align="end">
						{#snippet icon()}
							{#if noticesWarn}
								<TriangleAlert class="size-4 text-warning" />
							{:else}
								<Info class="size-4" />
							{/if}
						{/snippet}
						{#if connection.profileSource === 'guess'}
							<p>
								{m.device_peq_guess_notice()}
								<a
									href={INSPECTOR_URL}
									target="_blank"
									rel="noopener noreferrer"
									class="text-primary underline-offset-4 hover:underline"
								>
									{m.device_peq_help_add()}
								</a>
							</p>
						{:else if connection.profileSource === 'group'}
							<p>{m.device_peq_group_notice()}</p>
						{/if}
						{#if isDraft}
							<p>
								{m.device_peq_draft_notice()}
								{#if reportUrl}
									<a
										href={reportUrl}
										target="_blank"
										rel="noopener noreferrer"
										class="text-primary underline-offset-4 hover:underline"
									>
										{m.device_peq_report_limits()}
									</a>
								{/if}
							</p>
						{/if}
						{#if isExperimental}
							<p>{m.device_peq_experimental()}</p>
						{/if}
						{#if isWriteOnly}
							<p>{m.device_peq_write_only()}</p>
						{/if}
					</InfoPopover>
				{/if}
				<Button
					title={m.device_peq_disconnect()}
					size="sm"
					variant="ghost"
					onclick={() => devicePeqService.disconnect()}
				>
					{m.device_peq_disconnect()}
				</Button>
			</div>
		</div>

		{#if devicePeqStore.needsReconnect}
			<div class="flex items-center justify-between gap-2">
				<p class="text-sm text-base-content/70">{m.device_peq_reconnect_prompt()}</p>
				<Button
					title={m.device_peq_reconnect()}
					size="sm"
					disabled={devicePeqStore.isConnecting}
					onclick={() => devicePeqService.reconnect()}
				>
					{m.device_peq_reconnect()}
				</Button>
			</div>
		{:else}
			{#if hasPresets}
				<div class="flex items-center gap-1">
					<label class="flex min-w-0 flex-1 items-center gap-2 text-sm text-base-content/70">
						<span class="shrink-0">{eqLabel}</span>
						<select
							value={eqValue}
							disabled={devicePeqStore.isBusy}
							onchange={(e) => {
								const select = e.currentTarget;
								// A failed switch leaves the device as it was: show that again.
								void devicePeqService.switchTo(select.value).then(() => (select.value = eqValue));
							}}
							class="min-w-0 flex-1 rounded-md border border-base-content/20 bg-base-200 px-2 py-1.5 text-sm text-base-content disabled:opacity-60"
						>
							{#each eqOptions as option (option.value)}
								<option value={option.value} disabled={option.disabled}>{option.label}</option>
							{/each}
						</select>
					</label>
					<InfoPopover label={m.info_popover_about({ topic: eqLabel })}>
						<p>{caps?.canEnable ? m.device_peq_eq_hint() : m.device_peq_preset_hint()}</p>
					</InfoPopover>
				</div>
			{:else if hasOnOff}
				<Switch
					size="sm"
					bind:checked={
						() => devicePeqStore.eqEnabled !== false,
						(on) => void devicePeqService.switchTo(on ? 'on' : 'off')
					}
					disabled={devicePeqStore.isBusy}
					labelText={m.device_peq_eq_label()}
					labelClass="text-sm text-base-content/70"
				/>
			{/if}

			<div class="flex flex-wrap items-center gap-2">
				{#if caps?.canRead}
					<Button
						title={readTarget ? m.device_peq_read_title() : m.device_peq_unreachable()}
						size="sm"
						variant="outline"
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
						size="sm"
						disabled={!writeTarget || devicePeqStore.isBusy}
						onclick={write}
					>
						{devicePeqStore.isWriting ? m.device_peq_writing() : m.device_peq_write()}
					</Button>
				{/if}
			</div>

			{#if canAutoWrite}
				<div class="flex items-center gap-1">
					<Switch
						size="sm"
						bind:checked={
							() => devicePeqService.autoWriteOn, (on) => devicePeqService.setAutoWrite(on)
						}
						labelText={m.device_peq_auto_write()}
						labelClass="text-sm text-base-content/70"
					/>
					<InfoPopover label={m.info_popover_about({ topic: m.device_peq_auto_write() })}>
						<p>{m.device_peq_auto_write_hint()}</p>
					</InfoPopover>
				</div>
			{/if}
		{/if}

		<!-- Always rendered: a live region has to exist before its text changes -->
		<div class="flex items-center gap-2">
			<p class="min-w-0 flex-1 text-sm {status ? toneClass[status.tone] : ''}" role="status">
				{status?.text ?? ''}
			</p>
			{#if status?.action === 'review'}
				<Button
					title={m.device_peq_auto_review()}
					size="sm"
					variant="outline"
					class="shrink-0"
					disabled={devicePeqStore.isBusy}
					onclick={write}
				>
					{m.device_peq_auto_review()}
				</Button>
			{/if}
		</div>
	{/if}
</section>

<PushDialog
	bind:open={showPushDialog}
	plan={pendingPlan}
	deviceName={connection?.name ?? ''}
	onConfirm={() => pendingPlan && devicePeqService.write(pendingPlan)}
/>
