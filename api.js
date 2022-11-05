const { serverMode, executeOption } = require("./config/server.js");

function bindRoutes(app) {
    //app.use("/api/xxxx", require("./routes/xxxx.js"));
}

module.exports = serverMode !== executeOption.cluster ? bindRoutes : port => {
    const cluster = require("node:cluster");

    if (cluster.isSpawn) {
        const express = require("express");

        const app = new express();

        app.use(express.logger("dev"));
        app.use(express.compression());

        bindRoutes(app);

        app.listen(port);
    }
};
