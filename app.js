const debug = require("debug")("shaderlab:app");
const { serverMode, executeOption } = require("./config/server.js");

if (serverMode !== executeOption.cluster) {
    const app = require("./base.js");

    require("./page.js")(app);
    require("./api.js")(app);

    module.exports = app;
    module.exports.app = app;
} else {
    const { clusterConfig } = require("./config/server");
    const thread = require("./plugins/thread")(__filename);
    const cluster = require("node:cluster");

    if (cluster.isMain) {
        cluster.onEvent(thread.EV_ERROR, (ev, error) => {
            debug("error event received %s", error);
            process.exit();
        });
    }

    thread.start(clusterConfig.workers);
}
