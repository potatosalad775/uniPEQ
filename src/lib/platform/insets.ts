/** The system bars' insets, px, as `--inset-*` (layout.css) gives them. */
export interface Insets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/**
 * Measured on a hidden probe: `--inset-*` can come down to `env()`, which only resolves in an
 * element's style. For what can't take a CSS length, such as a floating menu's collision padding.
 */
export function safeInsets(): Insets {
	if (typeof document === 'undefined') return { top: 0, right: 0, bottom: 0, left: 0 };
	const probe = document.createElement('div');
	probe.style.cssText =
		'position:fixed;visibility:hidden;pointer-events:none;' +
		'padding:var(--inset-top) var(--inset-right) var(--inset-bottom) var(--inset-left)';
	document.body.append(probe);
	const style = getComputedStyle(probe);
	const px = (v: string) => parseFloat(v) || 0;
	const insets = {
		top: px(style.paddingTop),
		right: px(style.paddingRight),
		bottom: px(style.paddingBottom),
		left: px(style.paddingLeft)
	};
	probe.remove();
	return insets;
}
