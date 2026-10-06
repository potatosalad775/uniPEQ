/**
 * Simple in-memory logger with an inspectable ring buffer, shown in Settings → Diagnostics.
 * The eqcaps bridge takes `log: (message) => void`; pass `(message) => logger.debug(message)`.
 */

export interface Logger {
	debug(...args: unknown[]): void;
	info(...args: unknown[]): void;
	warn(...args: unknown[]): void;
	error(...args: unknown[]): void;
}

export interface LogEntry {
	time: string;
	level: 'debug' | 'info' | 'warn' | 'error';
	message: string;
}

const MAX_ENTRIES = 2000;

class AppLogger implements Logger {
	entries: LogEntry[] = [];
	verbose = false;

	private push(level: LogEntry['level'], args: unknown[]) {
		if (level === 'debug' && !this.verbose) return;
		const message = args
			.map((a) =>
				typeof a === 'string'
					? a
					: a instanceof Uint8Array
						? `[${Array.from(a).join(',')}]`
						: JSON.stringify(a)
			)
			.join(' ');
		this.entries.push({ time: new Date().toISOString(), level, message });
		if (this.entries.length > MAX_ENTRIES)
			this.entries.splice(0, this.entries.length - MAX_ENTRIES);
		console[level === 'debug' ? 'log' : level](`[uniPEQ] ${message}`);
	}

	debug(...args: unknown[]) {
		this.push('debug', args);
	}
	info(...args: unknown[]) {
		this.push('info', args);
	}
	warn(...args: unknown[]) {
		this.push('warn', args);
	}
	error(...args: unknown[]) {
		this.push('error', args);
	}

	export(): string {
		return this.entries.map((e) => `${e.time} [${e.level}] ${e.message}`).join('\n');
	}

	clear() {
		this.entries = [];
	}
}

export const logger = new AppLogger();
