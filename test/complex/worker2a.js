const cluster = require("node:cluster");

if (cluster.isSpawn) {

    cluster.thread.onEvent("clusterReady", () => {
        console.log("spawn: cluster is ready (worker2a)");
    });

    cluster.thread.onEvent("test", () => {
        console.log("spawn: test event received (worker2a)");
        cluster.thread.sendEvent("worker1a:test");
    });
}
