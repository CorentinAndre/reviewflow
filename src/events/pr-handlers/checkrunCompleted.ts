import type { Probot } from 'probot';
import type { AppContext } from '../../context/AppContext';
import { autoMergeIfPossible } from './actions/autoMergeIfPossible';
import { getReviewflowPrContext } from './utils/createPullRequestContext';
import { createPullRequestsHandler } from './utils/createPullRequestHandler';
import { fetchPr } from './utils/fetchPr';

export default function checkrunCompleted(
  app: Probot,
  appContext: AppContext,
): void {
  app.on(
    'check_run.completed',
    createPullRequestsHandler(
      appContext,
      (payload, repoContext) => {
        if (repoContext.shouldIgnore) return [];
        return payload.check_run.pull_requests;
      },
      async (pullRequest, context, repoContext) => {
        const [updatedPr, reviewflowPrContext] = await Promise.all([
          fetchPr(context, pullRequest.number),
          getReviewflowPrContext(pullRequest.number, context, repoContext),
        ]);

        await autoMergeIfPossible(
          updatedPr,
          context,
          repoContext,
          reviewflowPrContext,
        );
      },
    ),
  );
}
