const cluster = require("node:cluster");

const { formatSize } = require("../../utils/size.js");
const events = require("../../plugins/thread/events.js");

const max = 100;
const myName = process.env.FORKNAME;

let received = 0, dataSent, counter, data;
let timeStart, timeEnd, timeDiff;

const waitForAllEventsReceived = () => {
    if (received < max) {
        setTimeout(waitForAllEventsReceived, 100);
    } else {
        events.client.disconnect(() => {
            timeEnd = performance.now();
            timeDiff = (timeEnd - timeStart) / 1000;
            process.send(`${myName}: ${received} events received back`);
            process.send(`${myName}: recv avg speed ${formatSize(Math.round(dataSent / timeDiff), true)}/s`);
            process.exit();
        });
    }
}

if (cluster.isMaster) {
    events.server.start(err => {
        if (err) throw new Error(err);
        const worker = cluster.fork({ FORKNAME: "TCP transform"  });
        worker.on("exit", () => {
            console.log("exit");
            events.server.stop(() => process.exit());
        });
        worker.on("message", message => {
            console.log(message);
        });
    })
} else {
    events.on("foo", () => received++);
    events.on("error", err => console.log(err));
    events.client.connect({ forkId: myName }, err => {
        process.send("connected");
        if (err) throw new Error(err);
        counter = 0;
        dataSent = 0;
        timeStart = performance.now();
        while (counter < max) {
            data = { foo: "bar", i: ++counter };
            dataSent += events.client.send("foo", data);
        }
        timeEnd = performance.now();
        timeDiff = (timeEnd - timeStart) / 1000;
        process.send("data sent");
        process.send(`${myName}: ${max} events sent in ${timeDiff.toFixed(3)} sec`);
        process.send(`${myName}: send avg speed ${formatSize(Math.round(dataSent / timeDiff), true)}/s`);
        waitForAllEventsReceived();
    });
}
