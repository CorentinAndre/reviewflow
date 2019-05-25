/* eslint-disable max-lines */

import { Lock } from 'lock';
import { Context } from 'probot';
import { teamConfigs, Config } from '../teamconfigs';
// eslint-disable-next-line import/no-cycle
import { autoMergeIfPossible } from '../pr-handlers/actions/autoMergeIfPossible';
import { initRepoLabels, LabelResponse, Labels } from './initRepoLabels';
import { obtainTeamContext, TeamContext } from './teamContext';

export interface LockedMergePr {
  id: number;
  number: number;
  branch: string;
}

interface RepoContextWithoutTeamContext<GroupNames extends string> {
  labels: Labels;
  protectedLabelIds: readonly LabelResponse['id'][];

  hasNeedsReview: (labels: LabelResponse[]) => boolean;
  hasRequestedReview: (labels: LabelResponse[]) => boolean;
  hasChangesRequestedReview: (labels: LabelResponse[]) => boolean;
  hasApprovesReview: (labels: LabelResponse[]) => boolean;
  getNeedsReviewGroupNames: (labels: LabelResponse[]) => GroupNames[];

  lockPROrPRS(
    prIdOrIds: string | string[],
    callback: () => Promise<void> | void,
  ): Promise<void>;

  getMergeLockedPr(): LockedMergePr;
  addMergeLockPr(pr: LockedMergePr): void;
  removeMergeLockedPr(context: Context<any>, pr: LockedMergePr): void;
  reschedule(context: Context<any>, pr: LockedMergePr): void;
  pushAutomergeQueue(pr: LockedMergePr): void;
}

const ExcludesFalsy = (Boolean as any) as <T>(
  x: T | false | null | undefined,
) => x is T;

export type RepoContext<GroupNames extends string = any> = TeamContext<
  GroupNames
> &
  RepoContextWithoutTeamContext<GroupNames>;

