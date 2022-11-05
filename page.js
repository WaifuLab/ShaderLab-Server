const { serverMode, executeOption } = require("./config/server.js");
const { static, views } = require("express");
const path = require("node:path");

function bindResource(app) {
    app.use(static(path.join(__dirname, "static")));
    app.use(views(path.join(__dirname, "views")));
}

module.exports = serverMode !== executeOption.cluster ? bindResource : port => {
    const cluster = require("node:cluster");

    if (cluster.isSpawn) {
        const { express, logger, compression } = require("express");

        const app = new express();

        app.use(logger("dev"));
        app.use(compression());

        bindResource(app);

        app.listen(port);
    }
}
