import { and, desc, eq } from 'drizzle-orm';

import { getDatabase, indexJobs, repositories, users, type Database } from '@archaeologist/db';
import type { RepositoryDto } from '@archaeologist/shared';

import type { InsertRepositoryInput, RepositoryStore, UpsertUserInput } from './repository-store';

function toDto(row: typeof repositories.$inferSelect): RepositoryDto {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    githubOwner: row.githubOwner,
    githubRepo: row.githubRepo,
    githubUrl: row.githubUrl,
    defaultBranch: row.defaultBranch,
    description: row.description,
    status: row.status,
    lastIndexedAt: row.lastIndexedAt ? row.lastIndexedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DrizzleRepositoryStore implements RepositoryStore {
  constructor(private readonly db: Database = getDatabase()) {}

  async upsertUser(input: UpsertUserInput): Promise<void> {
    await this.db
      .insert(users)
      .values({
        id: input.id,
        email: input.email || 'unknown@localhost',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: input.email || 'unknown@localhost',
          updatedAt: new Date(),
        },
      });
  }

  async listByOwner(ownerUserId: string): Promise<RepositoryDto[]> {
    const rows = await this.db
      .select()
      .from(repositories)
      .where(eq(repositories.ownerUserId, ownerUserId))
      .orderBy(desc(repositories.createdAt));
    return rows.map(toDto);
  }

  async getById(id: string): Promise<RepositoryDto | null> {
    const rows = await this.db.select().from(repositories).where(eq(repositories.id, id)).limit(1);
    const row = rows[0];
    return row ? toDto(row) : null;
  }

  async findByOwnerAndGithub(
    ownerUserId: string,
    githubOwner: string,
    githubRepo: string,
  ): Promise<RepositoryDto | null> {
    const rows = await this.db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.ownerUserId, ownerUserId),
          eq(repositories.githubOwner, githubOwner),
          eq(repositories.githubRepo, githubRepo),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? toDto(row) : null;
  }

  async insertRepository(input: InsertRepositoryInput): Promise<RepositoryDto> {
    const inserted = await this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(repositories)
        .values({
          ownerUserId: input.ownerUserId,
          githubOwner: input.githubOwner,
          githubRepo: input.githubRepo,
          githubUrl: input.githubUrl,
          status: 'PENDING',
        })
        .returning();
      const row = rows[0];
      if (!row) {
        throw new Error('Failed to insert repository.');
      }
      await tx.insert(indexJobs).values({
        repositoryId: row.id,
        jobType: 'repository:index',
        status: 'PENDING',
        stage: 'PENDING',
      });
      return row;
    });
    return toDto(inserted);
  }

  async deleteByOwnerAndId(ownerUserId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(repositories)
      .where(and(eq(repositories.id, id), eq(repositories.ownerUserId, ownerUserId)))
      .returning({ id: repositories.id });
    return deleted.length > 0;
  }
}
