import { z } from 'zod';

export const createRepositoryBodySchema = z.object({
  githubUrl: z.string().min(1, 'Repository URL is required.'),
});

export type CreateRepositoryBody = z.infer<typeof createRepositoryBodySchema>;

export interface RepositoryDto {
  id: string;
  ownerUserId: string;
  githubOwner: string;
  githubRepo: string;
  githubUrl: string;
  defaultBranch: string | null;
  description: string | null;
  status: string;
  lastIndexedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthUserDto {
  id: string;
  email: string | null;
}
