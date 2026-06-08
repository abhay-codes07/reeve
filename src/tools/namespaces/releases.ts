/**
 * `github-releases` namespace — inspect repository releases.
 */

import { z } from 'zod';
import { defineTool, type AnyToolDefinition } from '../types.js';
import { resolveRepo } from '../context.js';
import { repoTarget, pagination } from '../schemas.js';

const NS = 'github-releases' as const;

const release = z.object({
  id: z.number(),
  tagName: z.string(),
  name: z.string().nullable(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  author: z.string().nullable(),
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
  url: z.string(),
});

function mapRelease(r: Record<string, any>): z.infer<typeof release> {
  return {
    id: r.id,
    tagName: r.tag_name,
    name: r.name ?? null,
    draft: Boolean(r.draft),
    prerelease: Boolean(r.prerelease),
    author: r.author?.login ?? null,
    createdAt: r.created_at,
    publishedAt: r.published_at ?? null,
    url: r.html_url,
  };
}

const releases_list = defineTool({
  name: 'releases_list',
  namespace: NS,
  description: 'List the releases of a repository, newest first.',
  inputSchema: z.object({ ...repoTarget, ...pagination }),
  outputSchema: z.object({ count: z.number(), items: z.array(release) }),
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.repos.listReleases', (o) =>
      o.rest.repos.listReleases({
        owner,
        repo,
        ...(args.perPage ? { per_page: args.perPage } : {}),
        ...(args.page ? { page: args.page } : {}),
      }),
    );
    const items = data.map(mapRelease);
    return { count: items.length, items };
  },
});

const releases_get = defineTool({
  name: 'releases_get',
  namespace: NS,
  description: 'Get a single release by its id.',
  inputSchema: z.object({ ...repoTarget, releaseId: z.number().int().positive() }),
  outputSchema: release,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.repos.getRelease', (o) =>
      o.rest.repos.getRelease({ owner, repo, release_id: args.releaseId }),
    );
    return mapRelease(data);
  },
});

const releases_get_latest = defineTool({
  name: 'releases_get_latest',
  namespace: NS,
  description: 'Get the latest published (non-draft, non-prerelease) release.',
  inputSchema: z.object({ ...repoTarget }),
  outputSchema: release,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.repos.getLatestRelease', (o) =>
      o.rest.repos.getLatestRelease({ owner, repo }),
    );
    return mapRelease(data);
  },
});

const releases_get_by_tag = defineTool({
  name: 'releases_get_by_tag',
  namespace: NS,
  description: 'Get a release by its git tag name.',
  inputSchema: z.object({ ...repoTarget, tag: z.string().min(1) }),
  outputSchema: release,
  handler: async (args, ctx) => {
    const { owner, repo } = resolveRepo(args, ctx);
    const { data } = await ctx.github.request('github.repos.getReleaseByTag', (o) =>
      o.rest.repos.getReleaseByTag({ owner, repo, tag: args.tag }),
    );
    return mapRelease(data);
  },
});

export const releaseTools: AnyToolDefinition[] = [
  releases_list,
  releases_get,
  releases_get_latest,
  releases_get_by_tag,
];
