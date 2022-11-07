const debug = require("debug")("thread:events");
const { createServer, Socket } = require("node:net");
const { EventEmitter } = require("node:events");
const JsonSocket = require("json-socket");

const eventEmitter = new EventEmitter();

const defaultOptions = {
    tcpPortToMaster: 10565,
    tcpPortFromMaster: 10656,
    tcpIp: "127.0.0.1",
    verbose: false /*debug feature*/
};

let clients = {};
let serverOptions,
    serverWrite, serverRead;

/**
 * Send event {@link sendToClient} to every client.
 * @param {string} eventName
 * @param {object} payload
 */
function sendToEveryClients(eventName, payload) {
    debug("sendToEveryClients: %s", eventName);
    eventEmitter.emit(eventName, eventName, payload);
    for (const forkId in clients) {
        sendToClient(forkId, eventName, payload);
    }
}

/**
 * Send event to target client.
 * @param {number} forkId
 * @param {string} eventName
 * @param {object} payload
 */
function sendToClient(forkId, eventName, payload) {
    debug("sendToClient: sending %s to %s", eventName, forkId);
    if (forkId === "master") { eventEmitter.emit(eventName, eventName, payload); return; }
    if (!clients[forkId] || !clients[forkId].readSocket) return;
    clients[forkId].readSocket.sendMessage({ eventName, payload });
}

/**
 * Data receive from data.
 * @param {object} data
 */
function onDataReceived(data) {
    debug("%s: onDataReceived: %o", this.socket.type, data);
    if (data.eventName) {
        const event = data.eventName.split(":");
        if (event.length > 1) {
            if (!data.payload) data.payload = {};
            data.payload._emitter = this.socket._forkId;
            sendToClient(event[0], event[1], data.payload);
            return;
        }
        sendToEveryClients(data.eventName, data.payload);
    } else if (data.link) {
        this.socket._forkId = data.link;
        this.dup._forkId = data.link;
        clients[data.link] = clients[data.link] || {};
        switch (this.socket.type) {
            case "write":
                clients[data.link].writeSocket = this.dup;
                break;
            case "read":
                clients[data.link].readSocket = this.dup;
                break;
        }
        if (!this.dup) return;
        this.dup.sendMessage({ link: true });
    } else if (data.unlink) {
        if (clients[this.socket._forkId])
            clients[this.socket._forkId].quitting = true;
        if (!this.dup) return;
        this.dup.sendMessage({ unlink: true });
    }
}

function onClientConnected(socket, socketType) {
    debug("%s: onClientConnected: client connected", socketType);
    socket.on("close", () => delete clients[socket._forkId]);
    socket.on("error", err => {
        if (!socket._forkId) return;
        if (!clients[socket._forkId]) return;
        if (err.message.match(/ECONNRESET/)) delete clients[socket._forkId];
    });
    let dup = new JsonSocket(socket);
    dup.on("message", onDataReceived.bind({ dup, socket }));
    dup.type = socketType;
    socket.type = socketType;
}

const server = {
    /**
     * Start event server.
     * @param {object|function} opts
     * @param {function} [callback]
     */
    start(opts, callback) {
        if (typeof opts === "function") { callback = opts; opts = {}; }
        process.on("exit", server.stop);
        serverOptions = { ...defaultOptions, ...opts };
        serverRead = createServer(socket => onClientConnected(socket, "read"));
        serverWrite = createServer(socket => onClientConnected(socket, "write"));
        debug("start: server listening (read on %s:%s)", serverOptions.tcpIp, serverOptions.tcpPortToMaster);
        serverRead.listen(serverOptions.tcpPortToMaster, serverOptions.tcpIp, err => { if (err && callback) callback(err); });
        debug("start: server listening (write on %s:%s)", serverOptions.tcpIp, serverOptions.tcpPortFromMaster);
        serverWrite.listen(serverOptions.tcpPortFromMaster, serverOptions.tcpIp, callback);
    },
    /**
     * Stop connection.
     * @param {function} callback
     */
    stop(callback) {
        debug("stopping", serverOptions.tcpIp, serverOptions.tcpPortFromMaster);
        for (const forkId in clients) {
            clients[forkId].writeSocket.end();
            clients[forkId].readSocket.end();
        }
        serverRead.close();
        serverWrite.close();
        callback && typeof callback == "function" && callback();
    },
    /**
     * Send an event.
     * @param {string} eventName
     * @param {object} payload
     */
    send(eventName, payload) {
        const event = eventName.split(":");
        if (event.length > 1) {
            sendToClient(event[0], event[1], payload); // to a particular fork
        } else {
            sendToEveryClients(eventName, payload); // or to every clients, include master
        }
    }
};

