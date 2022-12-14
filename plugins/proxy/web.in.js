const { pipeline } = require("node:stream");
const shared = require("./shared.js");
const followRedirects = require("follow-redirects");
const nativeAgents = { http: require("node:http"), https: require("node:https") };

let outgoing = require("./web.out.js");
outgoing = Object.keys(outgoing).map(pass => outgoing[pass]);

module.exports = {
    /**
     * Sets `content-length` to '0' if request is of DELETE type.
     * @param {ClientRequest} req Request object
     * @param {IncomingMessage} res Response object
     * @param {object} options Config object passed to the proxy
     */
    deleteLength(req, res, options) {
        if((req.method === "DELETE" || req.method === "OPTIONS") && !req.headers["content-length"]) {
            req.headers["content-length"] = "0";
            delete req.headers["transfer-encoding"];
        }
    },
    /**
     * Sets timeout in request socket if it was specified in options.
     * @param {ClientRequest} req Request object
     * @param {IncomingMessage} res Response object
     * @param {object} options Config object passed to the proxy
     */
    timeout(req, res, options) {
        if(options.timeout) {
            req.socket.setTimeout(options.timeout);
        }
    },
    /**
     * Sets `x-forwarded-*` headers if specified in config.
     * @param {ClientRequest} req Request object
     * @param {IncomingMessage} res Response object
     * @param {object} options Config object passed to the proxy
     */
    XHeaders(req, res, options) {
        if(!options.xfwd) return;
        const encrypted = req.isSpdy || shared.hasEncryptedConnection(req);
        const values = {
            for: req.connection.remoteAddress || req.socket.remoteAddress,
            port: shared.getPort(req),
            proto: encrypted ? "https" : "http"
        };
        ["for", "port", "proto"].forEach(header =>
            req.headers["x-forwarded-" + header] =
                (req.headers["x-forwarded-" + header] || '') +
                (req.headers["x-forwarded-" + header] ? "," : '') +
                values[header]
        );
        req.headers["x-forwarded-host"] = req.headers["x-forwarded-host"] || req.headers["host"] || '';
    },
    /**
     * Does the actual proxying. If `forward` is enabled fires up a ForwardStream,
     * same happens for ProxyStream. The request just dies otherwise.
     * @param {ClientRequest} req Request object
     * @param {IncomingMessage} res Response object
     * @param {Object} options Config object passed to the proxy
     * @param [head]
     * @param [server]
     * @param [clb]
     */
    stream(req, res, options, head, server, clb) {
        // And we begin!
        server.emit("start", req, res, options.target || options.forward);

        const { http, https } = options.followRedirects ? followRedirects : nativeAgents;

        if(options.forward) {
            // If forward enable, so just pipe the request
            const forwardReq = (options.forward.protocol === "https:" ? https : http)
                .request(shared.setupOutgoing(options.ssl || {}, options, req, "forward"));

            // error handler (e.g. ECONNRESET, ECONNREFUSED)
            // Handle errors on incoming request as well as it makes sense to
            const forwardError = createErrorHandler(forwardReq, options.forward);
            req.on("error", forwardError);
            forwardReq.on("error", forwardError);

            pipeline(options.buffer || req, forwardReq, () => {});
            if (!options.target) return res.end();
        }

        // Request initalization
        const proxyReq = (options.target.protocol === "https:" ? https : http)
            .request(shared.setupOutgoing(options.ssl || {}, options, req));

        // Enable developers to modify the proxyReq before headers are sent
        proxyReq.on("socket", function(socket) {
            if (server && !proxyReq.getHeader("expect")) {
                server.emit("proxyReq", proxyReq, req, res, options);
            }
        });

        // allow outgoing socket to timeout so that we could
        // show an error page at the initial request
        if(options.proxyTimeout) {
            proxyReq.setTimeout(options.proxyTimeout, function() {
                proxyReq.destroy();
            });
        }

        // Ensure we abort proxy if request is aborted
        res.on("close", function() {
            if (!res.writableFinished)
                proxyReq.destroy();
        });

        // handle errors in proxy and incoming request, just like for forward proxy
        const proxyError = createErrorHandler(proxyReq, options.target);
        req.on("error", proxyError);
        proxyReq.on("error", proxyError);

        function createErrorHandler(proxyReq, url) {
            return function proxyError(err) {
                if (req.socket.destroyed && err.code === "ECONNRESET") {
                    server.emit("econnreset", err, req, res, url);
                    return proxyReq.abort();
                }
                if (clb) {
                    clb(err, req, res, url);
                } else {
                    server.emit("error", err, req, res, url);
                }
            }
        }

        pipeline(options.buffer || req, proxyReq, () => {});

        proxyReq.on("response", proxyRes => {
            if(server) server.emit("proxyRes", proxyRes, req, res);

            if(!res.headersSent && !options.selfHandleResponse) {
                for(let i = 0; i < outgoing.length; i++) {
                    if(outgoing[i](req, res, proxyRes, options)) break;
                }
            }

            if (!res.finished) {
                // Allow us to listen when the proxy has completed
                proxyRes.on("end", () => {
                    if (server) server.emit("end", req, res, proxyRes);
                });
                // We pipe to the response unless its expected to be handled by the user
                if (!options.selfHandleResponse) pipeline(proxyRes, res, () => {});
            } else {
                if (server) server.emit("end", req, res, proxyRes);
            }
        });
    }
};
