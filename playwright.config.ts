import { defineConfig } from '@playwright/test';

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://archaeologist:verification-only@127.0.0.1:55432/archaeologist_verify';
const env = {
  NEXT_BUILD_DIR: '.next-e2e',
  DATABASE_URL: databaseUrl,
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54391',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-browser-test-anon-key',
  ENCRYPTION_KEY: 'ab'.repeat(32),
  DEMO_AI_API_KEY: '',
  OPENAI_API_KEY: '',
  REDIS_URL: '',
};

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  timeout: 30_000,
  use: { baseURL: env.NEXT_PUBLIC_APP_URL, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'corepack pnpm exec tsx tests/e2e/auth-server.ts',
      url: `${env.NEXT_PUBLIC_SUPABASE_URL}/health`,
      env,
      reuseExistingServer: false,
    },
    {
      command: 'corepack pnpm --filter @archaeologist/web dev --hostname 127.0.0.1 --port 3100',
      url: `${env.NEXT_PUBLIC_APP_URL}/api/health`,
      env,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
