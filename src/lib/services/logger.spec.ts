import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

describe('logger', () => {
	beforeEach(() => {
		logger.clear();
		logger.verbose = false;
		for (const method of ['log', 'info', 'warn', 'error'] as const) {
			vi.spyOn(console, method).mockImplementation(() => undefined);
		}
	});
	afterEach(() => vi.restoreAllMocks());

	it('records entries and formats bytes and objects', () => {
		logger.info('write', new Uint8Array([1, 2, 255]), { slot: 4 });
		expect(logger.entries).toHaveLength(1);
		expect(logger.entries[0]).toMatchObject({
			level: 'info',
			message: 'write [1,2,255] {"slot":4}'
		});
		expect(console.info).toHaveBeenCalledWith('[uniPEQ] write [1,2,255] {"slot":4}');
	});

	it('drops debug unless verbose', () => {
		logger.debug('hidden');
		logger.verbose = true;
		logger.debug('shown');
		expect(logger.entries.map((e) => e.message)).toEqual(['shown']);
	});

	it('exports one line per entry', () => {
		logger.warn('a');
		logger.error('b');
		expect(logger.export()).toMatch(/^\S+ \[warn\] a\n\S+ \[error\] b$/);
	});

	it('keeps the newest 2000 entries', () => {
		for (let i = 0; i < 2005; i++) logger.info(String(i));
		expect(logger.entries).toHaveLength(2000);
		expect(logger.entries[0].message).toBe('5');
	});
});
