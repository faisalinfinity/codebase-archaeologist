import { describe, expect, it } from 'vitest';

import {
  isIgnoredDirectoryName,
  isIgnoredFilePath,
  isSecretEnvFile,
  pathHasIgnoredDirectory,
} from './ignore-rules';

describe('ignore rules', () => {
  it('ignores dependency, VCS, and build directories', () => {
    expect(isIgnoredDirectoryName('node_modules')).toBe(true);
    expect(isIgnoredDirectoryName('.git')).toBe(true);
    expect(pathHasIgnoredDirectory('packages/app/node_modules/lodash/index.js')).toBe(true);
    expect(isIgnoredFilePath('src/index.ts')).toBe(false);
  });

  it('ignores lockfiles, minified assets, and media', () => {
    expect(isIgnoredFilePath('pnpm-lock.yaml')).toBe(true);
    expect(isIgnoredFilePath('yarn.lock')).toBe(true);
    expect(isIgnoredFilePath('public/app.min.js')).toBe(true);
    expect(isIgnoredFilePath('logo.png')).toBe(true);
    expect(isIgnoredFilePath('docs/architecture.md')).toBe(false);
    expect(isIgnoredFilePath('Dockerfile')).toBe(false);
    expect(isIgnoredFilePath('tsconfig.json')).toBe(false);
  });

  it('never indexes secret env files but allows .env.example', () => {
    expect(isSecretEnvFile('.env')).toBe(true);
    expect(isSecretEnvFile('.env.local')).toBe(true);
    expect(isSecretEnvFile('.env.production')).toBe(true);
    expect(isSecretEnvFile('.env.example')).toBe(false);
    expect(isIgnoredFilePath('apps/web/.env')).toBe(true);
    expect(isIgnoredFilePath('.env.example')).toBe(false);
  });
});
