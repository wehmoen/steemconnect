/* eslint-disable no-param-reassign,consistent-return */
const _ = require('lodash');
const url = require('url');
const { decryptMessage, getJSONMetadata } = require('../lib/utils');
const jwt = require('jsonwebtoken');
const PermissionList = require('../lib/permissions');
const { getPermissionFromDB } = require('../db/utils');

function verifyAuth(req, res, next) {
  if (req.cookies.auth && typeof req.headers.authorization === 'undefined') {
    req.headers.authorization = `Bearer ${req.cookies.auth}`;
  }
  if (typeof req.headers.authorization !== 'undefined' && (req.headers.authorization.search('Bearer ') === 0)) {
    const auth = req.headers.authorization.substring('Bearer '.length);
    jwt.verify(auth, process.env.JWT_SECRET, (err, jwtData) => {
      if (err) {
        return res.sendStatus(401);
      }
      let message = decryptMessage(jwtData.secret, process.env.JWT_SECRET);
      message = JSON.parse(message);
      if (message.username === jwtData.username && (typeof req.token === 'undefined' || req.token.username === jwtData.username)) {
        _.each(jwtData, (value, key) => {
          req[key] = value;
        });
        _.each(message, (value, key) => {
          req[key] = value;
        });
        return next();
      }
    });
  } else {
    return res.sendStatus(401);
  }
}

function verifyToken(req, res, next) {
  const token = req.get('x-steemconnect-token') || req.query.token;
  if (token) {
    jwt.verify(token, process.env.JWT_SECRET, (err, jwtData) => {
      if (err) {
        return res.sendStatus(401);
      }
      req.token = jwtData;
      return next();
    });
  } else {
    return next();
  }
}

function checkOrigin(req, res, next) {
  const origin = req.get('origin');
  let hostname = 'localhost';
  if (origin) {
    hostname = url.parse(origin).hostname;
  }
  const isDifferentHost = (hostname !== 'localhost' && hostname !== 'steemconnect.com' && hostname !== 'dev.steemconnect.com');
  const token = req.token || {};
  if (isDifferentHost) {
    getJSONMetadata(token.appUserName)
      .then((appData) => {
        const app = appData.app || {};
        if (!app.origins) {
          throw new Error('App does not have origins defined');
        }

        // Remove trailing slash from app.origins
        const acceptedOrigins = app.origins.map(acceptedOrigin => acceptedOrigin.replace(/\/$/, ''));

        if (acceptedOrigins.indexOf(origin) >= 0) {
          next();
        } else {
          throw new Error('Origin does not match from list of allowed origin');
        }
      }).catch((err) => {
        res.status(500).send(err && err.toString());
      });
  } else {
    /* For request made from steemconnect website */
    return next();
  }
}

function checkPermission(req, res, next) {
  const token = req.token || {};
  const requestUrl = url.parse(req.originalUrl);
  const requestPath = requestUrl.pathname.replace(/\/$/, '');

  const username = token.username;
  const appName = token.appUserName;
  getPermissionFromDB(username, appName).then((permissions) => {
    req.permissions = permissions;
    if (requestPath === '/api/verify') {
      return next();
    }

    if (!permissions) {
      throw new Error('Unauthorized');
    }
    permissions = _.map((permissions || []), v => PermissionList[v]);
    const selectedQuery = _.find(permissions, p => (p.paths.indexOf(requestPath) >= 0));
    if (selectedQuery) {
      next();
    } else {
      return res.status(401).json({ error: 'Not permitted', acceptedPermissions: req.permissions || [] });
    }
  }).catch((err) => {
    res.status(500).send(err && err.toString());
  });
}

module.exports = {
  verifyAuth,
  verifyToken,
  checkOrigin,
  checkPermission,
};
