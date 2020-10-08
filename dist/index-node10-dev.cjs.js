'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

require('dotenv/config');
const probot = require('probot');
const liwiMongo = require('liwi-mongo');
const cookieParser = _interopDefault(require('cookie-parser'));
const React = _interopDefault(require('react'));
const server = require('react-dom/server');
const util = require('util');
const jsonwebtoken = require('jsonwebtoken');
const simpleOauth2 = require('simple-oauth2');
const bodyParser = _interopDefault(require('body-parser'));
const lock = require('lock');
const webApi = require('@slack/web-api');
const createEmojiRegex = _interopDefault(require('emoji-regex'));
const parse$1 = _interopDefault(require('@commitlint/parse'));
const issueParser = _interopDefault(require('issue-parser'));
const slackifyMarkdown = _interopDefault(require('slackify-markdown'));

if (!process.env.MONGO_DB) {
  throw new Error('MONGO_DB is missing in process.env');
}

function init() {
  const config = new Map([['host', process.env.MONGO_HOST || 'localhost'], ['port', process.env.MONGO_PORT || '27017'], ['database', process.env.MONGO_DB]]);

  if (process.env.MONGO_USER) {
    config.set('user', process.env.MONGO_USER);
    config.set('password', process.env.MONGO_PASSWORD);
  }

  const connection = new liwiMongo.MongoConnection(config); // const prEvents = new MongoStore<PrEventsModel>(connection, 'prEvents');
  // prEvents.collection.then((coll) => {
  //   coll.createIndex({ owner: 1, repo: 1, ???: 1 });
  // });

  const userDmSettings = new liwiMongo.MongoStore(connection, 'userDmSettings');
  userDmSettings.collection.then(coll => {
    coll.createIndex({
      userId: 1,
      orgId: 1
    }, {
      unique: true
    });
  });
  const users = new liwiMongo.MongoStore(connection, 'users');
  users.collection.then(coll => {
    coll.createIndex({
      login: 1
    }, {
      unique: true
    });
  });
  const orgs = new liwiMongo.MongoStore(connection, 'orgs');
  orgs.collection.then(coll => {
    coll.createIndex({
      login: 1
    }, {
      unique: true
    });
  });
  const orgMembers = new liwiMongo.MongoStore(connection, 'orgMembers');
  orgMembers.collection.then(coll => {
    coll.createIndex({
      'user.id': 1,
      'org.id': 1
    }, {
      unique: true
    });
  });
  const orgTeams = new liwiMongo.MongoStore(connection, 'orgTeams');
  orgTeams.collection.then(coll => {
    coll.createIndex({
      'org.id': 1
    });
  });
  const slackSentMessages = new liwiMongo.MongoStore(connection, 'slackSentMessages');
  slackSentMessages.collection.then(coll => {
    coll.createIndex({
      'account.id': 1,
      'account.type': 1,
      type: 1,
      typeId: 1
    }); // remove older than 14 days

    coll.deleteMany({
      created: {
        $lt: new Date(Date.now() - 1209600000)
      }
    });
  });
  const automergeLogs = new liwiMongo.MongoStore(connection, 'automergeLogs');
  automergeLogs.collection.then(coll => {
    coll.createIndex({
      repoFullName: 1,
      type: 1
    });
    coll.createIndex({
      repoFullName: 1,
      'pr.number': 1
    }); // remove older than 30 days

    coll.deleteMany({
      created: {
        $lt: new Date(Date.now() - 2592000000)
      }
    });
  });
  const prs = new liwiMongo.MongoStore(connection, 'prs');
  prs.collection.then(coll => {
    coll.createIndex({
      'account.id': 1,
      'repo.id': 1,
      'pr.number': 1
    }, {
      unique: true
    }); // remove older than 12 * 30 days

    coll.deleteMany({
      created: {
        $lt: new Date(Date.now() - 31104000000)
      }
    });
  }); // return { connection, prEvents };

  return {
    connection,
    userDmSettings,
    users,
    orgs,
    orgMembers,
    orgTeams,
    slackSentMessages,
    automergeLogs,
    prs
  };
}

function Layout({
  lang = 'en',
  title = process.env.REVIEWFLOW_NAME,
  children
}) {
  return /*#__PURE__*/React.createElement("html", {
    lang: lang
  }, /*#__PURE__*/React.createElement("head", null, /*#__PURE__*/React.createElement("meta", {
    charSet: "UTF-8"
  }), /*#__PURE__*/React.createElement("meta", {
    name: "robots",
    content: "noindex"
  }), /*#__PURE__*/React.createElement("title", null, title), /*#__PURE__*/React.createElement("link", {
    rel: "stylesheet",
    type: "text/css",
    href: "https://christophe.hurpeau.com/index.css"
  }), /*#__PURE__*/React.createElement("style", null, `html,body,html body
            #container{height:100%} footer{position:absolute;bottom:5px;left:0;right:0;}`)), /*#__PURE__*/React.createElement("body", null, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '24px 48px'
    }
  }, children)));
}

if (!process.env.GITHUB_CLIENT_ID) {
  throw new Error('Missing env variable: GITHUB_CLIENT_ID');
}

if (!process.env.GITHUB_CLIENT_SECRET) {
  throw new Error('Missing env variable: GITHUB_CLIENT_SECRET');
}

const oauth2 = simpleOauth2.create({
  client: {
    id: process.env.GITHUB_CLIENT_ID,
    secret: process.env.GITHUB_CLIENT_SECRET
  },
  auth: {
    tokenHost: 'https://github.com',
    tokenPath: '/login/oauth/access_token',
    authorizePath: '/login/oauth/authorize'
  }
});

if (!process.env.AUTH_SECRET_KEY) {
  throw new Error('Missing env variable: AUTH_SECRET_KEY');
}

const AUTH_SECRET_KEY = process.env.AUTH_SECRET_KEY;
const signPromisified = util.promisify(jsonwebtoken.sign);
const verifyPromisified = util.promisify(jsonwebtoken.verify);
const secure = !!process.env.SECURE_COOKIE && process.env.SECURE_COOKIE !== 'false';

const createRedirectUri = req => {
  const host = `http${secure ? 's' : ''}://${req.hostname}${req.hostname === 'localhost' ? `:${process.env.PORT}` : ''}`;
  return `${host}/app/login-response`;
};

const readAuthCookie = (req, strategy) => {
  const cookie = req.cookies[`auth_${strategy}`];
  if (!cookie) return;
  return verifyPromisified(cookie, AUTH_SECRET_KEY, {
    algorithm: 'HS512',
    audience: req.headers['user-agent']
  });
};

const getAuthInfoFromCookie = async (req, res) => {
  // req.params.strategy
  const authInfo = await readAuthCookie(req, "gh");

  if (authInfo === null || authInfo === void 0 ? void 0 : authInfo.id) {
    return authInfo;
  }

  res.clearCookie(`auth_${"gh"}`);
  return undefined;
};

const getUser = async (req, res) => {
  const authInfo = await getAuthInfoFromCookie(req, res);

  if (!authInfo) {
    res.redirect('/app/login');
    return null;
  }

  return {
    authInfo,
    api: new probot.Octokit({
      auth: `token ${authInfo.accessToken}`
    })
  };
};
function auth(router) {
  router.get('/login', async (req, res) => {
    if (await getAuthInfoFromCookie(req, res)) {
      return res.redirect('/app');
    } // const state = await randomHex(8);
    // res.cookie(`auth_${strategy}_${state}`, strategy, {
    //   maxAge: 10 * 60 * 1000,
    //   httpOnly: true,
    //   secure,
    // });


    const redirectUri = oauth2.authorizationCode.authorizeURL({
      redirect_uri: createRedirectUri(req),
      scope: 'read:user,repo' // state,
      // grant_type: options.grantType,
      // access_type: options.accessType,
      // login_hint: req.query.loginHint,
      // include_granted_scopes: options.includeGrantedScopes,

    }); // console.log(redirectUri);

    res.redirect(redirectUri);
  });
  router.get('/login-response', async (req, res) => {
    if (req.query.error) {
      res.send(req.query.error_description);
      return;
    }

    const code = req.query.code; // const state = req.query.state;
    // const cookieName = `auth_${strategy}_${state}`;
    // const cookie = req.cookies && req.cookies[cookieName];
    // if (!cookie) {
    //   // res.redirect(`/${strategy}/login`);
    //   res.send(
    //     '<html><body>No cookie for this state. <a href="/app/login">Retry ?</a></body></html>',
    //   );
    //   return;
    // }
    // res.clearCookie(cookieName);

    const result = await oauth2.authorizationCode.getToken({
      code,
      redirect_uri: createRedirectUri(req)
    });

    if (!result) {
      res.send(server.renderToStaticMarkup( /*#__PURE__*/React.createElement(Layout, null, /*#__PURE__*/React.createElement("div", null, "Could not get access token. ", /*#__PURE__*/React.createElement("a", {
        href: "/app/login"
      }, "Retry ?")))));
      return;
    }

    const accessToken = result.access_token;
    const octokit = new probot.Octokit({
      auth: `token ${accessToken}`
    });
    const user = await octokit.users.getAuthenticated({});
    const id = user.data.id;
    const login = user.data.login;
    const authInfo = {
      id,
      login,
      accessToken,
      time: Date.now()
    };
    const token = await signPromisified(authInfo, AUTH_SECRET_KEY, {
      algorithm: 'HS512',
      audience: req.headers['user-agent'],
      expiresIn: '10 days'
    });
    res.cookie(`auth_${"gh"}`, token, {
      httpOnly: true,
      secure
    });
    res.redirect('/app');
  });
}

function repository(router, api) {
  router.get('/repositories', async (req, res) => {
    const user = await getUser(req, res);
    if (!user) return;
    const {
      data
    } = await user.api.repos.list({
      per_page: 100
    });
    res.send(server.renderToStaticMarkup( /*#__PURE__*/React.createElement(Layout, null, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h4", null, "Your repositories"), /*#__PURE__*/React.createElement("ul", null, data.map(repo => /*#__PURE__*/React.createElement("li", {
      key: repo.id
    }, /*#__PURE__*/React.createElement("a", {
      href: `/app/repository/${repo.owner.login}/${repo.name}`
    }, repo.name)))), data.length === 100 && /*#__PURE__*/React.createElement("div", null, "We currently have a limit to 100 repositories")))));
  });
  router.get('/repository/:owner/:repository', async (req, res) => {
    const user = await getUser(req, res);
    if (!user) return;
    const {
      data
    } = await user.api.repos.get({
      owner: req.params.owner,
      repo: req.params.repository
    });

    if (!data) {
      res.status(404).send(server.renderToStaticMarkup( /*#__PURE__*/React.createElement(Layout, null, /*#__PURE__*/React.createElement("div", null, "repo not found"))));
      return;
    }

    if (!data.permissions.admin) {
      res.status(401).send(server.renderToStaticMarkup( /*#__PURE__*/React.createElement(Layout, null, /*#__PURE__*/React.createElement("div", null, "not authorized to see this repo, you need to have admin permission"))));
      return;
    }

    const {
      data: data2
    } = await api.apps.getRepoInstallation({
      owner: req.params.owner,
      repo: req.params.repository
    }).catch(err => {
      return {
        status: err.status,
        data: undefined
      };
    });

    if (!data2) {
      res.send(server.renderToStaticMarkup( /*#__PURE__*/React.createElement(Layout, null, /*#__PURE__*/React.createElement("div", null, process.env.REVIEWFLOW_NAME, ' ', "isn't installed on this repo. Go to ", /*#__PURE__*/React.createElement("a", {
        href: `https://github.com/apps/${process.env.REVIEWFLOW_NAME}/installations/new`
      }, "Github Configuration"), ' ', "to add it."))));
      return;
    }

    res.send(server.renderToStaticMarkup( /*#__PURE__*/React.createElement(Layout, null, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h4", null, req.params.repository)))));
  });
}

function home(router) {
  router.get('/', async (req, res) => {
    const user = await getUser(req, res);
    if (!user) return;
    const orgs = await user.api.orgs.listForAuthenticatedUser();
    res.send(server.renderToStaticMarkup( /*#__PURE__*/React.createElement(Layout, null, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, process.env.REVIEWFLOW_NAME), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flexGrow: 1
      }
    }, /*#__PURE__*/React.createElement("h4", null, "Choose your account"), /*#__PURE__*/React.createElement("ul", null, /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement("a", {
      href: "/app/user"
    }, user.authInfo.login)), orgs.data.map(org => /*#__PURE__*/React.createElement("li", {
      key: org.id
    }, /*#__PURE__*/React.createElement("a", {
      href: `/app/org/${org.login}`
    }, org.login))))))))));
  });
}

const syncTeams = async (mongoStores, github, org) => {
  const orgEmbed = {
    id: org.id,
    login: org.login
  };
  const teamIds = [];
  await Promise.all(await github.paginate(github.teams.list.endpoint.merge({
    org: org.login
  }), ({
    data
  }) => {
    return Promise.all(data.map(team => {
      teamIds.push(team.id);
      return mongoStores.orgTeams.upsertOne({
        _id: team.id,
        // TODO _id number
        org: orgEmbed,
        name: team.name,
        slug: team.slug,
        description: team.description
      });
    }));
  }));
  await mongoStores.orgTeams.deleteMany({
    'org.id': org.id,
    _id: {
      $not: {
        $in: teamIds
      }
    }
  });
};

const syncOrg = async (mongoStores, github, installationId, org) => {
  const orgInStore = await mongoStores.orgs.upsertOne({
    _id: org.id,
    // TODO _id is number
    login: org.login,
    installationId
  });
  const orgEmbed = {
    id: org.id,
    login: org.login
  };
  const memberIds = [];
  await Promise.all(await github.paginate(github.orgs.listMembers.endpoint.merge({
    org: org.login
  }), ({
    data
  }) => {
    return Promise.all(data.map(async member => {
      memberIds.push(member.id);
      return Promise.all([mongoStores.orgMembers.upsertOne({
        _id: `${org.id}_${member.id}`,
        org: orgEmbed,
        user: {
          id: member.id,
          login: member.login
        }
      }), mongoStores.users.upsertOne({
        _id: member.id,
        login: member.login,
        type: member.type
      })]);
    }));
  }));
  await mongoStores.orgMembers.deleteMany({
    'org.id': org.id,
    'user.id': {
      $not: {
        $in: memberIds
      }
    }
  });
  return orgInStore;
};

const config = {
  autoAssignToCreator: true,
  trimTitle: true,
  requiresReviewRequest: false,
  prDefaultOptions: {
    featureBranch: false,
    autoMergeWithSkipCi: false,
    autoMerge: false,
    deleteAfterMerge: true
  },
  parsePR: {
    title: []
  },
  groups: {},
  waitForGroups: {},
  teams: {},
  labels: {
    list: {
      // /* ci */
      // 'ci/in-progress': { name: ':green_heart: ci/in-progress', color: '#0052cc' },
      // 'ci/fail': { name: ':green_heart: ci/fail', color: '#e11d21' },
      // 'ci/passed': { name: ':green_heart: ci/passed', color: '#86f9b4' },

      /* infos */
      'breaking-changes': {
        name: ':warning: Breaking Changes',
        color: '#ef7934'
      }
    },
    review: {
      ci: {
        inProgress: 'ci/in-progress',
        succeeded: 'ci/success',
        failed: 'ci/fail'
      }
    }
  }
};

