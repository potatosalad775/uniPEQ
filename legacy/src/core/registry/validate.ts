/**
 * Hand-rolled structural validation of device DB JSON files.
 * (Architecture calls for zod; kept dependency-free in the prototype —
 * swap these for zod schemas when the DB grows.)
 */
import type { BrandFile, DeviceFile, PeqConstraints, ProfileFile } from '../model/types';

function fail(path: string, msg: string): never {
  throw new Error(`${msg} (in ${path})`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireNumber(obj: Record<string, unknown>, key: string, path: string): number {
  if (typeof obj[key] !== 'number') fail(path, `"${key}" must be a number`);
  return obj[key] as number;
}

function requireBoolean(obj: Record<string, unknown>, key: string, path: string): boolean {
  if (typeof obj[key] !== 'boolean') fail(path, `"${key}" must be a boolean`);
  return obj[key] as boolean;
}

function validateConstraints(raw: unknown, path: string): PeqConstraints {
  if (!isObject(raw)) fail(path, 'peqConstraints must be an object');
  const c = raw as Record<string, unknown>;
  const minGain = requireNumber(c, 'minGain', path);
  const maxGain = requireNumber(c, 'maxGain', path);
  const maxFilters = requireNumber(c, 'maxFilters', path);
  const minQ = requireNumber(c, 'minQ', path);
  const maxQ = requireNumber(c, 'maxQ', path);
  if (minGain > maxGain) fail(path, 'minGain > maxGain');
  if (minQ > maxQ) fail(path, 'minQ > maxQ');
  if (maxFilters < 1) fail(path, 'maxFilters must be >= 1');
  requireBoolean(c, 'supportsLSFilter', path);
  requireBoolean(c, 'supportsHSFilter', path);
  requireBoolean(c, 'deviceHandlesPregain', path);
  requireBoolean(c, 'supportsManualGlobalGain', path);
  return raw as unknown as PeqConstraints;
}

export function validateProfileFile(raw: unknown, path: string): ProfileFile {
  if (!isObject(raw)) fail(path, 'profile must be an object');
  if (typeof raw.id !== 'string' || raw.id.length === 0) fail(path, 'profile "id" must be a non-empty string');
  validateConstraints(raw.peqConstraints, path);
  return raw as unknown as ProfileFile;
}

export function validateBrandFile(raw: unknown, path: string): BrandFile {
  if (!isObject(raw)) fail(path, 'brand file must be an object');
  if (typeof raw.brand !== 'string' || raw.brand.length === 0) fail(path, '"brand" must be a non-empty string');
  if (raw.defaults !== undefined && !isObject(raw.defaults)) fail(path, '"defaults" must be an object');
  return raw as unknown as BrandFile;
}

export function validateDeviceFile(raw: unknown, path: string): DeviceFile {
  if (!isObject(raw)) fail(path, 'device file must be an object');
  if (typeof raw.id !== 'string' || !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(raw.id as string)) {
    fail(path, 'device "id" must match "brand/model" (lowercase kebab)');
  }
  if (typeof raw.name !== 'string' || raw.name.length === 0) fail(path, 'device "name" must be a non-empty string');
  if (raw.status !== undefined && !['verified', 'experimental', 'community'].includes(raw.status as string)) {
    fail(path, `invalid "status": ${raw.status}`);
  }
  if (raw.match !== undefined && !isObject(raw.match)) fail(path, '"match" must be an object');
  if (raw.modelConfig !== undefined && !isObject(raw.modelConfig)) fail(path, '"modelConfig" must be an object');
  return raw as unknown as DeviceFile;
}