async function initRepoContext<GroupNames extends string>(
  context: Context<any>,
  config: Config<GroupNames>,
): Promise<RepoContext<GroupNames>> {
  const teamContext = await obtainTeamContext(context, config);
  const repoContext = Object.create(teamContext);

  const [labels] = await Promise.all([initRepoLabels(context, config)]);

  const reviewGroupNames = Object.keys(config.groups) as GroupNames[];

  const needsReviewLabelIds = reviewGroupNames
    .map((key: GroupNames) => config.labels.review[key].needsReview)
    .filter(Boolean)
    .map((name) => labels[name].id);

  const requestedReviewLabelIds = reviewGroupNames
    .map((key) => config.labels.review[key].requested)
    .filter(Boolean)
    .map((name) => labels[name].id);

  const changesRequestedLabelIds = reviewGroupNames
    .map((key) => config.labels.review[key].changesRequested)
    .filter(Boolean)
    .map((name) => labels[name].id);

  const approvedReviewLabelIds = reviewGroupNames
    .map((key) => config.labels.review[key].approved)
    .filter(Boolean)
    .map((name) => labels[name].id);

  const protectedLabelIds = [
    ...requestedReviewLabelIds,
    ...changesRequestedLabelIds,
    ...approvedReviewLabelIds,
  ];

  const labelIdToGroupName = new Map<LabelResponse['id'], GroupNames>();
  reviewGroupNames.forEach((key) => {
    const reviewGroupLabels = config.labels.review[key] as any;
    Object.keys(reviewGroupLabels).forEach((labelKey: string) => {
      labelIdToGroupName.set(labels[reviewGroupLabels[labelKey]].id, key);
    });
  });

  // const updateStatusCheck = (context, reviewGroup, statusInfo) => {};

  const hasNeedsReview = (labels: LabelResponse[]) =>
    labels.some((label) => needsReviewLabelIds.includes(label.id));
  const hasRequestedReview = (labels: LabelResponse[]) =>
    labels.some((label) => requestedReviewLabelIds.includes(label.id));
  const hasChangesRequestedReview = (labels: LabelResponse[]) =>
    labels.some((label) => changesRequestedLabelIds.includes(label.id));
  const hasApprovesReview = (labels: LabelResponse[]) =>
    labels.some((label) => approvedReviewLabelIds.includes(label.id));

  const getNeedsReviewGroupNames = (labels: LabelResponse[]): GroupNames[] =>
    labels
      .filter((label) => needsReviewLabelIds.includes(label.id))
      .map((label) => labelIdToGroupName.get(label.id))
      .filter(ExcludesFalsy);

  const lock = Lock();
  let lockMergePr: LockedMergePr | undefined;
  const automergeQueue: LockedMergePr[] = [];

  const lockPROrPRS = (
    prIdOrIds: string | string[],
    callback: () => Promise<void> | void,
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      console.log('lock: try to lock pr', { prIdOrIds });
      lock(prIdOrIds, async (createReleaseCallback) => {
        const release = createReleaseCallback(() => {});
        console.log('lock: lock acquired', { prIdOrIds });
        try {
          await callback();
        } catch (err) {
          console.log('lock: release pr (with error)', { prIdOrIds });
          release();
          reject(err);
          return;
        }
        console.log('lock: release pr', { prIdOrIds });
        release();
        resolve();
      });
    });

  const reschedule = (context: Context<any>, pr: LockedMergePr) => {
    if (!pr) throw new Error('Cannot reschedule undefined');
    context.log.info('reschedule', pr);
    setTimeout(() => {
      lockPROrPRS('reschedule', () => {
        return lockPROrPRS(String(pr.id), async () => {
          const prResult = await context.github.pulls.get(
            context.repo({
              pull_number: pr.number,
            }),
          );
          await autoMergeIfPossible(context, repoContext, prResult.data);
        });
      });
    }, 1000);
  };

  return Object.assign(repoContext, {
    labels,
    protectedLabelIds,
    hasNeedsReview,
    hasRequestedReview,
    hasChangesRequestedReview,
    hasApprovesReview,
    getNeedsReviewGroupNames,

    getMergeLockedPr: () => lockMergePr,
    addMergeLockPr: (pr: LockedMergePr): void => {
      console.log('merge lock: lock', pr);
      if (lockMergePr && lockMergePr.number === pr.number) return;
      if (lockMergePr) throw new Error('Already have lock');
      lockMergePr = pr;
    },
    removeMergeLockedPr: (context, pr: LockedMergePr): void => {
      console.log('merge lock: remove', pr);
      if (!lockMergePr || lockMergePr.number !== pr.number) return;
      lockMergePr = automergeQueue.shift();
      console.log('merge lock: next', lockMergePr);
      if (lockMergePr) {
        reschedule(context, lockMergePr);
      }
    },
    pushAutomergeQueue: (pr: LockedMergePr): void => {
      console.log('merge lock: push queue', {
        pr,
        lockMergePr,
        automergeQueue,
      });
      if (!automergeQueue.some((p) => p.number === pr.number)) {
        automergeQueue.push(pr);
      }
    },
    reschedule,

    lockPROrPRS,
  } as RepoContextWithoutTeamContext<GroupNames>);
}

const repoContextsPromise = new Map<number, Promise<RepoContext>>();
const repoContexts = new Map<number, RepoContext>();

export const obtainRepoContext = (
  context: Context<any>,
): Promise<RepoContext> | RepoContext | null => {
  const repo = context.payload.repository;
  if (
    repo.name === 'reviewflow-test' &&
    process.env.NAME !== 'reviewflow-test'
  ) {
    return null;
  }
  const owner = repo.owner;
  if (!teamConfigs[owner.login]) {
    console.warn(owner.login, Object.keys(teamConfigs));
    return null;
  }
  const key = repo.id;

  const existingRepoContext = repoContexts.get(key);
  if (existingRepoContext) return existingRepoContext;

  const existingPromise = repoContextsPromise.get(key);
  if (existingPromise) return Promise.resolve(existingPromise);

  const promise = initRepoContext(context, teamConfigs[owner.login]);
  repoContextsPromise.set(key, promise);

  return promise.then((repoContext) => {
    repoContextsPromise.delete(key);
    repoContexts.set(key, repoContext);
    return repoContext;
  });
};
