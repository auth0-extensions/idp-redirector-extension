const nock = require("nock");
const chai = require("chai");
const sinon = require("sinon");
const sinonChai = require("sinon-chai");
const request = require("supertest");
const { describe, it, beforeEach } = require("mocha");
const express = require("express");
const bodyParser = require("body-parser");
const proxyquire = require("proxyquire").noCallThru();

const config = require("../../server/lib/config");
const expect = chai.expect;

let Auth0ClientStub = {};
const Auth0ExtentionToolsStub = {
  middlewares: {
    managementApiClient: () => (req, res, next) => {
      req.auth0 = Auth0ClientStub;
      next();
    }
  }
};

const api = proxyquire("../../server/routes/api", {
  "auth0-extension-express-tools": Auth0ExtentionToolsStub
});

chai.use(sinonChai);

describe("#idp-redirector/api", () => {
  const defaultConfig = require("../../server/config.json");
  const fakeDataDogHost = "https://datadog.internal";
  const fakeDataDogPath = "/v1/logs";
  defaultConfig["DATADOG_URL"] = fakeDataDogHost + fakeDataDogPath;
  config.setProvider(key => defaultConfig[key], null);

  const storage = {
    read: sinon.stub(),
    write: sinon.stub()
  };

  const errorPageUrl = "https://error.page";
  const getTenantSettingsStub = sinon.stub();
  Auth0ClientStub = { getTenantSettings: getTenantSettingsStub };

  const app = express();

  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.user = {
      scope: "read:patterns update:patterns"
    };
    next();
  });
  app.use("/api", api(storage));

  beforeEach(() => {
    nock(fakeDataDogHost)
      .post(fakeDataDogPath, () => true)
      .reply(200, {});
  });

  describe("PUT /api", () => {
    describe("webtask storage and tenant settings working", () => {
      beforeEach(() => {
        storage.read.resolves({});
        sinon.resetHistory();

        getTenantSettingsStub.resolves({ error_page: { url: errorPageUrl } });
      });

      it("Should write valid allowlist", done => {
        const allowlistData = [
          {
            clientName: "client name",
            loginUrl: "https://url1.com/login",
            patterns: ["https://url1.com/withPath*", "https://url1.com"]
          },
          {
            clientName: "client 2",
            patterns: ["https://url2.com?*"]
          },
          {
            clientName: "client name 3",
            loginUrl: "https://url3.com/login",
            patterns: [
              "https://url3.com/withPath*",
              "https://url1.com/otherPath*"
            ]
          },
          {
            clientName: "a long client name",
            loginUrl:
              "https://some.really.long.url.not.long.enough.com:12345/login",
            patterns: [
              "https://some.really.long.url.not.long.enough.com:12345",
              "https://some.really.long.url.not.long.enough.com:12345/*",
              "https://some.really.long.url.not.long.enough.com:12345?*"
            ]
          }
        ];

        const expectedHostToPattern = {
          "https://url1.com": [
            {
              clientName: "client name",
              loginUrl: "/login",
              patterns: ["/withPath*", ""]
            },
            {
              clientName: "client name 3",
              loginUrl: "https://url3.com/login",
              patterns: ["/otherPath*"]
            }
          ],
          "https://url2.com": [
            {
              clientName: "client 2",
              patterns: ["?*"]
            }
          ],
          "https://url3.com": [
            {
              clientName: "client name 3",
              loginUrl: "/login",
              patterns: ["/withPath*"]
            }
          ],
          "https://some.really.long.url.not.long.enough.com:12345": [
            {
              clientName: "a long client name",
              loginUrl: "/login",
              patterns: ["", "/*", "?*"]
            }
          ]
        };

        request(app)
          .put("/api")
          .send(allowlistData)
          .expect(200)
          .end((err, res) => {
            if (err) return done(err);

            expect(res.body).to.deep.equal(allowlistData);
            expect(storage.write).to.have.been.calledWithExactly({
              errorPage: errorPageUrl,
              hostToPattern: expectedHostToPattern
            });
            done();
          });
      });

      const allowlistFailureTest = (allowlistData, errorMessage) => done => {
        request(app)
          .put("/api")
          .send(allowlistData)
          .expect(400)
          .end((err, res) => {
            if (err) return done(err);

            expect(res.body.error).to.equal("invalid_request");
            expect(res.body.error_description).to.equal(errorMessage);
            done();
          });
      };

      it(
        "fails with wildcard in hostname",
        allowlistFailureTest(
          [
            {
              clientName: "client name",
              patterns: ["https://example.com*"]
            }
          ],
          "[AE003] pattern can not have a wildcard as part of the hostname: https://example.com*"
        )
      );

      it(
        "fails with wildcard somewhere in the middle of the pattern",
        allowlistFailureTest(
          [
            {
              clientName: "client name",
              patterns: ["https://example.com/path*/somethingelse"]
            }
          ],
          '[AE002] "value" at position 0 fails because [child "patterns" fails because ["patterns" at position 0' +
            ' fails because ["0" with value "https:&#x2f;&#x2f;example.com&#x2f;path&#x2a;&#x2f;somethingelse" fails to match the required pattern: /^[^*]*\\*?$/]]]'
        )
      );

      it(
        "fails with invalid URL for pattern",
        allowlistFailureTest(
          [
            {
              clientName: "client name",
              patterns: ["some non url"]
            }
          ],
          "[AE003] pattern must be in the format of a URL: some non url"
        )
      );

      it(
        "fails with short client name",
        allowlistFailureTest(
          [
            {
              clientName: "",
              patterns: ["https://example.com"]
            }
          ],
          '[AE002] "value" at position 0 fails because [child "clientName" fails because ["clientName" is not allowed' +
            " to be empty]]"
        )
      );

      it(
        "fails with invalid clientName",
        allowlistFailureTest(
          [
            {
              clientName: { key: "name" },
              patterns: ["https://example.com"]
            }
          ],
          '[AE002] "value" at position 0 fails because [child "clientName" fails because ["clientName" must be a string]]'
        )
      );

      it(
        "fails with invalid loginUrl",
        allowlistFailureTest(
          [
            {
              clientName: "the client",
              loginUrl: "not a url but longer than 10",
              patterns: ["https://example.com"]
            }
          ],
          "[AE003] loginUrl must be in the format of a URL: not a url but longer than 10"
        )
      );

      it(
        "fails with invalid key",
        allowlistFailureTest(
          [
            {
              clientName: "the client",
              someOtherKey: "not a url",
              patterns: ["https://example.com"]
            }
          ],
          '[AE002] "value" at position 0 fails because ["someOtherKey" is not allowed]'
        )
      );

      it(
        "fails with empty patterns",
        allowlistFailureTest(
          [
            {
              clientName: "the client",
              patterns: []
            }
          ],
          '[AE002] "value" at position 0 fails because [child "patterns" fails because ["patterns" does not contain 1 required value(s)]]'
        )
      );

      it("fails with empty request", done => {
        request(app)
          .put("/api")
          .expect(400)
          .end((err, res) => {
            if (err) return done(err);

            expect(res.body.error).to.equal("invalid_request");
            expect(res.body.error_description).to.equal(
              '[AE002] "value" must be an array'
            );
            done();
          });
      });
    });

    describe("bad webtask storage", () => {
      beforeEach(() => {
        storage.read.resolves({});
        sinon.resetHistory();
      });

      it("should fail with special message for 409 errors", done => {
        const error = new Error("special 409");
        error.code = 409;
        storage.write.rejects(error);

        request(app)
          .put("/api")
          .send([])
          .expect(409)
          .end((err, res) => {
            if (err) return done(err);

            expect(res.body.error).to.equal("update_conflict");
            expect(res.body.error_description).to.equal(
              "[AE001] Can not override conflicting update, ensure you have the latest data and retry"
            );
            done();
          });
      });

      it("should fail with generic error for non 409 errors", done => {
        const error = new Error("some other error");
        storage.write.rejects(error);

        request(app)
          .put("/api")
          .send([])
          .expect(500)
          .end((err, res) => {
            if (err) return done(err);

            expect(res.body.error).to.equal("internal_error");
            expect(res.body.error_description).to.equal(
              "[IE002] Internal Server Error"
            );
            done();
          });
      });
    });

    describe("tenant settings failing", () => {
      beforeEach(() => {
        storage.read.resolves({});
        storage.write.resolves();
        sinon.resetHistory();
      });

      it("missing error page url", done => {
        getTenantSettingsStub.resolves({ error_page: {} });
        const allowlistData = [
          {
            clientName: "client name",
            patterns: ["https://url1.com"]
          }
        ];

        request(app)
          .put("/api")
          .send(allowlistData)
          .expect(400)
          .end((err, res) => {
            if (err) return done(err);
            expect(res.body).to.deep.equal({
              error: "no_error_page",
              error_code: "AE005",
              error_description:
                "[AE005] Failed to fetch the error page from the tenant settings"
            });
            done();
          });
      });

      it("missing error page", done => {
        getTenantSettingsStub.resolves({});
        const allowlistData = [
          {
            clientName: "client name",
            patterns: ["https://url1.com"]
          }
        ];

        request(app)
          .put("/api")
          .send(allowlistData)
          .expect(400)
          .end((err, res) => {
            if (err) return done(err);
            expect(res.body).to.deep.equal({
              error: "no_error_page",
              error_code: "AE005",
              error_description:
                "[AE005] Failed to fetch the error page from the tenant settings"
            });
            done();
          });
      });
    });
  });

  describe("GET /api", () => {
    it("Should get valid allowlist", done => {
      const expectedAllowlist = [
        {
          clientName: "client name",
          loginUrl: "https://url1.com/login",
          patterns: ["https://url1.com/withPath*", "https://url1.com"]
        },
        {
          clientName: "client name 3",
          loginUrl: "https://url3.com/login",
          patterns: [
            "https://url1.com/otherPath*",
            "https://url3.com/withPath*"
          ]
        },
        {
          clientName: "client 2",
          patterns: ["https://url2.com?*"]
        },
        {
          clientName: "a long client name",
          loginUrl:
            "https://some.really.long.url.not.long.enough.com:12345/login",
          patterns: [
            "https://some.really.long.url.not.long.enough.com:12345",
            "https://some.really.long.url.not.long.enough.com:12345/*",
            "https://some.really.long.url.not.long.enough.com:12345?*"
          ]
        }
      ];

      const hostToPattern = {
        "https://url1.com": [
          {
            clientName: "client name",
            loginUrl: "/login",
            patterns: ["/withPath*", ""]
          },
          {
            clientName: "client name 3",
            loginUrl: "https://url3.com/login",
            patterns: ["/otherPath*"]
          }
        ],
        "https://url2.com": [
          {
            clientName: "client 2",
            patterns: ["?*"]
          }
        ],
        "https://url3.com": [
          {
            clientName: "client name 3",
            loginUrl: "/login",
            patterns: ["/withPath*"]
          }
        ],
        "https://some.really.long.url.not.long.enough.com:12345": [
          {
            clientName: "a long client name",
            loginUrl: "/login",
            patterns: ["", "/*", "?*"]
          }
        ]
      };

      storage.read.resolves({ hostToPattern });
      request(app)
        .get("/api")
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);

          expect(res.body).to.deep.equal(expectedAllowlist);
          done();
        });
    });

    it("Should get valid allowlist", done => {
      storage.read.resolves();
      request(app)
        .get("/api")
        .expect(200)
        .end((err, res) => {
          if (err) return done(err);

          expect(res.body).to.deep.equal([]);
          done();
        });
    });
  });

  describe("PUT /api/errorPage", () => {
    describe("tenant settings working", () => {
      const expectedHostToPattern = { someKey: "someValue" };
      beforeEach(() => {
        storage.read.resolves({ hostToPattern: expectedHostToPattern });
        storage.write.resolves();
        sinon.resetHistory();
      });

      it("good error page", done => {
        getTenantSettingsStub.resolves({ error_page: { url: errorPageUrl } });
        const allowlistData = [
          {
            clientName: "client name",
            patterns: ["https://url1.com"]
          }
        ];

        request(app)
          .put("/api/errorPage")
          .send(allowlistData)
          .expect(204)
          .end(err => {
            if (err) return done(err);

            expect(storage.write).to.have.been.calledWithExactly({
              errorPage: errorPageUrl,
              hostToPattern: expectedHostToPattern
            });
            done();
          });
      });
    });

    describe("tenant settings failing", () => {
      beforeEach(() => {
        storage.read.resolves({});
        storage.write.resolves();
        sinon.resetHistory();
      });

      it("missing error page", done => {
        getTenantSettingsStub.resolves({ error_page: {} });
        const allowlistData = [
          {
            clientName: "client name",
            patterns: ["https://url1.com"]
          }
        ];

        request(app)
          .put("/api/errorPage")
          .send(allowlistData)
          .expect(400)
          .end((err, res) => {
            if (err) return done(err);
            expect(res.body).to.deep.equal({
              error: "no_error_page",
              error_code: "AE005",
              error_description:
                "[AE005] Failed to fetch the error page from the tenant settings"
            });
            done();
          });
      });

      it("invalid error page", done => {
        getTenantSettingsStub.resolves({
          error_page: { url: "https://host.domain:1423garbage" }
        });
        request(app)
          .put("/api/errorPage")
          .expect(400)
          .end((err, res) => {
            if (err) return done(err);
            expect(res.body).to.deep.equal({
              error: "bad_error_page",
              error_code: "AE004",
              error_description:
                "[AE004] Bad error page https://host.domain:1423garbage because: Invalid URL: https://host.domain:1423garbage"
            });
            done();
          });
      });

      it("call to get error rejects", done => {
        const error = new Error("bad call to get error page");
        getTenantSettingsStub.rejects(error);
        request(app)
          .put("/api/errorPage")
          .expect(500)
          .end((err, res) => {
            if (err) return done(err);
            expect(res.body).to.deep.equal({
              error: "internal_error",
              error_code: "IE003",
              error_description: "[IE003] Internal Server Error"
            });
            done();
          });
      });
    });

    describe("bad webtask storage", () => {
      beforeEach(() => {
        storage.read.resolves({});
        getTenantSettingsStub.resolves({ error_page: { url: errorPageUrl } });
        sinon.resetHistory();
      });

      it("should fail with special message for 409 errors", done => {
        const error = new Error("special 409");
        error.code = 409;
        storage.write.rejects(error);

        request(app)
          .put("/api/errorPage")
          .send([])
          .expect(409)
          .end((err, res) => {
            if (err) return done(err);

            expect(res.body.error).to.equal("update_conflict");
            expect(res.body.error_description).to.equal(
              "[AE001] Can not override conflicting update, ensure you have the latest data and retry"
            );
            done();
          });
      });

      it("should fail with generic error for non 409 errors", done => {
        const error = new Error("some other error");
        storage.write.rejects(error);

        request(app)
          .put("/api/errorPage")
          .send([])
          .expect(500)
          .end((err, res) => {
            if (err) return done(err);

            expect(res.body.error).to.equal("internal_error");
            expect(res.body.error_description).to.equal(
              "[IE002] Internal Server Error"
            );
            done();
          });
      });
    });
  });
});
