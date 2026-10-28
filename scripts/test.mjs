#!/usr/bin/env node
/**
 * Runs the integration tests against the test database (.env.test):
 *   npm test                         all tests
 *   npm test -- tests/ai.test.ts     one file
 * Files run one after another; each file empties and rebuilds the database.
 */
import { spawnSync } from 'node:child_process';
import nextEnv from '@next/env';

process.env.NODE_ENV = 'test';
nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

const files = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  ['--conditions=react-server', '--import', 'tsx', '--test', '--test-concurrency=1', ...(files.length ? files : ['tests/**/*.test.ts'])],
  { stdio: 'inherit', env: process.env },
);
process.exit(result.status ?? 1);
