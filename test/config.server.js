const config = require("../config/server.js");
const assert = require("node:assert");

describe("Server configure test", () => {
    describe("Server mode test", () => {
        it("should get default server mode", () => {
            assert.strictEqual(config.executeOption.debug, 0);
            assert.strictEqual(config.serverMode, config.executeOption.debug);
        });
        it("should set server mode", () => {
            config.serverMode = 2;
            assert.strictEqual(config.executeOption.cluster, 2);
            assert.strictEqual(config.serverMode, config.executeOption.cluster);
        });
    });
    describe("Resolve Proxy test", () => {
        const defaultUrl = "http://127.0.0.1", targetPort = 8080;
        const data = {
            default: ["nothing to match", `${defaultUrl}:${targetPort}`],
            ".*/testA": ["/LONGTEXT/testA", `${defaultUrl}:${targetPort}/testA`],
            ".*/testB/": ["/LONGTEXT/testB/", `${defaultUrl}:${targetPort}/testB/`],
            "/testC": ["/testC", `${defaultUrl}:${targetPort}/testC`],
            "/testD": ["/testD?foo=bar", `${defaultUrl}:${targetPort}/testD?foo=bar`],
            "/testE/id/([0-9]+)/data/([0-9]+)": ["/testE/id/2/data/233", `${defaultUrl}:${targetPort}/a/2/b/233`],
            "/testF/id/([0-9]+)/data/([0-9]+)/": ["/testF/id/2/data/233/", `${defaultUrl}:${targetPort}/a/2/b/233/`]
        };
        const rules = Object.keys(data).reduce((value, key) => { value[key] = data[key][1]; return value; }, {});
        for (const [raw, target] of Object.entries(data)) {
            it(`should return resolved url ${raw}`, () => {
                const proxyTarget = config.resolveProxy({ url: target[0] }, rules);
                assert.strictEqual(proxyTarget, target[1]);
            });
        }
    });
});
