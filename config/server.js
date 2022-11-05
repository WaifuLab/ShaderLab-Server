var executeOption = (mode => {
    mode[mode["debug"] = 0] = "debug";
    mode[mode["single"] = 1] = "single";
    mode[mode["cluster"] = 2] = "cluster";
    return mode;
})(executeOption || (executeOption = {}));

let serverModeCache = executeOption[process.env["SERVER_MODE"]] ??
                      process.env["NODE_ENV"] !== "production" ? executeOption.debug : executeOption.cluster;

const workersCache = {}, rulesCache = {};

const config = {
    executeOption,

    /**
     * Measure the level of execute mode based on {@link executeOption}.
     * - when <1 -> debug all, inject data.
     * - when >0 -> debug none, inject root data.
     * @type {number} the level of execute option
     */
    get serverMode() {
        return serverModeCache;
    },

    /**
     * Set up server mode.
     * @param {number} mode
     */
    set serverMode(mode) {
        serverModeCache = mode;
    },

    /**
     * Cluster general configuration.
     * Note: Cannot use workers and rules as thread name.
     */
    clusterConfig: {
        page: {
            prefix: "default",
            maxForks: "2",
            port: 8080
        },
        api: {
            prefix: "/api",
            maxForks: "2",
            port: 8000
        },
        get workers() {
            return workersCache;
        },
        get rules() {
            return rulesCache;
        }
    },

    /**
     * Resolve proxy rules from rules table current.
     * @example
     * "/example": "http://xxx",
     * "/example": "http://xxx/a",
     * "/example/id/([0-9]+)/data/([0-9]+)": "http://xxx/a/$1/b/$2"
     * @param {IncomingMessage} req
     * @param {{raw: string, target: string}} rules a set of rules for resolve.
     * @return {string}
     */
    resolveProxy(req, rules) {
        let path = req.url, target = rules["default"];
        for (const pathPrefix in rules) {
            const pathEndSlash = pathPrefix.slice(-1)  === "/";
            const testPrefixMatch = new RegExp(pathEndSlash ? pathPrefix : `(${pathPrefix})(?:\\W|$)`).exec(path);
            if (testPrefixMatch && testPrefixMatch.index === 0) {
                req.url = path.replace(testPrefixMatch[pathEndSlash ? 0 : 1], '');
                target = rules[pathPrefix];
                for (let i = 0; i < testPrefixMatch.length; i++)
                    target = target.replace("$" + i, testPrefixMatch[i + (pathEndSlash ? 0 : 1)]);
                break;
            }
        }
        return target;
    }
}

for (const [key, value] of Object.entries(config.clusterConfig)) {
    if (key === "workers" || key === "rules") continue;
    workersCache[key] = { maxForks: value.maxForks, params: [value.port] };
    rulesCache[value.prefix] = `http://127.0.0.1:${value.port}${value.prefix === "default" ? '' : value.prefix}`;
}

module.exports = config;
module.exports.config = config;