eventEmitter.server = server;

let clientOptions,
    socketWrite, socketRead,
    pipeWrite, pipeRead,
    connectCallback, disconnectCallback;

/**
 * Trigger register event or use register method.
 * @param {object} data
 */
function onDataReceive(data) {
    if (data.eventName) {
        debug('%s: onDataReceived: "%s": received data %o', this.type, clientOptions.forkId, data);
        eventEmitter.emit(data.eventName, data.eventName, data.payload);
    } else if (data.link) {
        debug('%s: onDataReceived: "%s": received link ack', this.type, clientOptions.forkId);
        connectCallback && !connectCallback.alreadyFired && (connectCallback.alreadyFired = true) && connectCallback();
    } else if (data.unlink) {
        debug('%s: onDataReceived: "%s": received unlink ack', this.type, clientOptions.forkId);
        disconnectCallback && !disconnectCallback.alreadyFired && (disconnectCallback.alreadyFired = true) && disconnectCallback();
    }
}

/**
 * Connect to the master process.
 * @param {function} callback
 */
function connectToMasterProcess(callback) {
    socketWrite = new JsonSocket(new Socket());
    socketRead = new JsonSocket(new Socket());

    socketWrite.type = "write";
    socketRead.type = "read";

    socketWrite.connect(clientOptions.tcpPortToMaster, clientOptions.tcpIp);
    socketRead.connect(clientOptions.tcpPortFromMaster, clientOptions.tcpIp);

    socketWrite.on("connect", () => {
        pipeWrite = socketWrite;
        pipeWrite.on("message", onDataReceive.bind(socketWrite));
        pipeWrite.sendMessage({ link: clientOptions.forkId, pid: clientOptions.pid });
    });
    socketRead.on("connect", () => {
        pipeRead = socketRead;
        pipeRead.on("message", onDataReceive.bind(socketRead));
        connectCallback = callback;
        pipeRead.sendMessage({ link: clientOptions.forkId, pid: clientOptions.pid });
    });
}

const client = {
    /**
     * Connect event server.
     * @param {object|function} opts
     * @param {function} callback
     */
    connect(opts, callback) {
        if (typeof opts === "function") { callback = opts; opts = {}; }
        clientOptions = { ...defaultOptions, ...opts };
        connectToMasterProcess(callback);
    },
    /**
     * Disconnect event server.
     * @param {function} callback
     */
    disconnect(callback) {
        disconnectCallback = callback;
        if (pipeWrite) pipeWrite.sendMessage({ unlink: true });
        if (pipeRead) pipeRead.sendMessage({ unlink: true });
        setTimeout(() => {
            socketWrite.end();
            socketRead.end();
        }, 500);
    },
    /**
     * Send event to server.
     * @param {string} eventName
     * @param {object} payload
     * @return {number}
     */
    send(eventName, payload) {
        const event = eventName.split(":");
        if (event.length > 1 && event[0] === clientOptions.forkId)
            return eventEmitter.emit(event[1], eventName, payload);
        const data = { eventName, payload };
        if (pipeWrite) pipeWrite.sendMessage(data);
        return JSON.stringify(data).length;
    }
};

eventEmitter.client = client;

const temp = eventEmitter.on;

eventEmitter.on = function(eventName, fnc) {
    if (typeof eventName == "object") {
        eventName.forEach(event => temp.apply(eventEmitter, [Object.keys(event)[0], event[Object.keys(event)[0]]]));
        return;
    }
    temp.apply(eventEmitter, [eventName, fnc]);
};

module.exports = eventEmitter;
