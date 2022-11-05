const cluster = require("node:cluster");

if (cluster.isSpawn) {

    cluster.thread.onEvent("clusterReady", () => {
        console.log("spawn: cluster is ready (worker1a)");
        cluster.thread.sendEvent("worker2a:test");
    });

    cluster.thread.onEvent("test", () => {
        console.log("spawn: test event received (worker1a)");
    });
}
