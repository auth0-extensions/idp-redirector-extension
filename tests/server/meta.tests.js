const nock = require("nock");
const chai = require("chai");
const request = require("supertest");
const { describe, it } = require("mocha");
const express = require("express");
const proxyquire = require("proxyquire").noCallThru();

const expect = chai.expect;

const meta = proxyquire("../../server/routes/meta", {
  "../../webtask.json": {
    version: "1.0.0",
    repository: "https://github.com/auth0-extensions/idp-redirector-extension",
  },
});

describe("#idp-redirector/meta", () => {
  const app = express();
  app.use("/meta", meta());

  describe("GET /meta", () => {
    it("returns version from webtask.json metadata", (done) => {
      const expectedVersion = "1.0.0";

      nock("https://api.github.com")
        .get("/repos/auth0-extensions/idp-redirector-extension/releases/latest")
        .reply(404);

      request(app)
        .get("/meta")
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);

          expect(res.body.version).to.equal(expectedVersion);

          done();
        });
    });

    it("returns version from github release tag", (done) => {
      const expectedVersion = "3.0.0";

      nock("https://api.github.com")
        .get("/repos/auth0-extensions/idp-redirector-extension/releases/latest")
        .reply(200, {
          id: 123456,
          tag_name: "v" + expectedVersion,
        });

      request(app)
        .get("/meta")
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);

          expect(res.body.version).to.equal(expectedVersion);

          done();
        });
    });
  });
});