const config$1 = {
  autoAssignToCreator: true,
  trimTitle: true,
  ignoreRepoPattern: '(infra-.*|devenv)',
  requiresReviewRequest: true,
  autoMergeRenovateWithSkipCi: true,
  prDefaultOptions: {
    featureBranch: false,
    autoMergeWithSkipCi: false,
    autoMerge: false,
    deleteAfterMerge: true
  },
  parsePR: {
    title: [{
      regExp: // eslint-disable-next-line unicorn/no-unsafe-regex
      /^(revert: )?(build|chore|ci|docs|feat|fix|perf|refactor|style|test)(\(([/a-z-]*)\))?:\s/,
      error: {
        title: 'Title does not match commitlint conventional',
        summary: 'https://github.com/marionebl/commitlint/tree/master/%40commitlint/config-conventional'
      }
    }, {
      bot: false,
      regExp: /\s([A-Z][\dA-Z]+-(\d+)|\[no issue])$/,
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
          inBody: true,
          url: `https://ornikar.atlassian.net/browse/${issue}`,
          title: `JIRA issue: ${issue}`,
          summary: `[${issue}](https://ornikar.atlassian.net/browse/${issue})`
        };
      }
    }]
  },
  botUsers: ['michael-robot'],
  groups: {
    dev: {
      /* ops */
      JulienBreux: `julien.breux${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      TheR3aLp3nGuinJM: `jean-michel${process.env.ORNIKAR_EMAIL_DOMAIN}`,

      /* back */
      abarreir: `alexandre${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      damienorny: `damien.orny${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      'Thierry-girod': `thierry${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      darame07: `kevin${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      Pixy: `pierre-alexis${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      machartier: `marie-anne${process.env.ORNIKAR_EMAIL_DOMAIN}`,

      /* front */
      christophehurpeau: `christophe${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      HugoGarrido: `hugo${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      CorentinAndre: `corentin${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      Mxime: `maxime${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      vlbr: `valerian${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      'budet-b': `benjamin.budet${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      mdcarter: `maxime.dehaye${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      ChibiBlasphem: `christopher${process.env.ORNIKAR_EMAIL_DOMAIN}`
    },
    design: {
      jperriere: `julien${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      CoralineColasse: `coraline${process.env.ORNIKAR_EMAIL_DOMAIN}`,
      Lenamari: `lena${process.env.ORNIKAR_EMAIL_DOMAIN}`
    }
  },
  teams: {
    ops: {
      logins: ['JulienBreux', 'Alan-pad', 'CamilSadiki', 'busser'],
      labels: ['teams/ops']
    },
    backends: {
      logins: ['abarreir', 'arthurflachs', 'damienorny', 'Thierry-girod', 'darame07', 'Pixy', 'Radyum'],
      labels: ['teams/backend']
    },
    frontends: {
      logins: ['christophehurpeau', 'HugoGarrido', 'LentnerStefan', 'CorentinAndre', 'Mxime', 'vlbr', 'budet-b', 'mdcarter', 'ChibiBlasphem'],
      labels: ['teams/frontend']
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
        color: '#FFC44C'
      },
      'code/review-requested': {
        name: ':ok_hand: code/review-requested',
        color: '#DAE1E6'
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
        color: '#FFC44C'
      },
      'design/review-requested': {
        name: ':art: design/review-requested',
        color: '#DAE1E6'
      },
      'design/changes-requested': {
        name: ':art: design/changes-requested',
        color: '#e11d21'
      },
      'design/approved': {
        name: ':art: design/approved',
        color: '#64DD17'
      },

      /* teams */
      'teams/ops': {
        name: 'ops',
        color: '#003b55'
      },
      'teams/backend': {
        name: 'backend',
        color: '#6ad8cb'
      },
      'teams/frontend': {
        name: 'frontend',
        color: '#8a5abc'
      },

      /* auto merge */
      'merge/automerge': {
        name: ':soon: automerge',
        color: '#64DD17'
      },
      'merge/skip-ci': {
        name: 'automerge/skip-ci',
        color: '#e1e8ed'
      },
      'merge/update-branch': {
        name: ':arrows_counterclockwise: update branch',
        color: '#e1e8ed'
      },

      /* feature-branch */
      'feature-branch': {
        name: 'feature-branch',
        color: '#7FCEFF'
      },

      /* infos */
      'breaking-changes': {
        name: ':warning: Breaking Changes',
        description: 'This issue or pull request will need a new major version',
        color: '#FF6F00'
      },
      duplicate: {
        name: 'duplicate',
        description: 'This issue or pull request already exists',
        color: '#ECEFF1'
      },
      documentation: {
        name: 'documentation',
        description: 'Improvements or additions to documentation',
        color: '#7FCEFF'
      },
      rfc: {
        name: 'RFC',
        description: 'Request For Comments',
        color: '#FFD3B2'
      },
      bug: {
        name: 'bug',
        description: "Something isn't working",
        color: '#FF3D00'
      },
      enhancement: {
        name: 'enhancement',
        description: 'New feature or request',
        color: '#7FCEFF'
      },
      'help-wanted': {
        name: 'help wanted',
        description: 'Extra attention is needed',
        color: '#B1EE8B'
      },
      question: {
        name: 'question',
        description: 'Further information is requested',
        color: '#F860A4'
      },
      wontfix: {
        name: 'wontfix',
        description: 'This will not be worked on',
        color: '#ECEFF1'
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

const config$2 = {
  autoAssignToCreator: true,
  trimTitle: true,
  requiresReviewRequest: false,
  prDefaultOptions: {
    featureBranch: false,
    autoMergeWithSkipCi: false,
    autoMerge: false,
    deleteAfterMerge: true
  },
  parsePR: {
    title: [{
      regExp: // eslint-disable-next-line unicorn/no-unsafe-regex
      /^(revert: )?(build|chore|ci|docs|feat|fix|perf|refactor|style|test)(\(([/a-z-]*)\))?(!)?:\s/,
      error: {
        title: 'Title does not match commitlint conventional',
        summary: 'https://github.com/marionebl/commitlint/tree/master/%40commitlint/config-conventional'
      }
    }]
  },
  groups: {
    dev: {
      christophehurpeau: 'christophe@hurpeau.com',
      tilap: 'jlavinh@gmail.com'
    }
  },
  waitForGroups: {
    dev: []
  },
  teams: {},
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
      'merge/skip-ci': {
        name: 'automerge/skip-ci',
        color: '#e1e8ed'
      },
      'merge/update-branch': {
        name: ':arrows_counterclockwise: update branch',
        color: '#64DD17'
      },

      /* feature-branch */
      'feature-branch': {
        name: 'feature-branch',
        color: '#7FCEFF'
      },

      /* infos */
      'breaking-changes': {
        name: ':warning: Breaking Changes',
        color: '#ef7934'
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

const config$3 = { ...config$2,
  requiresReviewRequest: true,
  groups: {
    dev: {
      christophehurpeau: 'christophe@hurpeau.com',
      'chris-reviewflow': 'christophe.hurpeau+reviewflow@gmail.com'
    }
  }
};

const accountConfigs = {
  ornikar: config$1,
  christophehurpeau: config$2,
  reviewflow: config$3
};
// export const getMembers = <GroupNames extends string = any>(
//   groups: Record<GroupNames, Group>,
// ): string[] => {
//   return Object.values(groups).flat(1);
// };

const defaultDmSettings = {
  'pr-review': true,
  'pr-review-follow': true,
  'pr-comment': true,
  'pr-comment-bots': true,
  'pr-comment-follow': true,
  'pr-comment-follow-bots': false,
  'pr-comment-mention': true,
  'pr-comment-thread': true,
  'pr-merge-conflicts': true,
  'issue-comment-mention': true
};

const cache = new Map();

const getDefaultDmSettings = org => {
  const accountConfig = accountConfigs[org] || config;
  return accountConfig.defaultDmSettings ? { ...defaultDmSettings,
    ...accountConfig.defaultDmSettings
  } : defaultDmSettings;
};

const updateCache = (org, userId, newSettings) => {
  let orgCache = cache.get(org);

  if (!orgCache) {
    orgCache = new Map();
    cache.set(org, orgCache);
  }

  orgCache.set(userId, { ...getDefaultDmSettings(org),
    ...newSettings
  });
};
const getUserDmSettings = async (mongoStores, org, orgId, userId) => {
  const orgDefaultDmSettings = getDefaultDmSettings(org);
  const userDmSettingsConfig = await mongoStores.userDmSettings.findOne({
    orgId,
    userId
  });
  const config = userDmSettingsConfig ? { ...orgDefaultDmSettings,
    ...userDmSettingsConfig.settings
  } : orgDefaultDmSettings;
  updateCache(org, userId, config);
  return config;
};

const dmMessages = {
  'pr-review': 'You are assigned to a review, someone reviewed your PR',
  'pr-review-follow': "Someone reviewed a PR you're also reviewing",
  'pr-comment': 'Someone commented on your PR',
  'pr-comment-bots': 'A bot commented on your PR',
  'pr-comment-follow': "Someone commented on a PR you're reviewing",
  'pr-comment-follow-bots': "A bot commented on a PR you're reviewing",
  'pr-comment-mention': 'Someone mentioned you in a PR',
  'pr-comment-thread': "Someone replied to a discussion you're in",
  'pr-merge-conflicts': 'Your PR has a merge conflict (not implemented)',
  'issue-comment-mention': 'Someone mentioned you in an issue (not implemented)'
};
function orgSettings(router, api, mongoStores) {
  router.get('/org/:org/force-sync', async (req, res) => {
    const user = await getUser(req, res);
    if (!user) return;
    const orgs = await user.api.orgs.listForAuthenticatedUser();
    const org = orgs.data.find(o => o.login === req.params.org);
    if (!org) return res.redirect('/app');
    const o = await mongoStores.orgs.findByKey(org.id);
    if (!o) return res.redirect('/app');
    await syncOrg(mongoStores, user.api, o.installationId, org);
    await syncTeams(mongoStores, user.api, org);
    res.redirect(`/app/org/${req.params.org}`);
  });
  router.get('/org/:org', async (req, res) => {
    const user = await getUser(req, res);
    if (!user) return;
    const orgs = await user.api.orgs.listForAuthenticatedUser();
    const org = orgs.data.find(o => o.login === req.params.org);
    if (!org) return res.redirect('/app');
    const installation = await api.apps.getOrgInstallation({
      org: org.login
    }).catch(err => {
      return {
        status: err.status,
        data: undefined
      };
    });

    if (!installation) {
      return res.send(server.renderToStaticMarkup( /*#__PURE__*/React.createElement(Layout, null, /*#__PURE__*/React.createElement("div", null, process.env.REVIEWFLOW_NAME, ' ', "isn't installed for this user. Go to ", /*#__PURE__*/React.createElement("a", {
        href: `https://github.com/settings/apps/${process.env.REVIEWFLOW_NAME}/installations/new`
      }, "Github Configuration"), ' ', "to install it."))));
    }

    const accountConfig = accountConfigs[org.login];
    const userDmSettings = await getUserDmSettings(mongoStores, org.login, org.id, user.authInfo.id);
    res.send(server.renderToStaticMarkup( /*#__PURE__*/React.createElement(Layout, null, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, process.env.REVIEWFLOW_NAME), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex'
      }
    }, /*#__PURE__*/React.createElement("h2", {
      style: {
        flexGrow: 1
      }
    }, org.login), /*#__PURE__*/React.createElement("a", {
      href: "/app"
    }, "Switch account")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flexGrow: 1
      }
    }, /*#__PURE__*/React.createElement("h4", null, "Information"), !accountConfig ? 'Default config is used: https://github.com/christophehurpeau/reviewflow/blob/master/src/accountConfigs/defaultConfig.ts' : `Custom config: https://github.com/christophehurpeau/reviewflow/blob/master/src/accountConfigs/${org.login}.ts`), /*#__PURE__*/React.createElement("div", {
      style: {
        width: '380px'
      }
    }, /*#__PURE__*/React.createElement("h4", null, "My DM Settings"), Object.entries(dmMessages).map(([key, name]) => /*#__PURE__*/React.createElement("div", {
      key: key
    }, /*#__PURE__*/React.createElement("label", {
      htmlFor: key
    }, /*#__PURE__*/React.createElement("span", {
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML: {
        __html: `<input id="${key}" type="checkbox" autocomplete="off" ${userDmSettings[key] ? 'checked="checked" ' : ''}onclick="fetch(location.pathname, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: '${key}', value: event.currentTarget.checked }) })" />`
      }
    }), name)))))))));
  });
  router.patch('/org/:org', bodyParser.json(), async (req, res) => {
    if (!req.body) {
      res.status(400).send('not ok');
      return;
    }

    const user = await getUser(req, res);
    if (!user) return;
    const orgs = await user.api.orgs.listForAuthenticatedUser();
    const org = orgs.data.find(o => o.login === req.params.org);
    if (!org) return res.redirect('/app');
    (await mongoStores.userDmSettings.collection).updateOne({
      _id: `${org.id}_${user.authInfo.id}`
    }, {
      $set: {
        [`settings.${req.body.key}`]: req.body.value,
        updated: new Date()
      },
      $setOnInsert: {
        orgId: org.id,
        userId: user.authInfo.id,
        created: new Date()
      }
    }, {
      upsert: true
    });
    const userDmSettingsConfig = await mongoStores.userDmSettings.findOne({
      orgId: org.id,
      userId: user.authInfo.id
    });

    if (userDmSettingsConfig) {
      updateCache(org.login, user.authInfo.id, userDmSettingsConfig.settings);
    }

    res.send('ok');
  });
}

const syncUser = async (mongoStores, github, installationId, userInfo) => {
  const user = await mongoStores.users.upsertOne({
    _id: userInfo.id,
    login: userInfo.login,
    type: 'User',
    installationId
  });
  return user;
};

function userSettings(router, api, mongoStores) {
  router.get('/user/force-sync', async (req, res) => {
    const user = await getUser(req, res);
    if (!user) return; // const { data: installation } = await api.apps
    //   .getUserInstallation({
    //     username: user.authInfo.login,
    //   })
    //   .catch((err) => {
    //     return { status: err.status, data: undefined };
    //   });
    // console.log(installation);

    const u = await mongoStores.users.findByKey(user.authInfo.id);
    if (!u || !u.installationId) return res.redirect('/app');
    await syncUser(mongoStores, user.api, u.installationId, user.authInfo);
    res.redirect(`/app/user`);
  });
  router.get('/user', async (req, res) => {
    const user = await getUser(req, res);
    if (!user) return;
    const {
      data: installation
    } = await api.apps.getUserInstallation({
      username: user.authInfo.login
    }).catch(err => {
      return {
        status: err.status,
        data: undefined
      };
    });

    if (!installation) {
      return res.send(server.renderToStaticMarkup( /*#__PURE__*/React.createElement(Layout, null, /*#__PURE__*/React.createElement("div", null, process.env.REVIEWFLOW_NAME, ' ', "isn't installed for this user. Go to ", /*#__PURE__*/React.createElement("a", {
        href: `https://github.com/settings/apps/${process.env.REVIEWFLOW_NAME}/installations/new`
      }, "Github Configuration"), ' ', "to install it."))));
    }

    return res.send(server.renderToStaticMarkup( /*#__PURE__*/React.createElement(Layout, null, /*#__PURE__*/React.createElement("div", null, process.env.REVIEWFLOW_NAME, " is installed for this user"))));
  });
}

async function appRouter(app, {
  mongoStores
}) {
  const router = app.route('/app');
  const api = await app.auth();
  router.use(cookieParser());
  auth(router);
  repository(router, api);
  home(router);
  orgSettings(router, api, mongoStores);
  userSettings(router, api, mongoStores);
}

const fetchPr = async (context, prNumber) => {
  const prResult = await context.github.pulls.get(context.repo({
    pull_number: prNumber
  }));
  return prResult.data;
};

const options = ['featureBranch', 'autoMergeWithSkipCi', 'autoMerge', 'deleteAfterMerge'];
const optionsRegexps = options.map(option => ({
  key: option,
  regexp: new RegExp(`\\[([ xX]?)]\\s*<!-- reviewflow-${option} -->`)
}));
const optionsLabels = [{
  key: 'featureBranch',
  label: 'This PR is a feature branch'
}, {
  key: 'autoMergeWithSkipCi',
  label: 'Add `[skip ci]` on merge commit'
}, {
  key: 'autoMerge',
  label: 'Auto merge when this PR is ready and has no failed statuses. (Also has a queue per repo to prevent multiple useless "Update branch" triggers)'
}, {
  key: 'deleteAfterMerge',
  label: 'Automatic branch delete after this PR is merged'
}];

const parseOptions = (content, defaultOptions) => {
  return optionsRegexps.reduce((acc, {
    key,
    regexp
  }) => {
    const match = regexp.exec(content);
    acc[key] = !match ? defaultOptions[key] || false : match[1] === 'x' || match[1] === 'X';
    return acc;
  }, {});
};
const parseCommitNotes = content => {
  const commitNotes = content.replace(/^.*#### Commits Notes:(.*)#### Options:.*$/s, '$1');

  if (commitNotes === content) {
    return '';
  } else {
    return commitNotes.trim();
  }
};
const parseBody = (content, defaultOptions) => {
  return {
    options: parseOptions(content, defaultOptions),
    commitNotes: parseCommitNotes(content)
  };
};

const defaultCommentBody = 'This will be auto filled by reviewflow.';

const toMarkdownOptions = options => {
  return optionsLabels.map(({
    key,
    label
  }) => `- [${options[key] ? 'x' : ' '}] <!-- reviewflow-${key} -->${label}`).join('\n');
};

const toMarkdownInfos = infos => {
  return infos.map(info => {
    if (info.url) return `[${info.title}](${info.url})`;
    return info.title;
  }).join('\n');
};

const getReplacement = infos => {
  if (!infos) return '$1$2';
  return infos.length !== 0 ? `#### Infos:\n\n${toMarkdownInfos(infos)}\n\n$2` : '$2';
};

const updateOptions = (options, optionsToUpdate) => {
  if (!optionsToUpdate) return options;
  return { ...options,
    ...optionsToUpdate
  };
};

const internalUpdateBodyOptionsAndInfos = (body, options, infos) => {
  const infosAndCommitNotesParagraph = body.replace( // eslint-disable-next-line unicorn/no-unsafe-regex
  /^\s*(?:(#### Infos:.*)?(#### Commits Notes:.*)?#### Options:)?.*$/s, getReplacement(infos));
  return `${infosAndCommitNotesParagraph}#### Options:\n${toMarkdownOptions(options)}`;
};

const createCommentBody = (defaultOptions, infos) => {
  return internalUpdateBodyOptionsAndInfos('', defaultOptions, infos);
};
const updateCommentOptions = (commentBody, defaultOptions, optionsToUpdate) => {
  const options = parseOptions(commentBody, defaultOptions);
  const updatedOptions = updateOptions(options, optionsToUpdate);
  return {
    options: updatedOptions,
    commentBody: internalUpdateBodyOptionsAndInfos(commentBody, updatedOptions)
  };
};
const updateCommentBodyInfos = (commentBody, infos) => {
  return commentBody.replace( // *  - zero or more
  // *? - zero or more (non-greedy)
  // eslint-disable-next-line unicorn/no-unsafe-regex
  /^\s*(?:(#### Infos:.*?)?(#### Commits Notes:.*?)?(#### Options:.*?)?)?$/s, `${getReplacement(infos)}$3`);
};
const updateCommentBodyCommitsNotes = (commentBody, commitNotes) => {
  return commentBody.replace( // eslint-disable-next-line unicorn/no-unsafe-regex
  /(?:#### Commits Notes:.*?)?(#### Options:)/s, // eslint-disable-next-line no-nested-ternary
  !commitNotes ? '$1' : `#### Commits Notes:\n\n${commitNotes}\n\n$1`);
};
const removeDeprecatedReviewflowInPrBody = prBody => {
  return prBody.replace( // eslint-disable-next-line unicorn/no-unsafe-regex
  /^(.*)<!---? do not edit after this -?-->(.*)<!---? end - don't add anything after this -?-->(.*)$/is, // eslint-disable-next-line no-nested-ternary
  '$1$3');
};

const createReviewflowComment = (context, pr, body) => {
  return context.github.issues.createComment(context.repo({
    issue_number: pr.number,
    body
  })).then(({
    data
  }) => data);
};
const getReviewflowCommentById = (context, pr, commentId) => {
  return context.github.issues.getComment(context.repo({
    issue_number: pr.number,
    comment_id: commentId
  })).then(({
    data
  }) => data, () => null);
};

const getReviewflowPr = async (appContext, repoContext, context, pr, reviewflowCommentPromise) => {
  const prEmbed = {
    number: pr.number
  };

  if (reviewflowCommentPromise) {
    const comment = await reviewflowCommentPromise;
    const reviewflowPr = await appContext.mongoStores.prs.insertOne({
      account: repoContext.accountEmbed,
      repo: repoContext.repoEmbed,
      pr: prEmbed,
      commentId: comment.id
    });
    return {
      reviewflowPr,
      commentBody: comment.body
    };
  }

  const existing = await appContext.mongoStores.prs.findOne({
    'account.id': repoContext.accountEmbed.id,
    'repo.id': repoContext.repoEmbed.id,
    'pr.number': pr.number
  });
  const comment = existing && (await getReviewflowCommentById(context, pr, existing.commentId));

  if (!comment || !existing) {
    const comment = await createReviewflowComment(context, pr, defaultCommentBody);

    if (!existing) {
      const reviewflowPr = await appContext.mongoStores.prs.insertOne({
        account: repoContext.accountEmbed,
        repo: repoContext.repoEmbed,
        pr: prEmbed,
        commentId: comment.id
      });
      return {
        reviewflowPr,
        commentBody: comment.body
      };
    } else {
      await appContext.mongoStores.prs.partialUpdateByKey(existing._id, {
        $set: {
          commentId: comment.id
        }
      });
    }
  }

  return {
    reviewflowPr: existing,
    commentBody: comment.body
  };
};

const createPullRequestContextFromWebhook = async (appContext, repoContext, context, pr, options) => {
  if (repoContext.shouldIgnore) {
    return {
      appContext,
      repoContext,
      pr,
      reviewflowPr: null,
      // TODO fix typings to allow null
      commentBody: '',
      updatedPr: null
    };
  }

  const {
    reviewflowPr,
    commentBody
  } = await getReviewflowPr(appContext, repoContext, context, pr, options.reviewflowCommentPromise);
  return {
    appContext,
    repoContext,
    pr,
    reviewflowPr,
    commentBody,
    updatedPr: null
  };
};
const createPullRequestContextFromPullResponse = async (appContext, repoContext, context, pr, options) => {
  console.log('createPullRequestContextFromPullResponse', pr.number);
  const {
    reviewflowPr,
    commentBody
  } = await getReviewflowPr(appContext, repoContext, context, pr, options.reviewflowCommentPromise);
  return {
    appContext,
    repoContext,
    pr,
    reviewflowPr,
    commentBody,
    updatedPr: pr
  };
};
const fetchPullRequestAndCreateContext = async (context, prContext) => {
  const updatedPr = await fetchPr(context, prContext.pr.number);
  return { ...prContext,
    updatedPr
  };
};

function hasLabelInPR(prLabels, label) {
  if (!label) return false;
  return prLabels.some(l => l.id === label.id);
}

const hasFailedStatusOrChecks = async (pr, context) => {
  const checks = await context.github.checks.listForRef(context.repo({
    ref: pr.head.sha,
    per_page: 100
  }));
  const failedChecks = checks.data.check_runs.filter(check => check.conclusion === 'failure');

  if (failedChecks.length !== 0) {
    context.log.info(`automerge not possible: failed check pr ${pr.id}`, {
      checks: failedChecks.map(check => check.name)
    });
    return true;
  }

  const combinedStatus = await context.github.repos.getCombinedStatusForRef(context.repo({
    ref: pr.head.sha,
    per_page: 100
  }));

  if (combinedStatus.data.state === 'failure') {
    const failedStatuses = combinedStatus.data.statuses.filter(status => status.state === 'failure' || status.state === 'error');
    context.log.info(`automerge not possible: failed status pr ${pr.id}`, {
      statuses: failedStatuses.map(status => status.context)
    });
    return true;
  }

  return false;
};

const autoMergeIfPossibleOptionalPrContext = async (appContext, repoContext, pr, context, prContext, prLabels = pr.labels) => {
  const autoMergeLabel = repoContext.labels['merge/automerge'];

  if (!hasLabelInPR(prLabels, autoMergeLabel)) {
    repoContext.removePrFromAutomergeQueue(context, pr.number, 'no automerge label');
    return false;
  }

  const isRenovatePr = pr.head.ref.startsWith('renovate/');

  const createMergeLockPrFromPr = () => ({
    id: pr.id,
    number: pr.number,
    branch: pr.head.ref
  });

  if (pr.state !== 'open') {
    repoContext.removePrFromAutomergeQueue(context, pr.number, 'pr is not opened');
  }

  const addLog = (type, action) => {
    const repoFullName = pr.head.repo.full_name;
    context.log.info(`automerge: ${repoFullName}#${pr.id} ${type}`);
    appContext.mongoStores.automergeLogs.insertOne({
      account: repoContext.accountEmbed,
      repoFullName,
      pr: {
        id: pr.id,
        number: pr.number,
        isRenovate: isRenovatePr,
        mergeableState: pr.mergeable_state
      },
      type,
      action
    });
  };

  if (repoContext.hasNeedsReview(prLabels) || repoContext.hasRequestedReview(prLabels)) {
    repoContext.removePrFromAutomergeQueue(context, pr.number, 'blocking labels');
    return false;
  }

  if (pr.requested_reviewers.length !== 0) {
    repoContext.removePrFromAutomergeQueue(context, pr.number, 'still has requested reviewers');
    return false;
  }

  const lockedPr = repoContext.getMergeLockedPr();

  if (lockedPr && String(lockedPr.number) !== String(pr.number)) {
    context.log.info('automerge not possible: locked pr', {
      prId: pr.id,
      prNumber: pr.number
    });
    repoContext.pushAutomergeQueue(createMergeLockPrFromPr());
    return false;
  }

  repoContext.addMergeLockPr(createMergeLockPrFromPr());

  if (pr.mergeable == null) {
    const prResult = await context.github.pulls.get(context.repo({
      pull_number: pr.number
    }));
    pr = prResult.data;
  }

  if (pr.merged) {
    addLog('already merged', 'remove');
    repoContext.removePrFromAutomergeQueue(context, pr.number, 'pr already merged');
    return false;
  }

  context.log.info(`automerge?: ${pr.id}, #${pr.number}, mergeable=${pr.mergeable} state=${pr.mergeable_state}`); // https://github.com/octokit/octokit.net/issues/1763

  if (!(pr.mergeable_state === 'clean' || pr.mergeable_state === 'has_hooks' || pr.mergeable_state === 'unstable')) {
    if (!pr.mergeable_state || pr.mergeable_state === 'unknown') {
      addLog('unknown mergeable_state', 'reschedule'); // GitHub is determining whether the pull request is mergeable

      repoContext.reschedule(context, createMergeLockPrFromPr());
      return false;
    }

    if (isRenovatePr) {
      if (pr.mergeable_state === 'behind' || pr.mergeable_state === 'dirty') {
        addLog('rebase-renovate', 'wait'); // TODO check if has commits not made by renovate https://github.com/ornikar/shared-configs/pull/47#issuecomment-445767120

        if (pr.body.includes('<!-- rebase-check -->')) {
          if (pr.body.includes('[x] <!-- rebase-check -->')) {
            return false;
          }

          const renovateRebaseBody = pr.body.replace('[ ] <!-- rebase-check -->', '[x] <!-- rebase-check -->');
          await context.github.issues.update(context.repo({
            issue_number: pr.number,
            body: renovateRebaseBody
          }));
        } else if (!pr.title.startsWith('rebase!')) {
          await context.github.issues.update(context.repo({
            issue_number: pr.number,
            title: `rebase!${pr.title}`
          }));
        }

        return false;
      }

      if (await hasFailedStatusOrChecks(pr, context)) {
        addLog('failed status or checks', 'remove');
        repoContext.removePrFromAutomergeQueue(context, pr.number, 'failed status or checks');
        return false;
      } else if (pr.mergeable_state === 'blocked') {
        addLog('blocked mergeable_state', 'wait'); // waiting for reschedule in status (pr-handler/status.ts)

        return false;
      }

      context.log.info(`automerge not possible: renovate with mergeable_state=${pr.mergeable_state}`);
      return false;
    }

    if (pr.mergeable_state === 'blocked') {
      if (await hasFailedStatusOrChecks(pr, context)) {
        addLog('failed status or checks', 'remove');
        repoContext.removePrFromAutomergeQueue(context, pr.number, 'failed status or checks');
        return false;
      } else {
        addLog('blocked mergeable_state', 'wait'); // waiting for reschedule in status (pr-handler/status.ts)

        return false;
      }
    }

    if (pr.mergeable_state === 'behind') {
      addLog('behind mergeable_state', 'update branch');
      context.log.info('automerge not possible: update branch', {
        head: pr.head.ref,
        base: pr.base.ref
      });
      await context.github.repos.merge({
        owner: pr.head.repo.owner.login,
        repo: pr.head.repo.name,
        head: pr.base.ref,
        base: pr.head.ref
      });
      return false;
    }

    addLog('not mergeable', 'remove');
    repoContext.removePrFromAutomergeQueue(context, pr.number, `mergeable_state=${pr.mergeable_state}`);
    context.log.info(`automerge not possible: not mergeable mergeable_state=${pr.mergeable_state}`);
    return false;
  }

  try {
    context.log.info(`automerge pr #${pr.number}`);
    if (!prContext) prContext = await createPullRequestContextFromPullResponse(appContext, repoContext, context, pr, {});
    const parsedBody = parseBody(prContext.commentBody, repoContext.config.prDefaultOptions);
    const options = (parsedBody === null || parsedBody === void 0 ? void 0 : parsedBody.options) || repoContext.config.prDefaultOptions;
    const mergeResult = await context.github.pulls.merge({
      merge_method: options.featureBranch ? 'merge' : 'squash',
      owner: pr.head.repo.owner.login,
      repo: pr.head.repo.name,
      pull_number: pr.number,
      commit_title: options.featureBranch ? undefined : `${pr.title}${options.autoMergeWithSkipCi ? ' [skip ci]' : ''} (#${pr.number})`,
      commit_message: options.featureBranch ? undefined : '' // TODO add BC

    });
    context.log.debug('merge result:', mergeResult.data);
    repoContext.removePrFromAutomergeQueue(context, pr.number, 'merged');
    return Boolean(mergeResult.data.merged);
  } catch (err) {
    context.log.info('could not merge:', err.message);
    repoContext.reschedule(context, createMergeLockPrFromPr());
    return false;
  }
};
const autoMergeIfPossible = async (prContext, context, prLabels) => {
  const pr = prContext.updatedPr || prContext.pr;
  return autoMergeIfPossibleOptionalPrContext(prContext.appContext, prContext.repoContext, pr, context, prContext, prLabels);
};

const ExcludesFalsy = Boolean;
const ExcludesNullish = res => res !== null;

const getLabelsForRepo = async context => {
  const {
    data: labels
  } = await context.github.issues.listLabelsForRepo(context.repo({
    per_page: 100
  }));
  return labels;
};
const initRepoLabels = async (context, config) => {
  const labels = await getLabelsForRepo(context);
  const finalLabels = {};

  for (const [labelKey, labelConfig] of Object.entries(config.labels.list)) {
    const labelColor = labelConfig.color.slice(1);
    const description = labelConfig.description ? `${labelConfig.description} - Synced by reviewflow` : `Synced by reviewflow for ${labelKey}`;
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

      if (labelKey === 'teams/ops') {
        existingLabel = labels.find(label => label.name === 'archi');
      }
    }

    if (!existingLabel) {
      const result = await context.github.issues.createLabel(context.repo({
        name: labelConfig.name,
        color: labelColor,
        description
      }));
      finalLabels[labelKey] = result.data;
    } else if (existingLabel.name !== labelConfig.name || existingLabel.color !== labelColor || existingLabel.description !== description) {
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
const contextIssue = (context, object) => {
  const payload = context.payload;
  return context.repo({ ...object,
    issue_number: (payload.issue || payload.pull_request || payload).number
  });
};
const contextPr = (context, object) => {
  const payload = context.payload;
  return context.repo({ ...object,
    pull_number: (payload.issue || payload.pull_request || payload).number
  });
};
const emojiRegex = createEmojiRegex();
const getEmojiFromRepoDescription = description => {
  if (!description) return '';

  if (description.startsWith(':')) {
    const [, emoji] = /^(:\w+:)/.exec(description) || [];
    return emoji || '';
  }

  const match = emojiRegex.exec(description);
  if (match && description.startsWith(match[0])) return match[0];
  return '';
};

const voidTeamSlack = () => ({
  mention: () => '',
  postMessage: () => Promise.resolve(null),
  updateMessage: () => Promise.resolve(null),
  deleteMessage: () => Promise.resolve(undefined),
  addReaction: () => Promise.resolve(undefined),
  updateHome: () => undefined
});

const initTeamSlack = async ({
  mongoStores,
  slackHome
}, context, config, account) => {
  const owner = context.payload.repository.owner;
  const slackToken = 'slackToken' in account && account.slackToken;

  if (!slackToken) {
    return voidTeamSlack();
  }

  const githubLoginToSlackEmail = getKeys(config.groups).reduce((acc, groupName) => {
    Object.assign(acc, config.groups[groupName]);
    return acc;
  }, {});
  const slackEmails = Object.values(githubLoginToSlackEmail);
  const slackClient = new webApi.WebClient(slackToken);
  const membersInDb = await mongoStores.orgMembers.findAll({
    'org.id': account._id
  });
  const members = [];
  const foundEmailMembers = [];
  Object.entries(githubLoginToSlackEmail).forEach(([login, email]) => {
    var _member$slack;

    const member = membersInDb.find(m => m.user.login === login);

    if (member === null || member === void 0 ? void 0 : (_member$slack = member.slack) === null || _member$slack === void 0 ? void 0 : _member$slack.id) {
      foundEmailMembers.push(email);
      members.push([email, {
        member: {
          id: member.slack.id
        },
        im: undefined
      }]);
    }
  });

  if (foundEmailMembers.length !== slackEmails.length) {
    const missingEmails = slackEmails.filter(email => !foundEmailMembers.includes(email));
    const memberEmailToMemberId = new Map(Object.entries(githubLoginToSlackEmail).map(([login, email]) => {
      var _membersInDb$find;

      return [email, (_membersInDb$find = membersInDb.find(m => m.user.login === login)) === null || _membersInDb$find === void 0 ? void 0 : _membersInDb$find._id];
    }));
    await slackClient.paginate('users.list', {}, page => {
      page.members.forEach(member => {
        const email = member.profile && member.profile.email;

        if (email && missingEmails.includes(email)) {
          members.push([email, {
            member,
            im: undefined
          }]);

          if (memberEmailToMemberId.has(email)) {
            mongoStores.orgMembers.partialUpdateMany({
              _id: memberEmailToMemberId.get(email)
            }, {
              $set: {
                slack: {
                  id: member.id
                }
              }
            });
          }
        }
      });
      return false;
    });
  }

  for (const [, user] of members) {
    try {
      const im = await slackClient.conversations.open({
        users: user.member.id
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
    postMessage: async (category, githubId, githubLogin, message) => {
      context.log.debug('slack: post message', {
        category,
        githubLogin,
        message
      });
      if (process.env.DRY_RUN && process.env.DRY_RUN !== 'false') return null;
      const userDmSettings = await getUserDmSettings(mongoStores, owner.login, owner.id, githubId);
      if (!userDmSettings[category]) return null;
      const user = getUserFromGithubLogin(githubLogin);
      if (!user || !user.im) return null;
      const result = await slackClient.chat.postMessage({
        username: process.env.REVIEWFLOW_NAME,
        channel: user.im.id,
        text: message.text,
        blocks: message.blocks,
        attachments: message.secondaryBlocks ? [{
          blocks: message.secondaryBlocks
        }] : undefined,
        thread_ts: message.ts
      });
      if (!result.ok) return null;
      return {
        ts: result.ts,
        channel: result.channel
      };
    },
    updateMessage: async (ts, channel, message) => {
      context.log.debug('slack: update message', {
        ts,
        channel,
        message
      });
      if (process.env.DRY_RUN && process.env.DRY_RUN !== 'false') return null;
      const result = await slackClient.chat.update({
        ts,
        channel,
        text: message.text,
        blocks: message.blocks,
        attachments: message.secondaryBlocks ? [{
          blocks: message.secondaryBlocks
        }] : undefined
      });
      if (!result.ok) return null;
      return {
        ts: result.ts,
        channel: result.channel
      };
    },
    deleteMessage: async (ts, channel) => {
      context.log.debug('slack: delete message', {
        ts,
        channel
      });
      await slackClient.chat.delete({
        ts,
        channel
      });
    },
    addReaction: async (ts, channel, name) => {
      context.log.debug('slack: add reaction', {
        ts,
        channel,
        name
      });
      await slackClient.reactions.add({
        timestamp: ts,
        channel,
        name
      });
    },
    updateHome: githubLogin => {
      context.log.debug('update slack home', {
        githubLogin
      });
      const user = getUserFromGithubLogin(githubLogin);
      if (!user || !user.member) return;
      slackHome.scheduleUpdateMember(context.github, slackClient, {
        user: {
          id: null,
          login: githubLogin
        },
        org: {
          id: account._id,
          login: account.login
        },
        slack: {
          id: user.member.id
        }
      });
    }
  };
};

const getOrCreateAccount = async ({
  mongoStores
}, github, installationId, accountInfo) => {
  var _org, _user;

  switch (accountInfo.type) {
    case 'Organization':
      {
        let org = await mongoStores.orgs.findByKey(accountInfo.id);
        if ((_org = org) === null || _org === void 0 ? void 0 : _org.installationId) return org; // TODO diff org vs user...

        org = await syncOrg(mongoStores, github, installationId, accountInfo);
        await syncTeams(mongoStores, github, accountInfo);
        return org;
      }

    case 'User':
      {
        let user = await mongoStores.users.findByKey(accountInfo.id);
        if ((_user = user) === null || _user === void 0 ? void 0 : _user.installationId) return user;
        user = await syncUser(mongoStores, github, installationId, accountInfo);
        return user;
      }

    default:
      throw new Error(`Account type not supported ${accountInfo.type}`);
  }
};

const initAccountContext = async (appContext, context, config, accountInfo) => {
  const account = await getOrCreateAccount(appContext, context.github, context.payload.installation.id, accountInfo);
  const slackPromise = initTeamSlack(appContext, context, config, account);
  const githubLoginToGroup = new Map();
  getKeys(config.groups).forEach(groupName => {
    Object.keys(config.groups[groupName]).forEach(login => {
      githubLoginToGroup.set(login, groupName);
    });
  });
  const githubLoginToTeams = new Map();
  getKeys(config.teams || {}).forEach(teamName => {
    config.teams[teamName].logins.forEach(login => {
      const teams = githubLoginToTeams.get(login);

      if (teams) {
        teams.push(teamName);
      } else {
        githubLoginToTeams.set(login, [teamName]);
      }
    });
  });

  const getReviewerGroups = githubLogins => [...new Set(githubLogins.map(githubLogin => githubLoginToGroup.get(githubLogin)).filter(ExcludesFalsy))];

  const lock$1 = lock.Lock();
  return {
    config,
    account,
    accountEmbed: {
      id: accountInfo.id,
      login: accountInfo.login,
      type: accountInfo.type
    },
    accountType: accountInfo.type,
    lock: callback => {
      return new Promise((resolve, reject) => {
        const logInfos = {
          account: accountInfo.login
        };
        context.log.info('lock: try to lock account', logInfos); // eslint-disable-next-line @typescript-eslint/no-misused-promises

        lock$1('_', async createReleaseCallback => {
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
    getReviewerGroup: githubLogin => githubLoginToGroup.get(githubLogin),
    getReviewerGroups,
    getTeamsForLogin: githubLogin => githubLoginToTeams.get(githubLogin) || [],
    approveShouldWait: (reviewerGroup, requestedReviewers, {
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

const accountContextsPromise = new Map();
const accountContexts = new Map();
const obtainAccountContext = (appContext, context, config, accountInfo) => {
  const existingAccountContext = accountContexts.get(accountInfo.login);
  if (existingAccountContext) return existingAccountContext;
  const existingPromise = accountContextsPromise.get(accountInfo.login);
  if (existingPromise) return Promise.resolve(existingPromise);
  const promise = initAccountContext(appContext, context, config, accountInfo);
  accountContextsPromise.set(accountInfo.login, promise);
  return promise.then(accountContext => {
    accountContextsPromise.delete(accountInfo.login);
    accountContexts.set(accountInfo.login, accountContext);
    return accountContext;
  });
};

const shouldIgnoreRepo = (repoName, accountConfig) => {
  const ignoreRepoRegexp = accountConfig.ignoreRepoPattern && new RegExp(`^${accountConfig.ignoreRepoPattern}$`);

  if (repoName === 'reviewflow-test') {
    return process.env.REVIEWFLOW_NAME !== 'reviewflow-dev';
  }

  if (ignoreRepoRegexp) {
    return ignoreRepoRegexp.test(repoName);
  }

  return false;
};

const createGetReviewLabelIds = (shouldIgnore, config, reviewGroupNames, labels) => {
  if (shouldIgnore) return () => [];
  return labelKey => reviewGroupNames.map(key => config.labels.review[key][labelKey]).filter(Boolean).map(name => labels[name].id);
};

async function initRepoContext(appContext, context, config) {
  const {
    id,
    name,
    full_name: fullName,
    owner: org,
    description
  } = context.payload.repository;
  const repoEmoji = getEmojiFromRepoDescription(description);
  const accountContext = await obtainAccountContext(appContext, context, config, org);
  const repoContext = Object.create(accountContext);
  const shouldIgnore = shouldIgnoreRepo(name, config);
  const labels = shouldIgnore ? {} : await initRepoLabels(context, config);
  const reviewGroupNames = Object.keys(config.groups);
  const getReviewLabelIds = createGetReviewLabelIds(shouldIgnore, config, reviewGroupNames, labels);
  const needsReviewLabelIds = getReviewLabelIds('needsReview');
  const requestedReviewLabelIds = getReviewLabelIds('requested');
  const changesRequestedLabelIds = getReviewLabelIds('changesRequested');
  const approvedReviewLabelIds = getReviewLabelIds('approved');
  const protectedLabelIds = [...requestedReviewLabelIds, ...changesRequestedLabelIds, ...approvedReviewLabelIds];
  const labelIdToGroupName = new Map();

  if (!shouldIgnore) {
    reviewGroupNames.forEach(key => {
      const reviewGroupLabels = config.labels.review[key];
      Object.keys(reviewGroupLabels).forEach(labelKey => {
        labelIdToGroupName.set(labels[reviewGroupLabels[labelKey]].id, key);
      });
    });
  } // const updateStatusCheck = (context, reviewGroup, statusInfo) => {};


  const lock$1 = lock.Lock();
  let lockMergePr;
  let automergeQueue = [];

  const lockPR = (prOPrIssueId, prNumber, callback) => new Promise((resolve, reject) => {
    const logInfos = {
      repo: fullName,
      prOPrIssueId,
      prNumber
    };
    context.log.debug('lock: try to lock pr', logInfos); // eslint-disable-next-line @typescript-eslint/no-misused-promises

    lock$1(String(prNumber), async createReleaseCallback => {
      const release = createReleaseCallback(() => {});
      context.log.info('lock: lock pr acquired', logInfos);

      try {
        await callback();
      } catch (err) {
        context.log.info('lock: release pr (with error)', logInfos);
        release();
        reject(err);
        return;
      }

      context.log.info('lock: release pr', logInfos);
      release();
      resolve();
    });
  });

  const reschedule = (context, pr) => {
    if (!pr) throw new Error('Cannot reschedule undefined');
    context.log.info('reschedule', pr);
    setTimeout(() => {
      lockPR('reschedule', -1, () => {
        return lockPR(String(pr.id), pr.number, async () => {
          const updatedPr = await fetchPr(context, pr.number);
          await autoMergeIfPossibleOptionalPrContext(appContext, repoContext, updatedPr, context);
        });
      });
    }, 10000);
  };

  return Object.assign(repoContext, {
    labels,
    repoFullName: fullName,
    repoEmbed: {
      id,
      name
    },
    repoEmoji,
    protectedLabelIds,
    shouldIgnore,
    hasNeedsReview: labels => labels.some(label => needsReviewLabelIds.includes(label.id)),
    hasRequestedReview: labels => labels.some(label => requestedReviewLabelIds.includes(label.id)),
    hasChangesRequestedReview: labels => labels.some(label => changesRequestedLabelIds.includes(label.id)),
    hasApprovesReview: labels => labels.some(label => approvedReviewLabelIds.includes(label.id)),
    getNeedsReviewGroupNames: labels => labels.filter(label => needsReviewLabelIds.includes(label.id)).map(label => labelIdToGroupName.get(label.id)).filter(ExcludesFalsy),
    getMergeLockedPr: () => lockMergePr,
    addMergeLockPr: pr => {
      console.log('merge lock: lock', {
        repo: fullName,
        pr
      });

      if (lockMergePr && String(lockMergePr.number) === String(pr.number)) {
        return;
      }

      if (lockMergePr) throw new Error('Already have lock');
      lockMergePr = pr;
    },
    removePrFromAutomergeQueue: (context, prNumber, reason) => {
      if (lockMergePr && String(lockMergePr.number) === String(prNumber)) {
        lockMergePr = automergeQueue.shift();
        context.log(`merge lock: remove ${fullName}#${prNumber}: ${reason}`);
        context.log(`merge lock: next ${fullName}`, lockMergePr);

        if (lockMergePr) {
          reschedule(context, lockMergePr);
        }
      } else {
        const previousLength = automergeQueue.length;
        automergeQueue = automergeQueue.filter(value => String(value.number) !== String(prNumber));

        if (automergeQueue.length !== previousLength) {
          context.log(`merge lock: remove ${fullName}#${prNumber}: ${reason}`);
        }
      }
    },
    pushAutomergeQueue: pr => {
      context.log('merge lock: push queue', {
        repo: fullName,
        pr,
        lockMergePr,
        automergeQueue
      });

      if (!automergeQueue.some(p => p.number === pr.number)) {
        automergeQueue.push(pr);
      }
    },
    reschedule,
    lockPR
  });
}

const repoContextsPromise = new Map();
const repoContexts = new Map();
const obtainRepoContext = (appContext, context) => {
  const repo = context.payload.repository;
  const owner = repo.owner;
  const key = repo.id;
  const existingRepoContext = repoContexts.get(key);
  if (existingRepoContext) return existingRepoContext;
  const existingPromise = repoContextsPromise.get(key);
  if (existingPromise) return Promise.resolve(existingPromise);
  let accountConfig = accountConfigs[owner.login];

  if (!accountConfig) {
    console.warn(`using default config for ${owner.login}`);
    accountConfig = config;
  }

  const promise = initRepoContext(appContext, context, accountConfig);
  repoContextsPromise.set(key, promise);
  return promise.then(repoContext => {
    repoContextsPromise.delete(key);
    repoContexts.set(key, repoContext);
    return repoContext;
  });
};

const createRepoHandler = (appContext, callback) => {
  return async context => {
    const repoContext = await obtainRepoContext(appContext, context);
    if (!repoContext) return;
    return callback(context, repoContext);
  };
};

const createPullRequestHandler = (appContext, getPullRequestInPayload, callbackPr, callbackBeforeLock) => {
  return createRepoHandler(appContext, async (context, repoContext) => {
    const pullRequest = getPullRequestInPayload(context.payload, context, repoContext);
    if (pullRequest === null) return;
    const options = callbackBeforeLock ? callbackBeforeLock(pullRequest, context, repoContext) : {};
    await repoContext.lockPR(String(pullRequest.id), pullRequest.number, async () => {
      const prContext = await createPullRequestContextFromWebhook(appContext, repoContext, context, pullRequest, options);
      return callbackPr(prContext, context, repoContext);
    });
  });
};
const createPullRequestsHandler = (appContext, getPrs, callbackPr) => {
  return createRepoHandler(appContext, async (context, repoContext) => {
    const prs = getPrs(context.payload, repoContext);
    if (prs.length === 0) return;
    await Promise.all(prs.map(pr => repoContext.lockPR(String(pr.id), pr.number, async () => {
      return callbackPr(pr, context, repoContext);
    })));
  });
};

const autoAssignPRToCreator = async (prContext, context) => {
  const {
    pr,
    repoContext
  } = prContext;
  if (!repoContext.config.autoAssignToCreator) return;
  if (pr.assignees.length !== 0) return;
  if (pr.user.type === 'Bot') return;
  await context.github.issues.addAssignees(contextIssue(context, {
    assignees: [pr.user.login]
  }));
};

const cleanTitle = title => title.trim().replace(/[\s-]+\[?\s*([A-Za-z][\dA-Za-z]+)[ -](\d+)\s*]?\s*$/, (s, arg1, arg2) => ` ${arg1.toUpperCase()}-${arg2}`).replace(/^([A-Za-z]+)[/:]\s*/, (s, arg1) => `${arg1.toLowerCase()}: `).replace(/^Revert "([^"]+)"$/, 'revert: $1').replace(/\s+[[\]]\s*no\s*issue\s*[[\]]$/i, ' [no issue]') // eslint-disable-next-line unicorn/no-unsafe-regex
.replace(/^(revert:.*)(\s+\(#\d+\))$/, '$1');

const cleanNewLines = text => text.replace(/\r\n/g, '\n');

const checkIfHasDiff = (text1, text2) => cleanNewLines(text1) !== cleanNewLines(text2);

const updatePrIfNeeded = async (prContext, context, update) => {
  const hasDiffInTitle = update.title && prContext.pr.title !== update.title;
  const hasDiffInBody = update.body && checkIfHasDiff(prContext.pr.body, update.body);
  const promises = [];

  if (hasDiffInTitle || hasDiffInBody) {
    const diff = {};

    if (hasDiffInTitle) {
      diff.title = update.title;
      prContext.pr.title = update.title;
    }

    if (hasDiffInBody) {
      console.log({
        diff,
        originalTitle: prContext.pr.title,
        originalBody: cleanNewLines(prContext.pr.body),
        updatedBody: update.body && cleanNewLines(update.body),
        hasBodyDiff: hasDiffInBody
      });
      diff.body = update.body;
      prContext.pr.body = update.body;
    }

    promises.push(context.github.pulls.update(context.repo({
      pull_number: prContext.pr.number,
      ...diff
    })));
  }

  if (update.commentBody && checkIfHasDiff(prContext.commentBody, update.commentBody)) {
    if (update.commentBody.includes('Explain here why this PR')) {
      throw new Error('Not valid comment body');
    }

    promises.push(context.github.issues.updateComment(context.repo({
      comment_id: prContext.reviewflowPr.commentId,
      body: update.commentBody
    })));
  }

  await Promise.all(promises);
};

async function createStatus(context, name, sha, type, description, url) {
  await context.github.repos.createStatus(context.repo({
    context: name === '' ? process.env.REVIEWFLOW_NAME : `${process.env.REVIEWFLOW_NAME}/${name}`,
    sha,
    state: type,
    description,
    target_url: url
  }));
}

async function syncLabel(pr, context, shouldHaveLabel, label, prHasLabel = hasLabelInPR(pr.labels, label), {
  onRemove,
  onAdd
} = {}) {
  if (prHasLabel && !shouldHaveLabel) {
    await context.github.issues.removeLabel(contextIssue(context, {
      name: label.name
    }));
    if (onRemove) await onRemove();
  }

  if (shouldHaveLabel && !prHasLabel) {
    const response = await context.github.issues.addLabels(contextIssue(context, {
      labels: [label.name]
    }));
    if (onAdd) await onAdd(response.data);
  }
}

const calcDefaultOptions = (repoContext, pr) => {
  const featureBranchLabel = repoContext.labels['feature-branch'];
  const automergeLabel = repoContext.labels['merge/automerge'];
  const skipCiLabel = repoContext.labels['merge/skip-ci'];
  const prHasFeatureBranchLabel = hasLabelInPR(pr.labels, featureBranchLabel);
  const prHasSkipCiLabel = hasLabelInPR(pr.labels, skipCiLabel);
  const prHasAutoMergeLabel = hasLabelInPR(pr.labels, automergeLabel);
  return { ...repoContext.config.prDefaultOptions,
    featureBranch: prHasFeatureBranchLabel,
    autoMergeWithSkipCi: prHasSkipCiLabel,
    autoMerge: prHasAutoMergeLabel
  };
};
const syncLabelsAfterCommentBodyEdited = async (appContext, repoContext, pr, context, prContext) => {
  const featureBranchLabel = repoContext.labels['feature-branch'];
  const automergeLabel = repoContext.labels['merge/automerge'];
  const skipCiLabel = repoContext.labels['merge/skip-ci'];
  const prHasFeatureBranchLabel = hasLabelInPR(pr.labels, featureBranchLabel);
  const prHasSkipCiLabel = hasLabelInPR(pr.labels, skipCiLabel);
  const prHasAutoMergeLabel = hasLabelInPR(pr.labels, automergeLabel);
  const {
    commentBody,
    options
  } = updateCommentOptions(prContext.commentBody, calcDefaultOptions(repoContext, pr));
  await updatePrIfNeeded(prContext, context, {
    commentBody
  });

  if (options && (featureBranchLabel || automergeLabel)) {
    await Promise.all([featureBranchLabel && syncLabel(pr, context, options.featureBranch, featureBranchLabel, prHasFeatureBranchLabel), skipCiLabel && syncLabel(pr, context, options.autoMergeWithSkipCi, skipCiLabel, prHasSkipCiLabel), automergeLabel && syncLabel(pr, context, options.autoMerge, automergeLabel, prHasAutoMergeLabel, {
      onAdd: async prLabels => {
        await autoMergeIfPossible(prContext, context, prLabels);
      },
      onRemove: () => {
        repoContext.removePrFromAutomergeQueue(context, pr.number, 'label removed');
      }
    })]);
  }
};

const readCommitsAndUpdateInfos = async (prContext, context, commentBody = prContext.commentBody) => {
  const pr = prContext.updatedPr || prContext.pr;
  const {
    repoContext
  } = prContext; // tmp.data[0].sha
  // tmp.data[0].commit.message

  const commits = await context.github.paginate(context.github.pulls.listCommits.endpoint.merge(contextPr(context, {
    // A custom page size up to 100. Default is 30.
    per_page: 100
  })), res => res.data);
  const conventionalCommits = await Promise.all(commits.map(c => parse$1(c.commit.message)));
  const breakingChangesCommits = conventionalCommits.reduce((acc, c, index) => {
    const breakingChangesNotes = c.notes.filter(note => note.title === 'BREAKING CHANGE');

    if (breakingChangesNotes.length !== 0) {
      acc.push({
        commit: commits[index],
        breakingChangesNotes
      });
    }

    return acc;
  }, []);
  const breakingChangesLabel = repoContext.labels['breaking-changes'];
  const newCommentBody = updateCommentBodyCommitsNotes(commentBody, breakingChangesCommits.length === 0 ? '' : `Breaking Changes:\n${breakingChangesCommits.map(({
    commit,
    breakingChangesNotes
  }) => breakingChangesNotes.map(note => `- ${note.text.replace('\n', ' ')} (${commit.sha})`)).join('')}`);
  await Promise.all([syncLabel(pr, context, breakingChangesCommits.length !== 0, breakingChangesLabel), updatePrIfNeeded(prContext, context, {
    commentBody: newCommentBody
  })]); // TODO auto update ! in front of : to signal a breaking change when https://github.com/conventional-changelog/commitlint/issues/658 is closed
};

const editOpenedPR = async (prContext, context, shouldUpdateCommentBodyInfos, previousSha) => {
  const {
    repoContext
  } = prContext;
  const pr = prContext.updatedPr || prContext.pr;
  const title = repoContext.config.trimTitle ? cleanTitle(pr.title) : pr.title;
  const isPrFromBot = pr.user.type === 'Bot';
  const statuses = [];
  const errorRule = repoContext.config.parsePR.title.find(rule => {
    if (rule.bot === false && isPrFromBot) return false;
    const match = rule.regExp.exec(title);

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
  const date = new Date().toISOString();
  const hasLintPrCheck = (await context.github.checks.listForRef(context.repo({
    ref: pr.head.sha
  }))).data.check_runs.find(check => check.name === `${process.env.REVIEWFLOW_NAME}/lint-pr`);
  const promises = Promise.all([...statuses.map(({
    name,
    error,
    info
  }) => createStatus(context, name, pr.head.sha, error ? 'failure' : 'success', error ? error.title : info.title, error ? undefined : info.url)), ...(previousSha ? statuses.map(({
    name,
    error,
    info
  }) => error ? createStatus(context, name, previousSha, 'success', 'New commits have been pushed') : undefined).filter(ExcludesFalsy) : []), hasLintPrCheck && context.github.checks.create(context.repo({
    name: `${process.env.REVIEWFLOW_NAME}/lint-pr`,
    head_sha: pr.head.sha,
    status: 'completed',
    conclusion: errorRule ? 'failure' : 'success',
    started_at: date,
    completed_at: date,
    output: errorRule ? errorRule.error : {
      title: '✓ Your PR is valid',
      summary: ''
    }
  })), !hasLintPrCheck && previousSha && errorRule ? createStatus(context, 'lint-pr', previousSha, 'success', 'New commits have been pushed') : undefined, !hasLintPrCheck && createStatus(context, 'lint-pr', pr.head.sha, errorRule ? 'failure' : 'success', errorRule ? errorRule.error.title : '✓ Your PR is valid')].filter(ExcludesFalsy));
  const commentBodyInfos = statuses.filter(status => status.info && status.info.inBody).map(status => status.info);
  const shouldCreateCommentBody = prContext.commentBody === defaultCommentBody;
  const commentBody = shouldCreateCommentBody ? createCommentBody(calcDefaultOptions(repoContext, pr), commentBodyInfos) : updateCommentBodyInfos(prContext.commentBody, commentBodyInfos);
  const body = removeDeprecatedReviewflowInPrBody(pr.body);

  if (shouldCreateCommentBody || shouldUpdateCommentBodyInfos) {
    await Promise.all([promises, updatePrIfNeeded(prContext, context, {
      title,
      body
    }), readCommitsAndUpdateInfos(prContext, context, commentBody)]);
  } else {
    await Promise.all([promises, updatePrIfNeeded(prContext, context, {
      title,
      body,
      commentBody
    })]);
  }
};

const addStatusCheck = async function (prContext, context, {
  state,
  description
}, previousSha) {
  const pr = prContext.updatedPr || prContext.pr;
  const hasPrCheck = (await context.github.checks.listForRef(context.repo({
    ref: pr.head.sha
  }))).data.check_runs.find(check => check.name === process.env.REVIEWFLOW_NAME);
  context.log.debug('add status check', {
    hasPrCheck,
    state,
    description
  });

  if (hasPrCheck) {
    await context.github.checks.create(context.repo({
      name: process.env.REVIEWFLOW_NAME,
      head_sha: pr.head.sha,
      started_at: pr.created_at,
      status: 'completed',
      conclusion: state,
      completed_at: new Date().toISOString(),
      output: {
        title: description,
        summary: ''
      }
    }));
  } else if (previousSha && state === 'failure') {
    await Promise.all([createStatus(context, '', previousSha, 'success', 'New commits have been pushed'), createStatus(context, '', pr.head.sha, state, description)]);
  } else {
    await createStatus(context, '', pr.head.sha, state, description);
  }
};

const updateStatusCheckFromLabels = (prContext, pr, context, labels = pr.labels || [], previousSha) => {
  const {
    repoContext
  } = prContext;
  context.log.debug('updateStatusCheckFromLabels', {
    labels: labels.map(l => l === null || l === void 0 ? void 0 : l.name),
    hasNeedsReview: repoContext.hasNeedsReview(labels),
    hasApprovesReview: repoContext.hasApprovesReview(labels)
  });

  const createFailedStatusCheck = description => addStatusCheck(prContext, context, {
    state: 'failure',
    description
  }, previousSha);

  if (pr.requested_reviewers.length !== 0) {
    return createFailedStatusCheck( // TODO remove `as`
    // https://github.com/probot/probot/issues/1219
    `Awaiting review from: ${pr.requested_reviewers.map(rr => rr.login).join(', ')}`);
  }

  if (repoContext.hasChangesRequestedReview(labels)) {
    return createFailedStatusCheck('Changes requested ! Push commits or discuss changes then re-request a review.');
  }

  const needsReviewGroupNames = repoContext.getNeedsReviewGroupNames(labels);

  if (needsReviewGroupNames.length !== 0) {
    return createFailedStatusCheck(`Awaiting review from: ${needsReviewGroupNames.join(', ')}. Perhaps request someone ?`);
  }

  if (!repoContext.hasApprovesReview(labels)) {
    if (repoContext.config.requiresReviewRequest) {
      return createFailedStatusCheck('Awaiting review... Perhaps request someone ?');
    }
  } // if (
  //   repoContext.config.requiresReviewRequest &&
  //   !repoContext.hasRequestedReview(labels)
  // ) {
  //   return  createFailedStatusCheck(
  //     context,
  //     pr,
  //     'You need to request someone to review the PR',
  //   );
  //   return;
  // }
  // return  createInProgressStatusCheck(context);
  // } else if (repoContext.hasApprovesReview(labels)) {


  return addStatusCheck(prContext, context, {
    state: 'success',
    description: '✓ PR ready to merge !'
  }, previousSha); // }
};

const updateReviewStatus = async (prContext, context, reviewGroup, {
  add: labelsToAdd,
  remove: labelsToRemove
}) => {
  const {
    repoContext
  } = prContext;
  const pr = prContext.updatedPr || prContext.pr;
  context.log.debug('updateReviewStatus', {
    reviewGroup,
    labelsToAdd,
    labelsToRemove
  });
  let prLabels = pr.labels || [];
  if (!reviewGroup) return prLabels;
  const newLabelNames = new Set(prLabels.map(label => label.name));
  const toAdd = new Set();
  const toAddNames = new Set();
  const toDelete = new Set();
  const toDeleteNames = new Set();
  const labels = repoContext.labels;

  const getLabelFromKey = key => {
    const reviewConfig = repoContext.config.labels.review[reviewGroup];
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

      newLabelNames.add(label.name);
      toAdd.add(key);
      toAddNames.add(label.name);
    });
  }

  if (labelsToRemove) {
    labelsToRemove.forEach(key => {
      if (!key) return;
      const label = getLabelFromKey(key);
      if (!label) return;
      const existing = prLabels.find(prLabel => prLabel.id === label.id);

      if (existing) {
        newLabelNames.delete(existing.name);
        toDelete.add(key);
        toDeleteNames.add(existing.name);
      }
    });
  } // TODO move that elsewhere


  repoContext.getTeamsForLogin(pr.user.login).forEach(teamName => {
    const team = repoContext.config.teams[teamName];

    if (team.labels) {
      team.labels.forEach(labelKey => {
        const label = repoContext.labels[labelKey];

        if (label && !prLabels.some(prLabel => prLabel.id === label.id)) {
          newLabelNames.add(label.name);
          toAdd.add(labelKey);
          toAddNames.add(label.name);
        }
      });
    }
  }); // if (process.env.DRY_RUN && process.env.DRY_RUN !== 'false') return;

  if (toAdd.size !== 0 || toDelete.size !== 0) {
    if (toDelete.size === 0 || toDelete.size < 4) {
      context.log.debug('updateReviewStatus', {
        reviewGroup,
        toAdd: [...toAdd],
        toDelete: [...toDelete],
        toAddNames: [...toAddNames],
        toDeleteNames: [...toDeleteNames]
      });

      if (toAdd.size !== 0) {
        const result = await context.github.issues.addLabels(contextIssue(context, {
          labels: [...toAddNames]
        }));
        prLabels = result.data;
      }

      if (toDelete.size !== 0) {
        for (const toDeleteName of [...toDeleteNames]) {
          try {
            const result = await context.github.issues.removeLabel(contextIssue(context, {
              name: toDeleteName
            }));
            prLabels = result.data;
          } catch (err) {
            context.log.warn('error removing label', {
              err: err === null || err === void 0 ? void 0 : err.message
            });
          }
        }
      }
    } else {
      const newLabelNamesArray = [...newLabelNames];
      context.log.debug('updateReviewStatus', {
        reviewGroup,
        toAdd: [...toAdd],
        toDelete: [...toDelete],
        oldLabels: prLabels.map(l => l.name),
        newLabelNames: newLabelNamesArray
      });
      const result = await context.github.issues.replaceLabels(contextIssue(context, {
        labels: newLabelNamesArray
      }));
      prLabels = result.data;
    }
  } // if (toAdd.has('needsReview')) {
  //   createInProgressStatusCheck(context);
  // } else if (
  //   toDelete.has('needsReview') ||
  //   (prLabels.length === 0 && toAdd.size === 1 && toAdd.has('approved'))
  // ) {


  await updateStatusCheckFromLabels(prContext, pr, context, prLabels); // }

  return prLabels;
};

const autoApproveAndAutoMerge = async (prContext, context) => {
  // const autoMergeLabel = repoContext.labels['merge/automerge'];
  const codeApprovedLabel = prContext.repoContext.labels['code/approved'];

  if (hasLabelInPR(prContext.pr.labels, codeApprovedLabel)) {
    await context.github.pulls.createReview(contextPr(context, {
      event: 'APPROVE'
    }));
    await autoMergeIfPossible(prContext, context);
    return true;
  }

  return false;
};

function opened(app, appContext) {
  app.on('pull_request.opened', createPullRequestHandler(appContext, (payload, context, repoContext) => {
    if (repoContext.shouldIgnore) return null;
    return payload.pull_request;
  }, async (prContext, context) => {
    const {
      pr
    } = prContext;
    const fromRenovate = pr.head.ref.startsWith('renovate/');
    await Promise.all([autoAssignPRToCreator(prContext, context), editOpenedPR(prContext, context, true), fromRenovate ? autoApproveAndAutoMerge(prContext, context).then(async approved => {
      if (!approved && prContext.repoContext.config.requiresReviewRequest) {
        await updateReviewStatus(prContext, context, 'dev', {
          add: ['needsReview']
        });
      }
    }) : updateReviewStatus(prContext, context, 'dev', {
      add: prContext.repoContext.config.requiresReviewRequest ? ['needsReview'] : [],
      remove: ['approved', 'changesRequested']
    })]);
  }, (pr, context) => {
    return {
      reviewflowCommentPromise: createReviewflowComment(context, pr, defaultCommentBody)
    };
  }));
}

function closed(app, appContext) {
  app.on('pull_request.closed', createPullRequestHandler(appContext, payload => payload.pull_request, async (prContext, context, repoContext) => {
    const {
      pr,
      commentBody
    } = prContext;

    if (!repoContext.shouldIgnore) {
      const repo = context.payload.repository;

      if (pr.merged) {
        const isNotFork = pr.head.repo.id === repo.id;
        const options = parseOptions(commentBody, repoContext.config.prDefaultOptions);
        await Promise.all([repoContext.removePrFromAutomergeQueue(context, pr.number, 'pr closed'), isNotFork && options.deleteAfterMerge ? context.github.git.deleteRef(context.repo({
          ref: `heads/${pr.head.ref}`
        })).catch(() => {}) : undefined]);
      } else {
        await Promise.all([repoContext.removePrFromAutomergeQueue(context, pr.number, 'pr closed'), updateReviewStatus(prContext, context, 'dev', {
          remove: ['needsReview']
        })]);
      }
    }

    if (pr.assignees) {
      pr.assignees.forEach(assignee => {
        repoContext.slack.updateHome(assignee.login);
      });
    }
  }));
}

function closed$1(app, appContext) {
  app.on('pull_request.reopened', createPullRequestHandler(appContext, (payload, context, repoContext) => {
    if (repoContext.shouldIgnore) return null;
    return payload.pull_request;
  }, async (prContext, context) => {
    await Promise.all([updateReviewStatus(prContext, context, 'dev', {
      add: ['needsReview'],
      remove: ['approved']
    }), editOpenedPR(prContext, context, true)]);
  }));
}

const createLink = (url, text) => {
  return `<${url}|${text}>`;
};
const createPrLink = (pr, repoContext) => {
  return createLink(pr.html_url, `${repoContext.repoEmoji ? `${repoContext.repoEmoji} ` : ''}${repoContext.repoFullName}#${pr.number}`);
};

const createMrkdwnSectionBlock = text => ({
  type: 'section',
  text: {
    type: 'mrkdwn',
    text
  }
});
const createSlackMessageWithSecondaryBlock = (message, secondaryBlockText) => {
  return {
    text: message,
    blocks: [{
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: message
      }
    }],
    secondaryBlocks: !secondaryBlockText ? undefined : [createMrkdwnSectionBlock(secondaryBlockText)]
  };
};

const getReviewersAndReviewStates = async (context, repoContext) => {
  const userIds = new Set();
  const reviewers = [];
  const reviewStatesByUser = new Map();
  await context.github.paginate(context.github.pulls.listReviews.endpoint.merge(contextPr(context)), ({
    data: reviews
  }) => {
    reviews.forEach(review => {
      if (!userIds.has(review.user.id)) {
        userIds.add(review.user.id);
        reviewers.push({
          id: review.user.id,
          login: review.user.login
        });
      }

      const state = review.state.toUpperCase();

      if (state !== 'COMMENTED') {
        reviewStatesByUser.set(review.user.id, state);
      }
    });
  });
  const reviewStates = {};
  getKeys(repoContext.config.groups).forEach(groupName => {
    reviewStates[groupName] = {
      approved: 0,
      changesRequested: 0,
      dismissed: 0
    };
  });
  reviewers.forEach(reviewer => {
    const group = repoContext.getReviewerGroup(reviewer.login);

    if (group) {
      const state = reviewStatesByUser.get(reviewer.id);

      switch (state) {
        case 'APPROVED':
          reviewStates[group].approved++;
          break;

        case 'CHANGES_REQUESTED':
          reviewStates[group].changesRequested++;
          break;

        case 'DISMISSED':
          reviewStates[group].dismissed++;
          break;
      }
    }
  });
  return {
    reviewers,
    reviewStates
  };
};

const parse = issueParser('github', {
  actions: {},
  issuePrefixes: []
});
const parseMentions = body => {
  return parse(body).mentions.map(m => m.user);
};

/** deprecated */
const getPullRequestFromPayload = payload => {
  const pullRequest = payload.pull_request;

  if (pullRequest) {
    return pullRequest;
  }

  const issue = payload.issue;

  if (issue === null || issue === void 0 ? void 0 : issue.pull_request) {
    return { ...issue,
      ...issue.pull_request
    };
  }

  throw new Error('No pull_request in payload');
};

const checkIfUserIsBot = (repoContext, user) => {
  if (user.type === 'Bot') return true;

  if (repoContext.config.botUsers) {
    return repoContext.config.botUsers.includes(user.login);
  }

  return false;
};
const checkIfIsThisBot = user => {
  return user.type === 'Bot' && user.login === `${process.env.REVIEWFLOW_NAME}[bot]`;
};

const slackifyCommentBody = (body, multipleLines) => {
  return slackifyMarkdown(body.replace('```suggestion', '_Suggested change:_\n```suggestion').replace('```suggestion\r\n```', `_Suggestion to remove line${multipleLines ? 's' : ''}._\n`));
};

const getDiscussion = async (context, comment) => {
  if (!comment.in_reply_to_id) return [comment];
  return context.github.paginate(context.github.pulls.listComments.endpoint.merge(contextPr(context)), ({
    data
  }) => {
    return data.filter(c => c.in_reply_to_id === comment.in_reply_to_id || c.id === comment.in_reply_to_id);
  });
};

const getMentions = discussion => {
  const mentions = new Set();
  discussion.forEach(c => {
    parseMentions(c.body).forEach(m => mentions.add(m));
  });
  return [...mentions];
};

const getUsersInThread = discussion => {
  const userIds = new Set();
  const users = [];
  discussion.forEach(c => {
    if (userIds.has(c.user.id)) return;
    userIds.add(c.user.id);
    users.push({
      id: c.user.id,
      login: c.user.login
    });
  });
  return users;
};

function prCommentCreated(app, appContext) {
  const saveInDb = async (type, commentId, accountEmbed, results, message) => {
    const filtered = results.filter(ExcludesNullish);
    if (filtered.length === 0) return;
    await appContext.mongoStores.slackSentMessages.insertOne({
      type,
      typeId: commentId,
      message,
      account: accountEmbed,
      sentTo: filtered
    });
  };

  app.on(['pull_request_review_comment.created', // comments without review and without path are sent with issue_comment.created.
  // createHandlerPullRequestChange checks if pull_request event is present, removing real issues comments.
  'issue_comment.created'], createPullRequestHandler(appContext, payload => {
    if (checkIfIsThisBot(payload.comment.user)) {
      // ignore comments from this bot
      return null;
    }

    return getPullRequestFromPayload(payload);
  }, async (prContext, context, repoContext) => {
    const pr = await fetchPr(context, prContext.pr.number);
    const {
      comment
    } = context.payload;
    const type = comment.pull_request_review_id ? 'review-comment' : 'issue-comment';
    const body = comment.body;
    if (!body) return;
    const commentByOwner = pr.user.login === comment.user.login;
    const [discussion, {
      reviewers
    }] = await Promise.all([getDiscussion(context, comment), getReviewersAndReviewStates(context, repoContext)]);
    const followers = reviewers.filter(u => u.id !== pr.user.id && u.id !== comment.user.id);

    if (pr.requested_reviewers) {
      followers.push(...pr.requested_reviewers.filter(rr => {
        return !followers.find(f => f.id === rr.id) && rr.id !== comment.user.id && rr.id !== pr.user.id;
      }));
    }

    const usersInThread = getUsersInThread(discussion).filter(u => u.id !== pr.user.id && u.id !== comment.user.id && !followers.find(f => f.id === u.id));
    const mentions = getMentions(discussion).filter(m => m !== pr.user.login && m !== comment.user.login && !followers.find(f => f.login === m) && !usersInThread.find(u => u.login === m));
    const mention = repoContext.slack.mention(comment.user.login);
    const prUrl = createPrLink(pr, repoContext);
    const ownerMention = repoContext.slack.mention(pr.user.login);
    const commentLink = createLink(comment.html_url, comment.in_reply_to_id ? 'replied' : 'commented');

    const createMessage = toOwner => {
      const ownerPart = toOwner ? 'your PR' : `${pr.user.id === comment.user.id ? 'his' : `${ownerMention}'s`} PR`;
      return `:speech_balloon: ${mention} ${commentLink} on ${ownerPart} ${prUrl}`;
    };

    const promisesOwner = [];
    const promisesNotOwner = [];
    const slackifiedBody = slackifyCommentBody(comment.body, comment.start_line !== null);
    const isBotUser = checkIfUserIsBot(repoContext, comment.user);

    if (!commentByOwner) {
      const slackMessage = createSlackMessageWithSecondaryBlock(createMessage(true), slackifiedBody);
      promisesOwner.push(repoContext.slack.postMessage(isBotUser ? 'pr-comment-bots' : 'pr-comment', pr.user.id, pr.user.login, slackMessage).then(res => saveInDb(type, comment.id, repoContext.accountEmbed, [res], slackMessage)));
    }

    const message = createSlackMessageWithSecondaryBlock(createMessage(false), slackifiedBody);
    promisesNotOwner.push(...followers.map(follower => repoContext.slack.postMessage(isBotUser ? 'pr-comment-follow-bots' : 'pr-comment-follow', follower.id, follower.login, message)));
    promisesNotOwner.push(...usersInThread.map(user => repoContext.slack.postMessage('pr-comment-thread', user.id, user.login, message)));

    if (mentions.length !== 0) {
      await appContext.mongoStores.users.findAll({
        login: {
          $in: mentions
        }
      }).then(users => {
        promisesNotOwner.push(...users.map(u => repoContext.slack.postMessage('pr-comment-mention', u._id, // TODO _id is number
        u.login, message)));
      });
    }

    await Promise.all([Promise.all(promisesOwner), Promise.all(promisesNotOwner).then(results => saveInDb(type, comment.id, repoContext.accountEmbed, results, message))]);
  }));
}

function prCommentEditedOrDeleted(app, appContext) {
  app.on(['pull_request_review_comment.edited', 'pull_request_review_comment.deleted', // comments without review and without path are sent with issue_comment.created.
  // createHandlerPullRequestChange checks if pull_request event is present, removing real issues comments.
  'issue_comment.edited', 'issue_comment.deleted'], createPullRequestHandler(appContext, payload => {
    if (checkIfIsThisBot(payload.sender)) {
      // ignore edits made from this bot
      return null;
    }

    return getPullRequestFromPayload(payload);
  }, async (prContext, context, repoContext) => {
    const {
      comment
    } = context.payload;

    if (context.payload.action === 'edited' && checkIfIsThisBot(comment.user)) {
      const updatedPrContext = await fetchPullRequestAndCreateContext(context, prContext);

      if (!updatedPrContext.updatedPr.closed_at) {
        await syncLabelsAfterCommentBodyEdited(appContext, repoContext, updatedPrContext.updatedPr, context, updatedPrContext);
      }

      return;
    }

    const type = comment.pull_request_review_id ? 'review-comment' : 'issue-comment';
    const criteria = {
      'account.id': repoContext.account._id,
      'account.type': repoContext.accountType,
      type,
      typeId: comment.id
    };
    const sentMessages = await appContext.mongoStores.slackSentMessages.findAll(criteria);
    if (sentMessages.length === 0) return;

    if (context.payload.action === 'deleted') {
      await Promise.all([Promise.all(sentMessages.map(sentMessage => Promise.all(sentMessage.sentTo.map(sentTo => repoContext.slack.deleteMessage(sentTo.ts, sentTo.channel))))), appContext.mongoStores.slackSentMessages.deleteMany(criteria)]);
    } else {
      const secondaryBlocks = [createMrkdwnSectionBlock(slackifyCommentBody(comment.body, comment.start_line !== null))];
      await Promise.all([Promise.all(sentMessages.map(sentMessage => Promise.all(sentMessage.sentTo.map(sentTo => repoContext.slack.updateMessage(sentTo.ts, sentTo.channel, { ...sentMessage.message,
        secondaryBlocks
      }))))), appContext.mongoStores.slackSentMessages.partialUpdateMany(criteria, {
        $set: {
          'message.secondaryBlocks': secondaryBlocks
        }
      })]);
    }
  }));
}

function reviewRequested(app, appContext) {
  app.on('pull_request.review_requested', createPullRequestHandler(appContext, payload => payload.pull_request, async (prContext, context, repoContext) => {
    const {
      pr
    } = prContext;
    const sender = context.payload.sender;
    const reviewer = context.payload.requested_reviewer;
    const reviewerGroup = repoContext.getReviewerGroup(reviewer.login);

    // repoContext.approveShouldWait(reviewerGroup, pr.requested_reviewers, { includesWaitForGroups: true });
    if (!repoContext.shouldIgnore && reviewerGroup && repoContext.config.labels.review[reviewerGroup]) {
      await updateReviewStatus(prContext, context, reviewerGroup, {
        add: ['needsReview', "requested"],
        remove: ['approved']
      });

      if (pr.assignees) {
        pr.assignees.forEach(assignee => {
          repoContext.slack.updateHome(assignee.login);
        });
      }

      if (!pr.assignees.find(assignee => assignee.login === reviewer.login)) {
        repoContext.slack.updateHome(reviewer.login);
      }
    }

    if (sender.login === reviewer.login) return;

    if (repoContext.slack) {
      const text = `:eyes: ${repoContext.slack.mention(sender.login)} requests your review on ${createPrLink(pr, repoContext)} !\n> ${pr.title}`;
      const message = {
        text
      };
      const result = await repoContext.slack.postMessage('pr-review', reviewer.id, reviewer.login, message);

      if (result) {
        await appContext.mongoStores.slackSentMessages.insertOne({
          type: 'review-requested',
          typeId: `${pr.id}_${reviewer.id}`,
          message,
          account: repoContext.accountEmbed,
          sentTo: [result]
        });
      }
    }
  }));
}

function reviewRequestRemoved(app, appContext) {
  app.on('pull_request.review_request_removed', createPullRequestHandler(appContext, payload => payload.pull_request, async (prContext, context, repoContext) => {
    const {
      pr
    } = prContext;
    const sender = context.payload.sender;
    const reviewer = context.payload.requested_reviewer;
    const reviewerGroup = repoContext.getReviewerGroup(reviewer.login);

    if (!repoContext.shouldIgnore && reviewerGroup && repoContext.config.labels.review[reviewerGroup]) {
      const hasRequestedReviewsForGroup = repoContext.approveShouldWait(reviewerGroup, pr.requested_reviewers, {
        includesReviewerGroup: true
      });
      const {
        reviewStates
      } = await getReviewersAndReviewStates(context, repoContext);
      const hasChangesRequestedInReviews = reviewStates[reviewerGroup].changesRequested !== 0;
      const hasApprovedInReviews = reviewStates[reviewerGroup].approved !== 0;
      const approved = !hasRequestedReviewsForGroup && !hasChangesRequestedInReviews && hasApprovedInReviews;
      await updateReviewStatus(prContext, context, reviewerGroup, {
        add: [// if changes requested by the one which requests was removed (should still be in changed requested anyway, but we never know)
        hasChangesRequestedInReviews && 'changesRequested', // if was already approved by another member in the group and has no other requests waiting
        approved && 'approved'],
        // remove labels if has no other requests waiting
        remove: [approved && 'needsReview', !hasRequestedReviewsForGroup && 'requested']
      });

      if (pr.assignees) {
        pr.assignees.forEach(assignee => {
          repoContext.slack.updateHome(assignee.login);
        });
      }

      if (!pr.assignees.find(assignee => assignee.login === reviewer.login)) {
        repoContext.slack.updateHome(reviewer.login);
      }
    }

    if (sender.login === reviewer.login) return;
    repoContext.slack.postMessage('pr-review', reviewer.id, reviewer.login, {
      text: `:skull_and_crossbones: ${repoContext.slack.mention(sender.login)} removed the request for your review on ${createPrLink(pr, repoContext)}`
    });
    const sentMessageRequestedReview = await appContext.mongoStores.slackSentMessages.findOne({
      'account.id': repoContext.account._id,
      'account.type': repoContext.accountType,
      type: 'review-requested',
      typeId: `${pr.id}_${reviewer.id}`
    });

    if (sentMessageRequestedReview) {
      const sentTo = sentMessageRequestedReview.sentTo[0];
      const message = sentMessageRequestedReview.message;
      await Promise.all([repoContext.slack.updateMessage(sentTo.ts, sentTo.channel, { ...message,
        text: message.text.split('\n').map(l => `~${l}~`).join('\n')
      }), repoContext.slack.addReaction(sentTo.ts, sentTo.channel, 'skull_and_crossbones'), appContext.mongoStores.slackSentMessages.deleteOne(sentMessageRequestedReview)]);
    }
  }));
}

const getEmojiFromState = state => {
  switch (state) {
    case 'changes_requested':
      return 'x';

    case 'approved':
      return 'white_check_mark';

    default:
      return 'speech_balloon';
  }
};

function reviewSubmitted(app, appContext) {
  app.on('pull_request_review.submitted', createPullRequestHandler(appContext, payload => payload.pull_request, async (prContext, context) => {
    const {
      pr,
      repoContext
    } = prContext;
    const {
      user: reviewer,
      state,
      body,
      html_url: reviewUrl
    } = context.payload.review;
    const reviewByOwner = pr.user.login === reviewer.login;
    const {
      reviewers,
      reviewStates
    } = await getReviewersAndReviewStates(context, repoContext);
    const followers = reviewers.filter(user => user.id !== reviewer.id && user.id !== pr.user.id);

    if (pr.requested_reviewers) {
      followers.push(...pr.requested_reviewers.filter(rr => {
        return !followers.find(f => f.id === rr.id) && rr.id !== reviewer.id && rr.id !== pr.user.id;
      }));
    }

    if (!reviewByOwner) {
      const reviewerGroup = repoContext.getReviewerGroup(reviewer.login);
      let merged;

      if (!repoContext.shouldIgnore && reviewerGroup && repoContext.config.labels.review[reviewerGroup]) {
        const hasRequestedReviewsForGroup = repoContext.approveShouldWait(reviewerGroup, pr.requested_reviewers, {
          includesReviewerGroup: true // TODO reenable this when accepted can notify request review to slack (dev accepted => design requested) and flag to disable for label (approved design ; still waiting for dev ?)
          // includesWaitForGroups: true,

        });
        const hasChangesRequestedInReviews = reviewStates[reviewerGroup].changesRequested !== 0;
        const approved = !hasRequestedReviewsForGroup && !hasChangesRequestedInReviews && state === 'approved';
        const updatedPrContext = await fetchPullRequestAndCreateContext(context, prContext);
        const newLabels = await updateReviewStatus(updatedPrContext, context, reviewerGroup, {
          add: [approved && 'approved', state === 'changes_requested' && 'needsReview', state === 'changes_requested' && 'changesRequested'],
          remove: [approved && 'needsReview', !hasRequestedReviewsForGroup && 'requested', state === 'approved' && !hasChangesRequestedInReviews && 'changesRequested', state === 'changes_requested' && 'approved']
        });

        if (approved && !hasChangesRequestedInReviews) {
          merged = await autoMergeIfPossible(updatedPrContext, context, newLabels);
        }
      }

      if (pr.assignees) {
        pr.assignees.forEach(assignee => {
          repoContext.slack.updateHome(assignee.login);
        });
      }

      if (!pr.assignees.find(assignee => assignee.login === reviewer.login)) {
        repoContext.slack.updateHome(reviewer.login);
      }

      const sentMessageRequestedReview = await appContext.mongoStores.slackSentMessages.findOne({
        'account.id': repoContext.account._id,
        'account.type': repoContext.accountType,
        type: 'review-requested',
        typeId: `${pr.id}_${reviewer.id}`
      });
      const emoji = getEmojiFromState(state);

      if (sentMessageRequestedReview) {
        const sentTo = sentMessageRequestedReview.sentTo[0];
        const message = sentMessageRequestedReview.message;
        await Promise.all([repoContext.slack.updateMessage(sentTo.ts, sentTo.channel, { ...message,
          text: message.text.split('\n').map(l => `~${l}~`).join('\n')
        }), repoContext.slack.addReaction(sentTo.ts, sentTo.channel, emoji), appContext.mongoStores.slackSentMessages.deleteOne(sentMessageRequestedReview)]);
      }

      if (!body && state !== 'changes_requested' && state !== 'approved') {
        return;
      }

      const mention = repoContext.slack.mention(reviewer.login);
      const prUrl = createPrLink(pr, repoContext);
      const ownerMention = repoContext.slack.mention(pr.user.login);

      const createMessage = toOwner => {
        const ownerPart = toOwner ? 'your PR' : `${ownerMention}'s PR`;

        if (state === 'changes_requested') {
          return `:${emoji}: ${mention} requests changes on ${ownerPart} ${prUrl}`;
        }

        if (state === 'approved') {
          return `${toOwner ? ':clap: ' : ''}:${emoji}: ${mention} approves ${ownerPart} ${prUrl}${merged ? ' and PR is merged :tada:' : ''}`;
        }

        const commentLink = createLink(reviewUrl, 'commented');
        return `:${emoji}: ${mention} ${commentLink} on ${ownerPart} ${prUrl}`;
      };

      const slackifiedBody = slackifyMarkdown(body);
      repoContext.slack.postMessage('pr-review', pr.user.id, pr.user.login, createSlackMessageWithSecondaryBlock(createMessage(true), slackifiedBody));
      const message = createSlackMessageWithSecondaryBlock(createMessage(false), slackifiedBody);
      followers.forEach(follower => {
        repoContext.slack.postMessage('pr-review-follow', follower.id, follower.login, message);
      });
    } else if (body) {
      const mention = repoContext.slack.mention(reviewer.login);
      const prUrl = createPrLink(pr, repoContext);
      const commentLink = createLink(reviewUrl, 'commented');
      const message = createSlackMessageWithSecondaryBlock(`:speech_balloon: ${mention} ${commentLink} on his PR ${prUrl}`, body);
      followers.forEach(follower => {
        repoContext.slack.postMessage('pr-review-follow', follower.id, follower.login, message);
      });
    }
  }));
}

function reviewDismissed(app, appContext) {
  app.on('pull_request_review.dismissed', createPullRequestHandler(appContext, payload => payload.pull_request, async (prContext, context, repoContext) => {
    const sender = context.payload.sender;
    const reviewer = context.payload.review.user;
    const reviewerGroup = repoContext.getReviewerGroup(reviewer.login);

    if (!repoContext.shouldIgnore && reviewerGroup && repoContext.config.labels.review[reviewerGroup]) {
      const updatedPrContext = await fetchPullRequestAndCreateContext(context, prContext);
      const pr = updatedPrContext.updatedPr;
      const {
        reviewStates
      } = await getReviewersAndReviewStates(context, repoContext);
      const hasChangesRequestedInReviews = reviewStates[reviewerGroup].changesRequested !== 0;
      const hasApprovals = reviewStates[reviewerGroup].approved !== 0;
      const hasRequestedReviewsForGroup = repoContext.approveShouldWait(reviewerGroup, pr.requested_reviewers, {
        includesReviewerGroup: true
      });
      await updateReviewStatus(updatedPrContext, context, reviewerGroup, {
        add: [!hasApprovals && 'needsReview', hasApprovals && !hasRequestedReviewsForGroup && !hasChangesRequestedInReviews && 'approved'],
        remove: [!hasRequestedReviewsForGroup && !hasChangesRequestedInReviews && 'requested', !hasChangesRequestedInReviews && 'changesRequested', !hasApprovals && 'approved']
      });

      if (pr.assignees) {
        pr.assignees.forEach(assignee => {
          repoContext.slack.updateHome(assignee.login);
        });
      }

      if (!pr.assignees.find(assignee => assignee.login === reviewer.login)) {
        repoContext.slack.updateHome(reviewer.login);
      }
    }

    if (repoContext.slack) {
      if (sender.login === reviewer.login) {
        prContext.pr.assignees.forEach(assignee => {
          repoContext.slack.postMessage('pr-review', assignee.id, assignee.login, {
            text: `:skull: ${repoContext.slack.mention(reviewer.login)} dismissed his review on ${createPrLink(prContext.pr, repoContext)}`
          });
        });
      } else {
        repoContext.slack.postMessage('pr-review', reviewer.id, reviewer.login, {
          text: `:skull: ${repoContext.slack.mention(sender.login)} dismissed your review on ${createPrLink(prContext.pr, repoContext)}`
        });
      }
    }
  }));
}

function synchronize(app, appContext) {
  app.on('pull_request.synchronize', createPullRequestHandler(appContext, (payload, context, repoContext) => {
    if (repoContext.shouldIgnore) return null;
    return payload.pull_request;
  }, async (prContext, context) => {
    const updatedPrContext = await fetchPullRequestAndCreateContext(context, prContext); // old and new sha
    // const { before, after } = context.payload;

    const previousSha = context.payload.before;
    await Promise.all([editOpenedPR(updatedPrContext, context, true, previousSha), // addStatusCheckToLatestCommit
    updateStatusCheckFromLabels(updatedPrContext, updatedPrContext.updatedPr, context, updatedPrContext.updatedPr.labels, previousSha)]); // call autoMergeIfPossible to re-add to the queue when push is fixed

    await autoMergeIfPossible(updatedPrContext, context);
  }));
}

function edited(app, appContext) {
  app.on('pull_request.edited', createPullRequestHandler(appContext, (payload, context, repoContext) => {
    if (repoContext.shouldIgnore) return null;
    return payload.pull_request;
  }, async (prContext, context) => {
    const prContextUpdated = await fetchPullRequestAndCreateContext(context, prContext);
    const sender = context.payload.sender;

    if (checkIfIsThisBot(sender)) {
      return;
    }

    await editOpenedPR(prContextUpdated, context, false);
    await autoMergeIfPossible(prContextUpdated, context);
  }));
}

const updateBranch = async (updatedPrContext, context, login) => {
  const pr = updatedPrContext.updatedPr;
  context.log.info('update branch', {
    head: pr.head.ref,
    base: pr.base.ref
  });
  const result = await context.github.repos.merge({
    owner: pr.head.repo.owner.login,
    repo: pr.head.repo.name,
    head: pr.base.ref,
    base: pr.head.ref
  }).catch(err => ({
    error: err
  }));
  context.log.info('update branch result', {
    status: result.status,
    sha: result.data && result.data.sha,
    error: result.error
  });

  if (result.status === 204) {
    context.github.issues.createComment(context.repo({
      issue_number: pr.number,
      body: `@${login} could not update branch: base already contains the head, nothing to merge.`
    }));
  } else if (result.status === 409) {
    context.github.issues.createComment(context.repo({
      issue_number: pr.number,
      body: `@${login} could not update branch: merge conflict. Please resolve manually.`
    }));
  } else if (!result || !result.data || !result.data.sha) {
    context.github.issues.createComment(context.repo({
      issue_number: pr.number,
      body: `@${login} could not update branch (unknown error)`
    }));
  } else {
    context.github.issues.createComment(context.repo({
      issue_number: pr.number,
      body: `@${login} branch updated: ${result.data.sha}`
    }));
  }
};

const updatePrCommentBody = async (prContext, context, updateOptions) => {
  const {
    commentBody: newBody
  } = updateCommentOptions(prContext.commentBody, prContext.repoContext.config.prDefaultOptions, updateOptions);
  await updatePrIfNeeded(prContext, context, {
    commentBody: newBody
  });
};

const isFromRenovate = payload => {
  const sender = payload.sender;
  return sender.type === 'Bot' && sender.login === 'renovate[bot]' && payload.pull_request.head.ref.startsWith('renovate/');
};

function labelsChanged(app, appContext) {
  app.on(['pull_request.labeled', 'pull_request.unlabeled'], createPullRequestHandler(appContext, (payload, context, repoContext) => {
    if (payload.sender.type === 'Bot' && !isFromRenovate(payload)) {
      return null;
    }

    if (repoContext.shouldIgnore) return null;
    return payload.pull_request;
  }, async (prContext, context, repoContext) => {
    const fromRenovate = isFromRenovate(context.payload);
    const updatedPrContext = await fetchPullRequestAndCreateContext(context, prContext);
    const {
      updatedPr: pr
    } = updatedPrContext;
    const label = context.payload.label;

    if (fromRenovate) {
      const codeApprovedLabel = repoContext.labels['code/approved'];
      const autoMergeLabel = repoContext.labels['merge/automerge'];
      const autoMergeSkipCiLabel = repoContext.labels['merge/skip-ci'];

      if (context.payload.action === 'labeled') {
        if (codeApprovedLabel && label.id === codeApprovedLabel.id) {
          // const { data: reviews } = await context.github.pulls.listReviews(
          //   contextPr(context, { per_page: 1 }),
          // );
          // if (reviews.length !== 0) {
          await context.github.pulls.createReview(contextPr(context, {
            event: 'APPROVE'
          }));
          let labels = pr.labels;
          const autoMergeWithSkipCi = autoMergeSkipCiLabel && repoContext.config.autoMergeRenovateWithSkipCi;

          if (autoMergeWithSkipCi) {
            const result = await context.github.issues.addLabels(contextIssue(context, {
              labels: [autoMergeSkipCiLabel.name]
            }));
            labels = result.data;
          }

          await updateStatusCheckFromLabels(updatedPrContext, pr, context, labels);
          await updatePrCommentBody(updatedPrContext, context, {
            autoMergeWithSkipCi,
            // force label to avoid racing events (when both events are sent in the same time, reviewflow treats them one by one but the second event wont have its body updated)
            autoMerge: hasLabelInPR(labels, autoMergeLabel) ? true : repoContext.config.prDefaultOptions.autoMerge
          }); // }
        } else if (autoMergeLabel && label.id === autoMergeLabel.id) {
          await updatePrCommentBody(updatedPrContext, context, {
            autoMerge: true,
            // force label to avoid racing events (when both events are sent in the same time, reviewflow treats them one by one but the second event wont have its body updated)
            // Note: si c'est renovate qui ajoute le label autoMerge, le label codeApprovedLabel n'aurait pu etre ajouté que par renovate également (on est a quelques secondes de l'ouverture de la pr par renovate)
            autoMergeWithSkipCi: hasLabelInPR(pr.labels, codeApprovedLabel) ? true : repoContext.config.prDefaultOptions.autoMergeWithSkipCi
          });
        }

        await autoMergeIfPossible(updatedPrContext, context);
      }

      return;
    }

    if (repoContext.protectedLabelIds.includes(label.id)) {
      if (context.payload.action === 'labeled') {
        await context.github.issues.removeLabel(contextIssue(context, {
          name: label.name
        }));
      } else {
        await context.github.issues.addLabels(contextIssue(context, {
          labels: [label.name]
        }));
      }

      return;
    }

    await updateStatusCheckFromLabels(updatedPrContext, pr, context);
    const updateBranchLabel = repoContext.labels['merge/update-branch'];
    const featureBranchLabel = repoContext.labels['feature-branch'];
    const automergeLabel = repoContext.labels['merge/automerge'];
    const skipCiLabel = repoContext.labels['merge/skip-ci'];

    const option = (() => {
      if (featureBranchLabel && label.id === featureBranchLabel.id) return 'featureBranch';
      if (automergeLabel && label.id === automergeLabel.id) return 'autoMerge';
      if (skipCiLabel && label.id === skipCiLabel.id) return 'autoMergeWithSkipCi';
      return null;
    })();

    if (option) {
      await updatePrCommentBody(updatedPrContext, context, {
        [option]: context.payload.action === 'labeled'
      });
    } // not an else if


    if (automergeLabel && label.id === automergeLabel.id) {
      if (context.payload.action === 'labeled') {
        await autoMergeIfPossible(updatedPrContext, context);
      } else {
        repoContext.removePrFromAutomergeQueue(context, pr.number, 'automerge label removed');
      }
    }

    if (updateBranchLabel && label.id === updateBranchLabel.id) {
      if (context.payload.action === 'labeled') {
        await updateBranch(updatedPrContext, context, context.payload.sender.login);
        await context.github.issues.removeLabel(contextIssue(context, {
          name: label.name
        }));
      }
    }
  }));
}

function checkrunCompleted(app, appContext) {
  app.on('check_run.completed', createPullRequestsHandler(appContext, (payload, repoContext) => {
    if (repoContext.shouldIgnore) return [];
    return payload.check_run.pull_requests;
  }, async (pr, context, repoContext) => {
    const pullRequest = await fetchPr(context, pr.number);
    await autoMergeIfPossibleOptionalPrContext(appContext, repoContext, pullRequest, context);
  }));
}

function checksuiteCompleted(app, appContext) {
  app.on('check_suite.completed', createPullRequestsHandler(appContext, (payload, repoContext) => {
    if (repoContext.shouldIgnore) return [];
    return payload.check_suite.pull_requests;
  }, async (pr, context, repoContext) => {
    const pullRequest = await fetchPr(context, pr.number);
    const prContext = await createPullRequestContextFromPullResponse(appContext, repoContext, context, pullRequest, {});
    await autoMergeIfPossible(prContext, context);
  }));
}

const isSameBranch = (payload, lockedPr) => {
  if (!lockedPr) return false;
  return !!payload.branches.find(b => b.name === lockedPr.branch);
};

function status(app, appContext) {
  app.on('status', createPullRequestsHandler(appContext, (payload, repoContext) => {
    if (repoContext.shouldIgnore) return [];
    const lockedPr = repoContext.getMergeLockedPr();
    if (!lockedPr) return [];

    if (payload.state !== 'loading' && isSameBranch(payload, lockedPr)) {
      return [lockedPr];
    }

    return [];
  }, (pr, context, repoContext) => {
    const lockedPr = repoContext.getMergeLockedPr(); // check if changed

    if (isSameBranch(context.payload, lockedPr)) {
      repoContext.reschedule(context, lockedPr);
    }
  }));
}

const handlerOrgChange = async (appContext, context, callback) => {
  const org = context.payload.organization;
  const config$1 = accountConfigs[org.login] || config;
  const accountContext = await obtainAccountContext(appContext, context, config$1, { ...org,
    type: 'Organization'
  });
  if (!accountContext) return;
  return accountContext.lock(async () => {
    await callback(context, accountContext);
  });
};
const createHandlerOrgChange = (appContext, callback) => context => {
  return handlerOrgChange(appContext, context, callback);
};

function repoEdited(app, appContext) {
  app.on('repository.edited', createHandlerOrgChange(appContext, async context => {
    const repoContext = await obtainRepoContext(appContext, context);
    if (!repoContext) return;
    const repo = context.payload.repository;
    repoContext.repoFullName = repo.full_name;
    repoContext.repoEmoji = getEmojiFromRepoDescription(repo.description);
  }));
}

function initApp(app, appContext) {
  /* https://developer.github.com/webhooks/event-payloads/#organization */
  app.on(['organization.member_added', 'organization.member_removed'], createHandlerOrgChange(appContext, async (context, accountContext) => {
    await syncOrg(appContext.mongoStores, context.github, accountContext.account.installationId, context.payload.organization);
  }));
  /* https://developer.github.com/webhooks/event-payloads/#team */

  app.on(['team.created', 'team.deleted', 'team.edited'], createHandlerOrgChange(appContext, async context => {
    await syncTeams(appContext.mongoStores, context.github, context.payload.organization);
  })); // /* https://developer.github.com/webhooks/event-payloads/#membership */
  // app.on(
  //   ['membership.added', 'membership.removed'],
  //   createHandlerOrgChange<Webhooks.WebhookPayloadMembership>(
  //     mongoStores,
  //     async (context, accountContext) => {
  //       await syncTeamMembers(
  //         mongoStores,
  //         context.github,
  //         context.payload.organization,
  //         context.payload.team,
  //       );
  //     },
  //   ),
  // );
  // Repo

  /* https://developer.github.com/webhooks/event-payloads/#repository */

  repoEdited(app, appContext); // PR

  /* https://developer.github.com/webhooks/event-payloads/#pull_request */

  opened(app, appContext);
  edited(app, appContext);
  closed(app, appContext);
  closed$1(app, appContext);
  reviewRequested(app, appContext);
  reviewRequestRemoved(app, appContext);
  reviewSubmitted(app, appContext);
  reviewDismissed(app, appContext);
  labelsChanged(app, appContext);
  synchronize(app, appContext);
  /* https://developer.github.com/webhooks/event-payloads/#pull_request_review_comment */

  /* https://developer.github.com/webhooks/event-payloads/#issue_comment */

  prCommentCreated(app, appContext);
  prCommentEditedOrDeleted(app, appContext);
  /* https://developer.github.com/webhooks/event-payloads/#check_run */

  checkrunCompleted(app, appContext);
  /* https://developer.github.com/webhooks/event-payloads/#check_suite */

  checksuiteCompleted(app, appContext);
  /* https://developer.github.com/webhooks/event-payloads/#status */

  status(app, appContext);
}

const createSlackHomeWorker = mongoStores => {
  const updateMember = async (github, slackClient, member) => {
    var _member$slack;

    if (!((_member$slack = member.slack) === null || _member$slack === void 0 ? void 0 : _member$slack.id)) return; // console.log('update member', member.org.login, member.user.login);

    /* search limit: 30 requests per minute = 7 update/min max */

    const [prsWithRequestedReviews, prsToMerge, prsWithRequestedChanges, prsInDraft] = await Promise.all([github.search.issuesAndPullRequests({
      q: `is:pr user:${member.org.login} is:open review-requested:${member.user.login} `,
      sort: 'created',
      order: 'desc'
    }), github.search.issuesAndPullRequests({
      q: `is:pr user:${member.org.login} is:open assignee:${member.user.login} label:":ok_hand: code/approved"`,
      sort: 'created',
      order: 'desc'
    }), github.search.issuesAndPullRequests({
      q: `is:pr user:${member.org.login} is:open assignee:${member.user.login} label:":ok_hand: code/changes-requested"`,
      sort: 'created',
      order: 'desc'
    }), github.search.issuesAndPullRequests({
      q: `is:pr user:${member.org.login} is:open assignee:${member.user.login} draft:true`,
      sort: 'created',
      order: 'desc',
      per_page: 5
    })]);
    const blocks = [];

    const buildBlocks = (title, results) => {
      if (!results.total_count) return;
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${title}*`
        }
      }, {
        type: 'divider'
      }, ...results.items.map(pr => {
        const repoName = pr.repository_url.slice(29);
        const prFullName = `${repoName}#${pr.number}`;
        return [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${createLink(pr.html_url, pr.title)}*` //  ${pr.labels.map((l) => `{${l.name}}`).join(' · ')}

          }
        }, {
          type: 'context',
          elements: [{
            type: 'mrkdwn',
            text: `${createLink(pr.html_url, prFullName)} ${pr.draft ? '· _Draft_' : ''}`
          }, {
            type: 'image',
            image_url: pr.user.avatar_url,
            alt_text: pr.user.login
          }, {
            type: 'mrkdwn',
            text: `${pr.user.login}`
          }]
        }];
      }).flat(), {
        type: 'context',
        elements: [{
          type: 'image',
          image_url: 'https://api.slack.com/img/blocks/bkb_template_images/placeholder.png',
          alt_text: 'placeholder'
        }]
      });
    };

    buildBlocks(':eyes: Requested Reviews', prsWithRequestedReviews.data);
    buildBlocks(':white_check_mark: Ready to Merge', prsToMerge.data);
    buildBlocks(':x: Changes Requested', prsWithRequestedChanges.data);
    buildBlocks(':construction: Drafts', prsInDraft.data);

    if (blocks.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ":tada: It looks like you don't have any PR to review!"
        }
      });
    }

    slackClient.views.publish({
      user_id: member.slack.id,
      view: {
        type: 'home',
        blocks
      }
    });
  };

  let workerInterval;
  const queueKeys = new Set();
  const queue = [];

  const stop = () => {
    if (workerInterval !== undefined) {
      clearInterval(workerInterval);
      workerInterval = undefined;
    }
  };

  const start = () => {
    if (workerInterval !== undefined) return;
    workerInterval = setInterval(() => {
      var _member$slack2;

      const item = queue.shift();

      if (!item) {
        stop();
        return;
      }

      const {
        github,
        slackClient,
        member
      } = item;
      const memberId = (_member$slack2 = member.slack) === null || _member$slack2 === void 0 ? void 0 : _member$slack2.id;
      const key = `${member.org.id}_${memberId}`;
      queueKeys.delete(key);
      updateMember(github, slackClient, member);
    }, 9000); // 7/min 60s 1min = 1 ttes les 8.5s max
  };

  const scheduleUpdateMember = (github, slackClient, member) => {
    var _member$slack3;

    const memberId = (_member$slack3 = member.slack) === null || _member$slack3 === void 0 ? void 0 : _member$slack3.id;
    if (!memberId) return;
    const key = `${member.org.id}_${memberId}`;

    if (!queueKeys.has(key)) {
      queueKeys.add(key);
      queue.push({
        github,
        slackClient,
        member
      });
      start();
    }
  };

  const scheduleUpdateOrg = async (github, org, slackClient = new webApi.WebClient(org.slackToken)) => {
    const cursor = await mongoStores.orgMembers.cursor();
    cursor.forEach(member => {
      scheduleUpdateMember(github, slackClient, member);
    });
  };

  return {
    scheduleUpdateMember,
    scheduleUpdateOrg,
    scheduleUpdateAllOrgs: async auth => {
      const cursor = await mongoStores.orgs.cursor();
      cursor.forEach(async org => {
        if (!org.slackToken || !org.installationId) return;
        const github = await auth(org.installationId);
        await scheduleUpdateOrg(github, org);
      });
    }
  };
};

if (!process.env.REVIEWFLOW_NAME) process.env.REVIEWFLOW_NAME = 'reviewflow';
console.log({
  name: process.env.REVIEWFLOW_NAME
}); // const getConfig = require('probot-config')
// const { MongoClient } = require('mongodb');
// const connect = MongoClient.connect(process.env.MONGO_URL);
// const db = connect.then(client => client.db(process.env.MONGO_DB));
// let config = await getConfig(context, 'reviewflow.yml');
// eslint-disable-next-line import/no-commonjs

probot.Probot.run(app => {
  const mongoStores = init();
  const slackHome = createSlackHomeWorker(mongoStores);
  const appContext = {
    mongoStores,
    slackHome
  };
  appRouter(app, appContext);
  initApp(app, appContext);
  slackHome.scheduleUpdateAllOrgs(id => app.auth(id));
});
//# sourceMappingURL=index-node10-dev.cjs.js.map
