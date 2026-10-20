// Local-only Supabase protocol fixture. No application auth bypass is introduced.
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import postgres from 'postgres';
import { createDatabase, users } from '@archaeologist/db';
import { DrizzleRepositoryStore } from '@archaeologist/api';

async function main() {
  const url = process.env.DATABASE_URL!;
  if (!new URL(url).pathname.endsWith('_verify'))
    throw new Error('Browser fixtures require an isolated *_verify database.');
  const db = createDatabase(url);
  const store = new DrizzleRepositoryStore(db);
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '33333333-3333-4333-8333-333333333333';
  const repositoryId = '22222222-2222-4222-8222-222222222222';
  const client = postgres(url, { max: 1 });
  await client`DELETE FROM users WHERE id IN (${alice}, ${bob})`;
  await client`DELETE FROM request_limits WHERE user_id IN (${alice}, ${bob})`;
  await db.insert(users).values([
    { id: alice, email: 'demo@localhost.test' },
    { id: bob, email: 'other@localhost.test' },
  ]);
  await client`INSERT INTO repositories (id,owner_user_id,github_owner,github_repo,github_url,status) VALUES (${repositoryId},${alice},'fixture','browser-demo','https://github.com/fixture/browser-demo','READY')`;
  const snapshot = await store.upsertSnapshot({
    repositoryId,
    commitSha: 'a'.repeat(40),
    branch: 'main',
    status: 'READY',
    completedAt: new Date(),
  });
  const content = 'export function authenticate(token: string) {\n  return token === "valid";\n}\n';
  await store.replaceSnapshotFiles(snapshot.id, [
    {
      repositoryId,
      snapshotId: snapshot.id,
      path: 'src/auth.ts',
      language: 'typescript',
      sizeBytes: content.length,
      sha: 'source-sha',
      content,
      isBinary: false,
      isGenerated: false,
      symbols: [
        {
          name: 'authenticate',
          symbolType: 'function',
          startLine: 1,
          endLine: 3,
          signature: 'export function authenticate(token: string)',
        },
      ],
      chunks: [{ content, startLine: 1, endLine: 3 }],
      imports: [],
    },
  ]);
  await store.replaceCommitHistory(repositoryId, [
    {
      sha: 'a'.repeat(40),
      parentSha: null,
      authorName: 'Fixture',
      committedAt: new Date(),
      message: 'Introduce token authentication',
      files: [{ path: 'src/auth.ts', changeType: 'A' }],
    },
  ]);
  await store.replacePullRequests(repositoryId, [
    {
      number: 1,
      title: 'Add authentication',
      body: 'Fixes #2',
      author: 'fixture',
      state: 'closed',
      createdAt: new Date(),
      mergedAt: new Date(),
      updatedAt: new Date(),
      files: [{ path: 'src/auth.ts', changeType: 'added' }],
      filesComplete: true,
      relatedIssues: [2],
    },
  ]);
  await store.replaceIssues(repositoryId, [
    {
      number: 2,
      title: 'Authenticate requests',
      body: 'Check src/auth.ts',
      author: 'fixture',
      state: 'closed',
      createdAt: new Date(),
      updatedAt: new Date(),
      filePaths: ['src/auth.ts'],
    },
  ]);
  await client.end();
  await db.$client.end();

  function user(id: string) {
    return {
      id,
      aud: 'authenticated',
      role: 'authenticated',
      email: id === alice ? 'demo@localhost.test' : 'other@localhost.test',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    };
  }
  function session(id: string) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = Buffer.from(
      JSON.stringify({
        sub: id,
        aud: 'authenticated',
        exp,
        iat: exp - 3600,
        role: 'authenticated',
        session_id: '44444444-4444-4444-8444-444444444444',
      }),
    ).toString('base64url');
    const signature = createHmac('sha256', 'local-test-only')
      .update(`${header}.${payload}`)
      .digest('base64url');
    return {
      access_token: `${header}.${payload}.${signature}`,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: exp,
      refresh_token: 'test-refresh',
      user: user(id),
    };
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3100');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
    );
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url?.startsWith('/auth/v1/token')) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      if (
        body.password !== 'test-password-only' ||
        !['demo@localhost.test', 'other@localhost.test'].includes(body.email)
      ) {
        res.writeHead(400);
        res.end(JSON.stringify({ message: 'Invalid test credentials' }));
        return;
      }
      res.end(JSON.stringify(session(body.email === 'demo@localhost.test' ? alice : bob)));
      return;
    }
    if (req.url === '/auth/v1/user') {
      try {
        const token = req.headers.authorization?.split(' ')[1];
        const payload = JSON.parse(Buffer.from(token?.split('.')[1] ?? '', 'base64url').toString());
        if (![alice, bob].includes(payload.sub)) throw new Error('Unknown fixture user');
        res.end(JSON.stringify(user(payload.sub)));
        return;
      } catch {
        res.writeHead(401);
        res.end(JSON.stringify({ message: 'Invalid session' }));
        return;
      }
    }
    res.end(JSON.stringify({ ok: true }));
  });
  server.listen(54391, '127.0.0.1');
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Fixture failed');
  process.exit(1);
});
