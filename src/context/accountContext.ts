import { Lock } from 'lock';
import type { Context } from 'probot';
import type { Config } from '../accountConfigs';
import type { Org, User, AccountEmbed, AccountType } from '../mongo';
import { ExcludesFalsy } from '../utils/Excludes';
import type { AppContext } from './AppContext';
import type { AccountInfo } from './getOrCreateAccount';
import { getOrCreateAccount } from './getOrCreateAccount';
import type { TeamSlack } from './initTeamSlack';
import { initTeamSlack } from './initTeamSlack';
import { getKeys } from './utils';

export interface AccountContext<
  GroupNames extends string = any,
  TeamNames extends string = any
> {
  config: Config<GroupNames, TeamNames>;
  accountType: AccountType;
  account: Org | User;
  accountEmbed: AccountEmbed;
  slack: TeamSlack;
  getReviewerGroup: (githubLogin: string) => GroupNames | undefined;
  getReviewerGroups: (githubLogins: string[]) => GroupNames[];
  getTeamsForLogin: (githubLogin: string) => TeamNames[];
  approveShouldWait: (
    reviewerGroup: GroupNames | undefined,
    requestedReviewers: any[],
    {
      includesReviewerGroup,
      includesWaitForGroups,
    }: { includesReviewerGroup?: boolean; includesWaitForGroups?: boolean },
  ) => boolean;

  lock: (callback: () => Promise<void> | void) => Promise<void>;
}

const initAccountContext = async (
  appContext: AppContext,
  context: Context<any>,
  config: Config,
  accountInfo: AccountInfo,
): Promise<AccountContext> => {
  const account = await getOrCreateAccount(
    appContext,
    context.github,
    context.payload.installation.id,
    accountInfo,
  );
  const slackPromise = initTeamSlack(appContext, context, config, account);

  const githubLoginToGroup = new Map<string, string>();
  getKeys(config.groups).forEach((groupName) => {
    Object.keys(config.groups[groupName]).forEach((login) => {
      githubLoginToGroup.set(login, groupName);
    });
  });

  const githubLoginToTeams = new Map<string, string[]>();
  getKeys(config.teams || {}).forEach((teamName) => {
    (config.teams as NonNullable<typeof config.teams>)[teamName].logins.forEach(
      (login) => {
        const teams = githubLoginToTeams.get(login);
        if (teams) {
          teams.push(teamName);
        } else {
          githubLoginToTeams.set(login, [teamName]);
        }
      },
    );
  });

  const getReviewerGroups = (githubLogins: string[]): string[] => [
    ...new Set(
      githubLogins
        .map((githubLogin) => githubLoginToGroup.get(githubLogin))
        .filter(ExcludesFalsy),
    ),
  ];

  const lock = Lock();

  return {
    config,
    account,
    accountEmbed: {
      id: accountInfo.id,
      login: accountInfo.login,
      type: accountInfo.type as AccountType,
    },
    accountType: accountInfo.type as AccountType,
    lock: (callback: () => Promise<void> | void): Promise<void> => {
      return new Promise((resolve, reject) => {
        const logInfos = { account: accountInfo.login };
        context.log.info('lock: try to lock account', logInfos);
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        lock('_', async (createReleaseCallback) => {
          const release = createReleaseCallback(() => {});
          context.log.info('lock: lock account acquired', logInfos);
          try {
            await callback();
          } catch (err) {
            context.log.info('lock: release account (with error)', logInfos);
            release();
            reject(err);
            return;
          }
          context.log.info('lock: release account', logInfos);
          release();
          resolve();
        });
      });
    },
    getReviewerGroup: (githubLogin): string | undefined =>
      githubLoginToGroup.get(githubLogin),
    getReviewerGroups,

    getTeamsForLogin: (githubLogin): string[] =>
      githubLoginToTeams.get(githubLogin) || [],

    approveShouldWait: (
      reviewerGroup,
      requestedReviewers,
      { includesReviewerGroup, includesWaitForGroups },
    ): boolean => {
      if (!reviewerGroup) return false;

      const requestedReviewerGroups = getReviewerGroups(
        requestedReviewers.map((request) => request.login),
      );

      // contains another request of a reviewer in the same group
      if (
        includesReviewerGroup &&
        requestedReviewerGroups.includes(reviewerGroup)
      ) {
        return true;
      }

      // contains a request from a dependent group
      if (config.waitForGroups && includesWaitForGroups) {
        const waitForGroups = config.waitForGroups;
        return requestedReviewerGroups.some((group) =>
          waitForGroups[reviewerGroup].includes(group),
        );
      }

      return false;
    },

    slack: await slackPromise,
  };
};

const accountContextsPromise = new Map();
const accountContexts = new Map();

export const obtainAccountContext = (
  appContext: AppContext,
  context: Context<any>,
  config: Config,
  accountInfo: AccountInfo,
): Promise<AccountContext> => {
  const existingAccountContext = accountContexts.get(accountInfo.login);
  if (existingAccountContext) return existingAccountContext;

  const existingPromise = accountContextsPromise.get(accountInfo.login);
  if (existingPromise) return Promise.resolve(existingPromise);

  const promise = initAccountContext(appContext, context, config, accountInfo);
  accountContextsPromise.set(accountInfo.login, promise);

  return promise.then((accountContext) => {
    accountContextsPromise.delete(accountInfo.login);
    accountContexts.set(accountInfo.login, accountContext);
    return accountContext;
  });
};
