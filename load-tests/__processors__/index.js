require("dotenv").config();
const path = require("path");
const samlp = require("samlp");
const { customAlphabet } = require("nanoid");
const generateUserId = customAlphabet("abcdefghijklmnopqrstuvwxyz", 10);
const fs = require("fs");
const samlClients = require("./data/relayStates.json");

function generateSamlResponse(context, ee, next) {
  const MAX_USERS = 1000000;
  const rid = Math.floor(1 + Math.random() * MAX_USERS);

  const randomUser = {
    id: generateUserId(),
    name: {
      givenName: `user${rid}`,
      familyName: `${rid}f`
    },
    groups: ["PowerUsers", "Admins", "SysAdmins"],
    address: `Street ${rid}`,
    emails: [`${generateUserId()}${rid}@example.com`]
  };

  const certFile = path.join(__dirname, "./cert/certificate.crt");
  const keyFile = path.join(__dirname, "./cert/private.key");
  const domain = context.vars.$processEnvironment.DOMAIN;
  const connection = context.vars.$processEnvironment.CONNECTION;
  const tenant = domain ? domain.split(".")[0] : "";

  samlp.getSamlResponse(
    {
      nameIdentifierProbes: ["id"],
      issuer: "https://loadtest.example.com/",
      destination: `https://${domain}/login/callback?connection=${connection}`,
      audience: `urn:auth0:${tenant}:${connection}`,
      key: fs.readFileSync(keyFile, "utf-8"),
      cert: fs.readFileSync(certFile, "utf-8")
    },
    randomUser,
    (err, saml) => {
      if (err) return next(err);
      const samlResponse = Buffer.from(saml, "utf-8").toString("base64");
      context.vars.samlResponse = samlResponse;
      next();
    }
  );
}

function init(context, ee, next) {
  context.funcs.$getLoginUrl = function() {
    const { a0Client } = context.vars;
    if (a0Client) {
      if (a0Client.loginUrl) return a0Client.loginUrl;
      // remove query string from relayState
      const relayUrl = new URL(a0Client.relayState);
      if (relayUrl.search) return relayUrl.origin + "/";
      return relayUrl.href;
    }

    return "";
  };

  //random a0Client
  const client = samlClients[Math.floor(Math.random() * samlClients.length)];
  const { loginUrl, relayStates } = client;

  context.vars.a0Client = {
    loginUrl: loginUrl,
    relayState: relayStates[Math.floor(Math.random() * relayStates.length)]
  };
  next();
}

function setIssuer(context, ee, next) {
  const { target } = context.vars;
  if (target === "http://localhost:3001")
    context.vars.issuer = "https://mock.auth0.com";
  else context.vars.issuer = target;

  next();
}

module.exports = {
  generateSamlResponse,
  setIssuer,
  init
};
