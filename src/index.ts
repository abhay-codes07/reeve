/**
 * Reeve entry point.
 *
 * For Step 2 this wires the foundation together: load + validate env, construct
 * the GitHub client, and confirm the model config resolves. Later steps add the
 * orchestrator agent, the tool registry, subagents, and workflows on top of this
 * base. Run with `pnpm dev`.
 */

import { loadEnv, models } from './config/index.js';
import { getGitHubClient } from './github/index.js';
import { createOperationLogger } from './observability/index.js';

async function main(): Promise<void> {
  const log = createOperationLogger({ operation: 'reeve.bootstrap' });

  const env = loadEnv();
  log.info(
    {
      sandbox: `${env.sandbox.owner}/${env.sandbox.repo}`,
      orchestratorModels: models.orchestrator.map((m) => m.model),
      workerModel: models.worker,
    },
    'Configuration loaded',
  );

  const github = getGitHubClient(env);
  const { data } = await github.request('github.users.getAuthenticated', (octokit) =>
    octokit.rest.users.getAuthenticated(),
  );
  log.info({ login: data.login }, 'Authenticated with GitHub');
}

main().catch((err) => {
  createOperationLogger({ operation: 'reeve.bootstrap' }).fatal({ err }, 'Bootstrap failed');
  process.exitCode = 1;
});
