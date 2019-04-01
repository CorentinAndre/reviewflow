'use strict';

require('dotenv/config');
var probot = require('probot');
var lock = require('lock');
var webApi = require('@slack/web-api');

const config = {
  slackToken: process.env.ORNIKAR_SLACK_TOKEN,
  autoAssignToCreator: true,
  trimTitle: true,
  requiresReviewRequest: true,
  prLint: {
    title: [{
      regExp: // eslint-disable-next-line unicorn/no-unsafe-regex
      /^(revert: )?(build|chore|ci|docs|feat|fix|perf|refactor|style|test)(\(([a-z\-/]*)\))?:\s/,
      error: {
        title: 'Title does not match commitlint conventional',
        summary: 'https://github.com/marionebl/commitlint/tree/master/%40commitlint/config-conventional'
      }
    }, {
      bot: false,
      regExp: /\s(ONK-(\d+)|\[no issue])$/,
      error: {
        title: 'Title does not have JIRA issue',
        summary: 'The PR title should end with ONK-0000, or [no issue]'
      },
      status: 'jira-issue',
      statusInfoFromMatch: match => {
        const issue = match[1];

        if (issue === '[no issue]') {
          return {
            title: 'No issue',
            summary: ''
          };
        }

        return {
          url: `https://ornikar.atlassian.net/browse/${issue}`,
          title: `JIRA issue: ${issue}`,
          summary: `[${issue}](https://ornikar.atlassian.net/browse/${issue})`
        };
      }
    }]
  },
  groups: {
    dev: {
      abarreir: `alexandre${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      christophehurpeau: `christophe${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      arthurflachs: `arthur${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      skyline42sh: `alexandre.charbonnier${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      LentnerStefan: `stefan${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      HugoGarrido: `hugo${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      CorentinAndre: `corentin${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      rigma: `romain${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      Mxime: `maxime${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      damienorny: `damien.orny${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      tilap: `julien.lavinh${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      '63m29': `valerian${process.env.ORNIKAR_EMAIL_DOMAIN}`
    },
    design: {
      jperriere: `julien${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      CoralineColasse: `coraline${process.env.ORNIKAR_EMAIL_DOMAIN}`
    }
  },
  waitForGroups: {
    dev: [],
    design: ['dev']
  },
  labels: {
    list: {
      // /* ci */
      // 'ci/in-progress': { name: ':green_heart: ci/in-progress', color: '#0052cc' },
      // 'ci/fail': { name: ':green_heart: ci/fail', color: '#e11d21' },
      // 'ci/passed': { name: ':green_heart: ci/passed', color: '#86f9b4' },

      /* code */
      'code/needs-review': {
        name: ':ok_hand: code/needs-review',
        color: '#FFD57F'
      },
      'code/review-requested': {
        name: ':ok_hand: code/review-requested',
        color: '#B2E1FF'
      },
      'code/changes-requested': {
        name: ':ok_hand: code/changes-requested',
        color: '#e11d21'
      },
      'code/approved': {
        name: ':ok_hand: code/approved',
        color: '#64DD17'
      },

      /* design */
      'design/needs-review': {
        name: ':art: design/needs-review',
        color: '#FFD57F'
      },
      'design/review-requested': {
        name: ':art: design/review-requested',
        color: '#B2E1FF'
      },
      'design/changes-requested': {
        name: ':art: design/changes-requested',
        color: '#e11d21'
      },
      'design/approved': {
        name: ':art: design/approved',
        color: '#64DD17'
      },

      /* auto merge */
      'merge/automerge': {
        name: ':soon: automerge',
        color: '#64DD17'
      }
    },
    review: {
      ci: {
        inProgress: 'ci/in-progress',
        succeeded: 'ci/success',
        failed: 'ci/fail'
      },
      dev: {
        needsReview: 'code/needs-review',
        requested: 'code/review-requested',
        changesRequested: 'code/changes-requested',
        approved: 'code/approved'
      },
      design: {
        needsReview: 'design/needs-review',
        requested: 'design/review-requested',
        changesRequested: 'design/changes-requested',
        approved: 'design/approved'
      }
    }
  }
};

const config$1 = {
  autoAssignToCreator: true,
  trimTitle: true,
  requiresReviewRequest: false,
  prLint: {
    title: [{
      regExp: // eslint-disable-next-line unicorn/no-unsafe-regex
      /^(revert: )?(build|chore|ci|docs|feat|fix|perf|refactor|style|test)(\(([a-z\-/]*)\))?:\s/,
      error: {
        title: 'Title does not match commitlint conventional',
        summary: 'https://github.com/marionebl/commitlint/tree/master/%40commitlint/config-conventional'
      }
    }]
  },
  groups: {
    dev: {
      christophehurpeau: 'christophe@hurpeau.com',
      'chris-reviewflow': 'christophe.hurpeau+reviewflow@gmail.com'
    }
  },
  waitForGroups: {
    dev: []
  },
  labels: {
    list: {
      // /* ci */
      // 'ci/in-progress': { name: ':green_heart: ci/in-progress', color: '#0052cc' },
      // 'ci/fail': { name: ':green_heart: ci/fail', color: '#e11d21' },
      // 'ci/passed': { name: ':green_heart: ci/passed', color: '#86f9b4' },

      /* code */
      'code/needs-review': {
        name: ':ok_hand: code/needs-review',
        color: '#FFD57F'
      },
      'code/review-requested': {
        name: ':ok_hand: code/review-requested',
        color: '#B2E1FF'
      },
      'code/changes-requested': {
        name: ':ok_hand: code/changes-requested',
        color: '#e11d21'
      },
      'code/approved': {
        name: ':ok_hand: code/approved',
        color: '#64DD17'
      },

      /* auto merge */
      'merge/automerge': {
        name: ':soon: automerge',
        color: '#64DD17'
      },
      'merge/delete-branch': {
        name: ':recycle: delete branch after merge',
        color: '#64DD17'
      }
    },
    review: {
      ci: {
        inProgress: 'ci/in-progress',
        succeeded: 'ci/success',
        failed: 'ci/fail'
      },
      dev: {
        needsReview: 'code/needs-review',
        requested: 'code/review-requested',
        changesRequested: 'code/changes-requested',
        approved: 'code/approved'
      }
    }
  }
};

const teamConfigs = {
  ornikar: config,
  christophehurpeau: config$1
}; // flat requires node 11
// export const getMembers = <GroupNames extends string = any>(
//   groups: Record<GroupNames, Group>,
// ): string[] => {
//   return Object.values(groups).flat(1);
// };

const initRepoLabels = async (context, config) => {
  const {
    data: labels
  } = await context.github.issues.listLabelsForRepo(context.repo({
    per_page: 100
  }));
  const finalLabels = {};

  for (const [labelKey, labelConfig] of Object.entries(config.labels.list)) {
    const labelColor = labelConfig.color.slice(1);
    const description = `Generated by review-flow for ${labelKey}`;
    let existingLabel = labels.find(label => label.name === labelConfig.name);

    if (!existingLabel) {
      existingLabel = labels.find(label => label.description === description);
    }

    if (!existingLabel) {
      if (labelKey === 'design/needs-review') {
        existingLabel = labels.find(label => label.name === 'needs-design-review');
      }

      if (labelKey === 'design/approved') {
        existingLabel = labels.find(label => label.name === 'design-reviewed');
      }
    }

    if (!existingLabel) {
      const result = await context.github.issues.createLabel(context.repo({
        name: labelConfig.name,
        color: labelColor,
        description
      }));
      finalLabels[labelKey] = result.data;
    } else if (existingLabel.name !== labelConfig.name || existingLabel.color !== labelColor // ||
    // TODO: description is always undefined
    // existingLabel.description !== description
    ) {
        context.log.info('Needs to update label', {
          current_name: existingLabel.name,
          name: existingLabel.name !== labelConfig.name && labelConfig.name,
          color: existingLabel.color !== labelColor && labelColor,
          description: existingLabel.description !== description && description
        });
        const result = await context.github.issues.updateLabel(context.repo({
          current_name: existingLabel.name,
          name: labelConfig.name,
          color: labelColor,
          description
        }));
        finalLabels[labelKey] = result.data;
      } else {
      finalLabels[labelKey] = existingLabel;
    }
  }

  return finalLabels;
};

const getKeys = o => Object.keys(o);

const ExcludesFalsy = Boolean;
const initTeamSlack = async (context, config) => {
  if (!config.slackToken) {
    return {
      mention: () => '',
      postMessage: () => Promise.resolve()
    };
  }

  const githubLoginToSlackEmail = getKeys(config.groups).reduce((acc, groupName) => {
    Object.assign(acc, config.groups[groupName]);
    return acc;
  }, {});
  const slackClient = new webApi.WebClient(config.slackToken);
  const allUsers = await slackClient.users.list({
    limit: 200
  });
  const members = Object.values(githubLoginToSlackEmail).map(email => {
    const member = allUsers.members.find(user => user.profile.email === email);

    if (!member) {
      console.warn(`Could not find user ${email}`);
      return;
    }

    return [email, {
      member,
      im: undefined
    }];
  }).filter(ExcludesFalsy);

  for (const [, user] of members) {
    try {
      const im = await slackClient.im.open({
        user: user.member.id
      });
      user.im = im.channel;
    } catch (err) {
      console.error(err);
    }
  }

  const membersMap = new Map(members);

  const getUserFromGithubLogin = githubLogin => {
    const email = githubLoginToSlackEmail[githubLogin];
    if (!email) return null;
    return membersMap.get(email);
  };

  return {
    mention: githubLogin => {
      const user = getUserFromGithubLogin(githubLogin);
      if (!user) return githubLogin;
      return `<@${user.member.id}>`;
    },
    postMessage: async (githubLogin, text) => {
      context.log.info('send slack', {
        githubLogin,
        text
      });
      if (process.env.DRY_RUN) return;
      const user = getUserFromGithubLogin(githubLogin);
      if (!user || !user.im) return;
      await slackClient.chat.postMessage({
        channel: user.im.id,
        text
      });
    }
  };
};

const ExcludesFalsy$1 = Boolean;

const initTeamContext = async (context, config) => {
  const slackPromise = initTeamSlack(context, config);
  const githubLoginToGroup = getKeys(config.groups).reduce((acc, groupName) => {
    Object.keys(config.groups[groupName]).forEach(login => {
      acc.set(login, groupName);
    });
    return acc;
  }, new Map());

  const getReviewerGroups = githubLogins => [...new Set(githubLogins.map(githubLogin => githubLoginToGroup.get(githubLogin)).filter(Boolean))];

  return {
    config,
    getReviewerGroup: githubLogin => githubLoginToGroup.get(githubLogin),
    getReviewerGroups: githubLogins => [...new Set(githubLogins.map(githubLogin => githubLoginToGroup.get(githubLogin)).filter(ExcludesFalsy$1))],
    reviewShouldWait: (reviewerGroup, requestedReviewers, {
      includesReviewerGroup,
      includesWaitForGroups
    }) => {
      if (!reviewerGroup) return false;
      const requestedReviewerGroups = getReviewerGroups(requestedReviewers.map(request => request.login)); // contains another request of a reviewer in the same group

      if (includesReviewerGroup && requestedReviewerGroups.includes(reviewerGroup)) {
        return true;
      } // contains a request from a dependent group


      if (config.waitForGroups && includesWaitForGroups) {
        const waitForGroups = config.waitForGroups;
        return requestedReviewerGroups.some(group => waitForGroups[reviewerGroup].includes(group));
      }

      return false;
    },
    slack: await slackPromise
  };
};

const teamContextsPromise = new Map();
const teamContexts = new Map();
const obtainTeamContext = (context, config) => {
  const owner = context.payload.repository.owner;
  const existingTeamContext = teamContexts.get(owner.login);
  if (existingTeamContext) return existingTeamContext;
  const existingPromise = teamContextsPromise.get(owner.login);
  if (existingPromise) return Promise.resolve(existingPromise);
  const promise = initTeamContext(context, config);
  teamContextsPromise.set(owner.login, promise);
  return promise.then(teamContext => {
    teamContextsPromise.delete(owner.login);
    teamContexts.set(owner.login, teamContext);
    return teamContext;
  });
};

/* eslint-disable max-lines */
const ExcludesFalsy$2 = Boolean;

async function initRepoContext(context, config) {
  const teamContext = await obtainTeamContext(context, config);
  const repoContext = Object.create(teamContext);
  const labels = await initRepoLabels(context, config);
  const labelsValues = Object.values(labels);
  const reviewKeys = Object.keys(config.groups);
  const needsReviewLabelIds = reviewKeys.map(key => config.labels.review[key].needsReview).filter(Boolean).map(name => labels[name].id);
  const requestedReviewLabelIds = reviewKeys.map(key => config.labels.review[key].requested).filter(Boolean).map(name => labels[name].id);
  const approvedReviewLabelIds = reviewKeys.map(key => config.labels.review[key].approved).filter(Boolean).map(name => labels[name].id);

  const addStatusCheck = async function (context, statusInfo) {
    const pr = context.payload.pull_request;
    await context.github.checks.create(context.repo({
      name: process.env.NAME,
      head_sha: pr.head.sha,
      ...statusInfo
    }));
  };

  const createInProgressStatusCheck = context => addStatusCheck(context, {
    status: 'in_progress'
  });

  const createFailedStatusCheck = (context, message) => addStatusCheck(context, {
    status: 'completed',
    conclusion: 'failure',
    started_at: context.payload.pull_request.created_at,
    completed_at: new Date(),
    output: {
      title: message,
      summary: ''
    }
  });

  const createDoneStatusCheck = context => addStatusCheck(context, {
    status: 'completed',
    conclusion: 'success',
    started_at: context.payload.pull_request.created_at,
    completed_at: new Date(),
    output: {
      title: '✓ All reviews done !',
      summary: 'Pull request was successfully reviewed'
    }
  }); // const updateStatusCheck = (context, reviewGroup, statusInfo) => {};


  const hasNeedsReview = labels => labels.some(label => needsReviewLabelIds.includes(label.id));

  const hasRequestedReview = labels => labels.some(label => requestedReviewLabelIds.includes(label.id));

  const hasApprovesReview = labels => labels.some(label => approvedReviewLabelIds.includes(label.id));

  const updateStatusCheckFromLabels = async (context, labels = context.payload.pull_request.labels || []) => {
    context.log.info('updateStatusCheckFromLabels', {
      labels: labels.map(l => l && l.name),
      hasNeedsReview: hasNeedsReview(labels),
      hasApprovesReview: hasApprovesReview(labels)
    });

    if (hasNeedsReview(labels)) {
      if (config.requiresReviewRequest && !hasRequestedReview(labels)) {
        await createFailedStatusCheck(context, 'You need to request someone to review the PR');
        return;
      }

      await createInProgressStatusCheck(context);
    } else if (hasApprovesReview(labels)) {
      await createDoneStatusCheck(context);
    }
  };

  const lock$1 = lock.Lock();
  return Object.assign(repoContext, {
    labels,
    updateStatusCheckFromLabels,
    lockPR: (context, callback) => new Promise((resolve, reject) => {
      const pr = context.payload.pull_request;
      console.log('lock: try to lock pr', {
        id: pr.id
      });
      lock$1(`${pr.id}`, async release => {
        console.log('lock: lock acquired', {
          id: pr.id
        });

        try {
          await callback();
        } catch (err) {
          console.log('lock: release pr (with error)', {
            id: pr.id
          });
          release()();
          reject(err);
          return;
        }

        console.log('lock: release pr', {
          id: pr.id
        });
        release()();
        resolve();
      });
    }),
    updateReviewStatus: async (context, reviewGroup, {
      add: labelsToAdd,
      remove: labelsToRemove
    }) => {
      context.log.info('updateReviewStatus', {
        reviewGroup,
        labelsToAdd,
        labelsToRemove
      });
      if (!reviewGroup) return;
      const prLabels = context.payload.pull_request.labels || [];
      const newLabels = new Set(prLabels.map(label => label.name));
      const toAdd = new Set();
      const toDelete = new Set();

      const getLabelFromKey = key => {
        const reviewConfig = config.labels.review[reviewGroup];
        if (!reviewConfig) return undefined;
        return reviewConfig[key] && labels[reviewConfig[key]] ? labels[reviewConfig[key]] : undefined;
      };

      if (labelsToAdd) {
        labelsToAdd.forEach(key => {
          if (!key) return;
          const label = getLabelFromKey(key);

          if (!label || prLabels.some(prLabel => prLabel.id === label.id)) {
            return;
          }

          newLabels.add(label.name);
          toAdd.add(key);
        });
      }

      if (labelsToRemove) {
        labelsToRemove.forEach(key => {
          if (!key) return;
          const label = getLabelFromKey(key);
          if (!label) return;
          const existing = prLabels.find(prLabel => prLabel.id === label.id);

          if (existing) {
            newLabels.delete(existing.name);
            toDelete.add(key);
          }
        });
      }

      context.log.info('updateReviewStatus', {
        reviewGroup,
        toAdd: [...toAdd],
        toDelete: [...toDelete],
        oldLabels: prLabels.map(l => l.name),
        newLabels: [...newLabels]
      }); // if (process.env.DRY_RUN) return;

      if (toAdd.size || toDelete.size) {
        await context.github.issues.replaceLabels(context.issue({
          labels: [...newLabels]
        }));
      } // if (toAdd.has('needsReview')) {
      //   createInProgressStatusCheck(context);
      // } else if (
      //   toDelete.has('needsReview') ||
      //   (prLabels.length === 0 && toAdd.size === 1 && toAdd.has('approved'))
      // ) {


      updateStatusCheckFromLabels(context, [...newLabels].map(labelName => labelsValues.find(l => l.name === labelName)) // ignore labels not handled, like "wip"
      .filter(ExcludesFalsy$2)); // }
    },
    addStatusCheckToLatestCommit: context => // old and new sha
    // const { before, after } = context.payload;
    updateStatusCheckFromLabels(context)
  });
}

const repoContextsPromise = new Map();
const repoContexts = new Map();
const obtainRepoContext = context => {
  const owner = context.payload.repository.owner;

  if (!teamConfigs[owner.login]) {
    console.warn(owner.login, Object.keys(teamConfigs));
    return null;
  }

  const key = context.payload.repository.id;
  const existingRepoContext = repoContexts.get(key);
  if (existingRepoContext) return existingRepoContext;
  const existingPromise = repoContextsPromise.get(key);
  if (existingPromise) return Promise.resolve(existingPromise);
  const promise = initRepoContext(context, teamConfigs[owner.login]);
  repoContextsPromise.set(key, promise);
  return promise.then(repoContext => {
    repoContextsPromise.delete(key);
    repoContexts.set(key, repoContext);
    return repoContext;
  });
};

const handlerPullRequestChange = async (context, callback) => {
  const repoContext = await obtainRepoContext(context);
  if (!repoContext) return;
  repoContext.lockPR(context, async () => {
    await callback(repoContext);
  });
};
const createHandlerPullRequestChange = callback => context => {
  return handlerPullRequestChange(context, repoContext => callback(context, repoContext));
};

const autoAssignPRToCreator = async (context, repoContext) => {
  if (!repoContext.config.autoAssignToCreator) return;
  const pr = context.payload.pull_request;
  if (pr.assignees.length !== 0) return;
  if (pr.user.type === 'Bot') return;
  await context.github.issues.addAssignees(context.issue({
    assignees: [pr.user.login]
  }));
};

const cleanTitle = title => title.trim().replace(/[\s-]+\[?\s*(ONK-\d+)\s*]?\s*$/, ' $1').replace(/^([A-Za-z]+)[/:]\s*/, (s, arg1) => `${arg1.toLowerCase()}: `).replace(/^Revert "([^"]+)"$/, 'revert: $1') // eslint-disable-next-line unicorn/no-unsafe-regex
.replace(/^(revert:.*)(\s+\(#\d+\))$/, '$1');

const editOpenedPR = (context, repoContext) => {
  if (!repoContext.config.trimTitle) return;
  const pr = context.payload.pull_request;
  const title = cleanTitle(pr.title);

  if (pr.title !== title) {
    pr.title = title;
    context.github.issues.update(context.issue({
      title
    }));
  }
};

const ExcludesFalsy$3 = Boolean;
const lintPR = async (context, repoContext) => {
  if (!repoContext.config.prLint) return;
  const repo = context.payload.repository;
  const pr = context.payload.pull_request; // do not lint pr from forks

  if (pr.head.repo.id !== repo.id) return;
  const isPrFromBot = pr.user.type === 'Bot';
  const statuses = [];
  const errorRule = repoContext.config.prLint.title.find(rule => {
    if (rule.bot === false && isPrFromBot) return false;
    const match = rule.regExp.exec(pr.title);

    if (match === null) {
      if (rule.status) {
        statuses.push({
          name: rule.status,
          error: rule.error
        });
      }

      return true;
    }

    if (rule.status && rule.statusInfoFromMatch) {
      statuses.push({
        name: rule.status,
        info: rule.statusInfoFromMatch(match)
      });
      return false;
    }

    return false;
  });
  const date = new Date().toString();
  const hasLintPrCheck = (await context.github.checks.listForRef(context.repo({
    ref: pr.head.sha
  }))).data.check_runs.find(check => check.name === `${process.env.NAME}/lint-pr`);
  await Promise.all([...statuses.map(({
    name,
    error,
    info
  }) => context.github.repos.createStatus(context.repo({
    context: `${process.env.NAME}/${name}`,
    sha: pr.head.sha,
    state: error ? 'failure' : 'success',
    target_url: error ? undefined : info.url,
    description: error ? error.title : info.title
  }))), hasLintPrCheck && context.github.checks.create(context.repo({
    name: `${process.env.NAME}/lint-pr`,
    head_sha: pr.head.sha,
    status: 'completed',
    conclusion: errorRule ? 'failure' : 'success',
    started_at: date,
    completed_at: date,
    output: errorRule ? errorRule.error : {
      title: '✓ Your PR is valid',
      summary: ''
    }
  })), !hasLintPrCheck && context.github.repos.createStatus(context.repo({
    context: `${process.env.NAME}/lint-pr`,
    sha: pr.head.sha,
    state: errorRule ? 'failure' : 'success',
    target_url: undefined,
    description: errorRule ? errorRule.error.title : '✓ Your PR is valid'
  }))].filter(ExcludesFalsy$3));
};

var openedHandler = (app => {
  app.on('pull_request.opened', createHandlerPullRequestChange(async (context, repoContext) => {
    await Promise.all([autoAssignPRToCreator(context, repoContext), editOpenedPR(context, repoContext), lintPR(context, repoContext), repoContext.updateReviewStatus(context, 'dev', {
      add: ['needsReview']
    })]);
  }));
});

var reviewRequestedHandler = (app => {
  app.on('pull_request.review_requested', createHandlerPullRequestChange(async (context, repoContext) => {
    const sender = context.payload.sender; // ignore if sender is self (dismissed review rerequest review)

    if (sender.type === 'Bot') return;
    const pr = context.payload.pull_request;
    const reviewer = context.payload.requested_reviewer;
    const reviewerGroup = repoContext.getReviewerGroup(reviewer.login);

    // repoContext.reviewShouldWait(reviewerGroup, pr.requested_reviewers, { includesWaitForGroups: true });
    if (reviewerGroup && repoContext.config.labels.review[reviewerGroup]) {
      const {
        data: reviews
      } = await context.github.pulls.listReviews(context.issue({
        per_page: 50
      }));
      const hasChangesRequestedInReviews = reviews.some(review => repoContext.getReviewerGroup(review.user.login) === reviewerGroup && review.state === 'REQUEST_CHANGES' && // In case this is a rerequest for review
      review.user.login !== reviewer.login);

      if (!hasChangesRequestedInReviews) {
        await repoContext.updateReviewStatus(context, reviewerGroup, {
          add: ['needsReview', "requested"],
          remove: ['approved', 'changesRequested']
        });
      }
    }

    if (sender.login === reviewer.login) return;

    if (repoContext.slack) {
      repoContext.slack.postMessage(reviewer.login, `:eyes: ${repoContext.slack.mention(sender.login)} requests your review on ${pr.html_url} !\n> ${pr.title}`);
    }
  }));
});

var reviewRequestRemovedHandler = (app => {
  app.on('pull_request.review_request_removed', createHandlerPullRequestChange(async (context, repoContext) => {
    const sender = context.payload.sender;
    const pr = context.payload.pull_request;
    const reviewer = context.payload.requested_reviewer;
    const reviewerGroup = repoContext.getReviewerGroup(reviewer.login);
    const hasRequestedReviewsForGroup = repoContext.reviewShouldWait(reviewerGroup, pr.requested_reviewers, {
      includesReviewerGroup: true
    });

    if (reviewerGroup && repoContext.config.labels.review[reviewerGroup]) {
      const {
        data: reviews
      } = await context.github.pulls.listReviews(context.issue({
        per_page: 50
      }));
      const hasChangesRequestedInReviews = reviews.some(review => repoContext.getReviewerGroup(review.user.login) === reviewerGroup && review.state === 'REQUEST_CHANGES');
      const hasApprovedInReviews = reviews.some(review => repoContext.getReviewerGroup(review.user.login) === reviewerGroup && review.state === 'APPROVED');
      const approved = !hasRequestedReviewsForGroup && !hasChangesRequestedInReviews && hasApprovedInReviews;
      await repoContext.updateReviewStatus(context, reviewerGroup, {
        add: [// if changes requested by the one which requests was removed
        hasChangesRequestedInReviews && 'changesRequested', // if was already approved by another member in the group and has no other requests waiting
        approved && 'approved'],
        // remove labels if has no other requests waiting
        remove: [approved && 'needsReview', !hasRequestedReviewsForGroup && !hasChangesRequestedInReviews && 'requested']
      });
    }

    if (sender.login === reviewer.login) return;

    if (repoContext.slack) {
      repoContext.slack.postMessage(reviewer.login, `:skull_and_crossbones: ${repoContext.slack.mention(sender.login)} removed the request for your review on ${pr.html_url}`);
    }
  }));
});

var reviewSubmittedHandler = (app => {
  app.on('pull_request_review.submitted', createHandlerPullRequestChange(async (context, repoContext) => {
    const pr = context.payload.pull_request;
    const {
      user: reviewer,
      state
    } = context.payload.review;
    if (pr.user.login === reviewer.login) return;
    const reviewerGroup = repoContext.getReviewerGroup(reviewer.login);

    if (reviewerGroup && repoContext.config.labels.review[reviewerGroup]) {
      const hasRequestedReviewsForGroup = repoContext.reviewShouldWait(reviewerGroup, pr.requested_reviewers, {
        includesReviewerGroup: true // TODO reenable this when accepted can notify request review to slack (dev accepted => design requested) and flag to disable for label (approved design ; still waiting for dev ?)
        // includesWaitForGroups: true,

      });
      const {
        data: reviews
      } = await context.github.pulls.listReviews(context.issue({
        per_page: 50
      }));
      const hasChangesRequestedInReviews = reviews.some(review => repoContext.getReviewerGroup(review.user.login) === reviewerGroup && review.state === 'REQUEST_CHANGES');
      const approved = !hasRequestedReviewsForGroup && !hasChangesRequestedInReviews && state === 'approved';
      await repoContext.updateReviewStatus(context, reviewerGroup, {
        add: [approved && 'approved', state === 'changes_requested' && 'changesRequested'],
        remove: [approved && 'needsReview', !(hasRequestedReviewsForGroup || state === 'changes_requested') && 'requested', state === 'approved' && !hasChangesRequestedInReviews && 'changesRequested', state === 'changes_requested' && 'approved']
      });
    }

    const mention = repoContext.slack.mention(reviewer.login);
    const prUrl = pr.html_url;

    const message = (() => {
      if (state === 'changes_requested') {
        return `:x: ${mention} requests changes on ${prUrl}`;
      }

      if (state === 'approved') {
        return `:clap: :white_check_mark: ${mention} approves ${prUrl}`;
      }

      return `:speech_balloon: ${mention} commented on ${prUrl}`;
    })();

    repoContext.slack.postMessage(pr.user.login, message);
  }));
});

var reviewDismissedHandler = (app => {
  app.on('pull_request_review.dismissed', createHandlerPullRequestChange(async (context, repoContext) => {
    const sender = context.payload.sender;
    const pr = context.payload.pull_request;
    const reviewer = context.payload.review.user;
    const reviewerGroup = repoContext.getReviewerGroup(reviewer.login);

    if (reviewerGroup && repoContext.config.labels.review[reviewerGroup]) {
      const {
        data: reviews
      } = await context.github.pulls.listReviews(context.issue({
        per_page: 50
      }));
      const hasChangesRequestedInReviews = reviews.some(review => repoContext.getReviewerGroup(review.user.login) === reviewerGroup && review.state === 'REQUEST_CHANGES');
      await repoContext.updateReviewStatus(context, reviewerGroup, {
        add: ['needsReview', 'requested'],
        remove: [!hasChangesRequestedInReviews && 'changesRequested', 'approved']
      });
    }

    if (repoContext.slack) {
      if (sender.login === reviewer.login) {
        repoContext.slack.postMessage(pr.user.login, `:skull: ${repoContext.slack.mention(reviewer.login)} dismissed his review on ${pr.html_url}`);
      } else {
        repoContext.slack.postMessage(reviewer.login, `:skull: ${repoContext.slack.mention(sender.login)} dismissed your review on ${pr.html_url}`);
      }
    }
  }));
});

var synchromizeHandler = (app => {
  app.on('pull_request.synchronize', createHandlerPullRequestChange(async (context, repoContext) => {
    await Promise.all([editOpenedPR(context, repoContext), repoContext.addStatusCheckToLatestCommit(context)]);
  }));
});

var editedHandler = (app => {
  app.on('pull_request.edited', createHandlerPullRequestChange(async (context, repoContext) => {
    await Promise.all([editOpenedPR(context, repoContext), lintPR(context, repoContext)]);
  }));
});

const autoMergeIfPossible = async (context, repoContext) => {
  const autoMergeLabel = repoContext.labels['merge/automerge'];
  if (!autoMergeLabel) return;
  const pr = context.payload.pull_request;
  if (!pr.labels.find(l => l.id === autoMergeLabel.id)) return;

  if (pr.mergeable) {
    const mergeResult = await context.github.pulls.merge({
      merge_method: 'squash',
      owner: pr.head.repo.owner.login,
      repo: pr.head.repo.name,
      number: pr.number,
      commit_title: `${pr.title} (#${pr.number})`,
      commit_message: '' // TODO add BC

    });
    context.log.info('merge result:', mergeResult);
  }
};

var labelsChanged = (app => {
  app.on(['pull_request.labeled', 'pull_request.unlabeled'], async context => {
    const sender = context.payload.sender;
    if (sender.type === 'Bot') return;
    await handlerPullRequestChange(context, async repoContext => {
      await repoContext.updateStatusCheckFromLabels(context);

      if (context.payload.action === 'labeled' && context.payload.label.id === (repoContext.labels['merge/automerge'] && repoContext.labels['merge/automerge'].id)) {
        await autoMergeIfPossible(context, repoContext);
      }
    });
  });
});

var checkrunCompleted = (app => {
  app.on(['check_run.completed'], createHandlerPullRequestChange(async (context, repoContext) => {
    await autoMergeIfPossible(context, repoContext);
  }));
});

var checksuiteCompleted = (app => {
  app.on(['check_suite.completed'], createHandlerPullRequestChange(async (context, repoContext) => {
    await autoMergeIfPossible(context, repoContext);
  }));
});

if (!process.env.NAME) process.env.NAME = 'reviewflow'; // const getConfig = require('probot-config')
// const { MongoClient } = require('mongodb');
// const connect = MongoClient.connect(process.env.MONGO_URL);
// const db = connect.then(client => client.db(process.env.MONGO_DB));
// let config = await getConfig(context, 'reviewflow.yml');
// eslint-disable-next-line import/no-commonjs

probot.Probot.run(app => {
  openedHandler(app);
  reviewRequestedHandler(app);
  reviewRequestRemovedHandler(app); // app.on('pull_request.closed', async context => {
  // });
  // app.on('pull_request.reopened', async context => {
  // });

  reviewSubmittedHandler(app);
  reviewDismissedHandler(app);
  labelsChanged(app);
  synchromizeHandler(app);
  editedHandler(app);
  checkrunCompleted(app);
  checksuiteCompleted(app);
});
//# sourceMappingURL=index-node10-dev.cjs.js.map