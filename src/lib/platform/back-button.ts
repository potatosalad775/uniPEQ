/**
 * Android back button, as a stack of handlers. Whatever is on top (an open sheet, a dialog, the
 * shell's "go to the EQ tab") gets the press first; a handler returns true when it consumed it.
 * Pure TypeScript so it can be tested and driven without Capacitor; native.ts wires it up.
 */
export type BackHandler = () => boolean;

// Wrapped per registration, so a remover only ever removes its own entry, even when the same
// function is registered twice or the remover runs twice.
const handlers: { handler: BackHandler }[] = [];

/** Registers a handler on top of the stack. Returns its remover. */
export function onBack(handler: BackHandler): () => void {
	const entry = { handler };
	handlers.push(entry);
	return () => {
		const index = handlers.indexOf(entry);
		if (index >= 0) handlers.splice(index, 1);
	};
}

/** Offers the press to each handler, newest first. False when none consumed it. */
export function dispatchBack(): boolean {
	for (let i = handlers.length - 1; i >= 0; i--) {
		if (handlers[i].handler()) return true;
	}
	return false;
}
