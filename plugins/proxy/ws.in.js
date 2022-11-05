const http = require("node:http");
const https  = require("node:https");
const { pipeline } = require("node:stream");
const shared = require("./shared.js");

module.exports = {
    /**
     * WebSocket requests must have the `GET` method and the `upgrade:websocket` header
     * @param {ClientRequest} req Request object
     * @param {Socket} socket
     */
    checkMethodAndHeader(req, socket) {
        if (req.method !== "GET" || !req.headers.upgrade) {
            socket.destroy();
            return true;
        }
        if (req.headers.upgrade.toLowerCase() !== "websocket") {
            socket.destroy();
            return true;
        }
    },
    /**
     * Sets `x-forwarded-*` headers if specified in config.
     * @param {ClientRequest} req Request object
     * @param {Socket} socket
     * @param {object} options Config object passed to the proxy
     */
    XHeaders(req, socket, options) {
        if(!options.xfwd) return;
        const values = {
            for: req.connection.remoteAddress || req.socket.remoteAddress,
            port: shared.getPort(req),
            proto: shared.hasEncryptedConnection(req) ? "wss" : "ws"
        };
        ["for", "port", "proto"].forEach(header => {
            req.headers["x-forwarded-" + header] =
                (req.headers["x-forwarded-" + header] || '') +
                (req.headers["x-forwarded-" + header] ? "," : '') +
                values[header];
        });
    },
    /**
     * Does the actual proxying. Make the request and upgrade it send the Switching Protocols request and pipe the sockets.
     * @param {ClientRequest} req Request object
     * @param {Socket} socket
     * @param {Object} options Config object passed to the proxy
     * @param [head]
     * @param [server]
     * @param [clb]
     */
    stream(req, socket, options, head, server, clb) {
        const createHttpHeader = function(line, headers) {
            return Object.keys(headers).reduce((head, key) => {
                const value = headers[key];
                if (!Array.isArray(value)) {
                    head.push(key + ": " + value);
                    return head;
                }
                for (let i = 0; i < value.length; i++) {
                    head.push(key + ": " + value[i]);
                }
                return head;
            }, [line]).join("\r\n") + "\r\n\r\n";
        };

        shared.setupSocket(socket);

        if (head && head.length) socket.unshift(head);

        const proxyReq = (shared.isSSL.test(options.target.protocol) ? https : http)
            .request(shared.setupOutgoing(options.ssl || {}, options, req));

        // Enable developers to modify the proxyReq before headers are sent
        if (server) server.emit("proxyReqWs", proxyReq, req, socket, options, head);

        // Error Handler
        proxyReq.on("error", onOutgoingError);
        proxyReq.on("response", res => {
            // if upgrade event isn't going to happen, close the socket
            if (!res.upgrade && socket.readyState !== "closed") {
                socket.write(createHttpHeader("HTTP/" + res.httpVersion + ' ' + res.statusCode + ' ' + res.statusMessage, res.headers));
                pipeline(res, socket, () => {});
            }
        });

        proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
            proxySocket.on("error", onOutgoingError);

            // Allow us to listen when the websocket has completed
            proxySocket.on("end", () => {
                server.emit("close", proxyRes, proxySocket, proxyHead);
            });

            socket.on("error", () => {
                proxySocket.end();
            });

            shared.setupSocket(proxySocket);

            if (proxyHead && proxyHead.length) proxySocket.unshift(proxyHead);

            socket.write(createHttpHeader("HTTP/1.1 101 Switching Protocols", proxyRes.headers));

            pipeline(proxySocket, socket, () => {});
            pipeline(socket, proxySocket, () => {});

            server.emit("open", proxySocket);
            server.emit("proxySocket", proxySocket);
        });

        return proxyReq.end();

        function onOutgoingError(err) {
            if (clb) {
                clb(err, req, socket);
            } else {
                server.emit("error", err, req, socket);
            }
            socket.end();
        }
    }
};
