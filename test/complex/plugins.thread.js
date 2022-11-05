const thread = require("../../plugins/thread")(__filename);
const cluster = require("node:cluster");

if (require.main === module) {
    if (cluster.isMain) {
        cluster.onEvent(thread.EV_READY, () => {
            console.log("main: ready event received");
        });
        cluster.onEvent(thread.EV_ERROR, (ev, error) => {
            console.log("main: error event received");
            console.log(error);
            process.exit();
        });
        cluster.onEvent(thread.EV_SPAWNED, (ev, data) => {
            console.log("main: spawned event received");
            //assert.equal(data._emitter, "worker1");
            console.log("main: spawned event emitter should match worker id");
            //assert.equal(data.forks, 2);
            console.log("main: number of forks(s) should match worker settings");
            console.log(data);
        });
    }

    if (cluster.isSpawn) {
        cluster.onEvent(thread.EV_SPAWNED, () => {
            console.log(`spawn: spawned event received (${cluster.cid})`);
        });
        cluster.onEvent(thread.EV_FORKED,() => {
            console.log(`spawn: fork event received (${cluster.cid})`);
        });
    }

    thread.start({
        "worker1a": {
            maxForks:2
        },
        "worker2a": {
            maxForks:2,
            params: ["function"]
        }
    });

    setTimeout(() => process.nextTick(() => process.exit(0)), 10000);

}
