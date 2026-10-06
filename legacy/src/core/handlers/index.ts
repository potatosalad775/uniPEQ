/**
 * handlerId → implementation registry.
 * Device JSON refers to handlers by string id, keeping the DB pure data.
 */
import type { ProtocolHandler } from '../transport';
import { fiioUsbHid } from './fiioUsbHid';
import { demoHandler } from './demo';

const handlers: Record<string, ProtocolHandler> = {
  fiioUsbHid,
  demo: demoHandler,
};

export function getHandler(handlerId: string): ProtocolHandler {
  const handler = handlers[handlerId];
  if (!handler) throw new Error(`Unknown handlerId: ${handlerId}`);
  return handler;
}

export function hasHandler(handlerId: string): boolean {
  return handlerId in handlers;
}
