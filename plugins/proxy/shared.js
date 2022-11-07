const { parse } = require("node:url");

const UPGRADE_HEADER = /(^|,)\s*upgrade\s*($|,)/i;

const shared = {
    isSSL: /^https|wss/,
    /**
     * Copies the right headers from `options` and `req` to `outgoing` which is then used to fire the proxied request.
     * @example
     *    shared.setupOutgoing(outgoing, options, req)
     *    // => { host: ..., hostname: ...}
     * @param {object} outgoing Base object to be filled with required properties
     * @param {object} options Config object passed to the proxy
     * @param {ClientRequest} req Request Object
     * @param {string} forward String to select forward or target
     * @return {object} Outgoing Object with all required properties set
     */
    setupOutgoing(outgoing, options, req, forward) {
        outgoing.port = options[forward || "target"].port ||
                        (shared.isSSL.test(options[forward || "target"].protocol) ? 443 : 80);
        ["host", "hostname", "socketPath", "pfx", "key", "passphrase", "cert",
            "ca", "ciphers", "secureProtocol"].forEach(e => outgoing[e] = options[forward || "target"][e]);

        outgoing.method = options.method || req.method;
        outgoing.headers = Object.assign({}, req.headers);

        if (options.headers) Object.assign(outgoing.headers, options.headers);

        if (options.auth) outgoing.auth = options.auth;

        if (options.ca) outgoing.ca = options.ca;

        if (shared.isSSL.test(options[forward || "target"].protocol))
            outgoing.rejectUnauthorized = (typeof options.secure === "undefined") ? true : options.secure;

        outgoing.agent = options.agent || false;
        outgoing.localAddress = options.localAddress;

        if (!outgoing.agent) {
            outgoing.headers = outgoing.headers || {};
            if (typeof outgoing.headers.connection !== "string" || !UPGRADE_HEADER.test(outgoing.headers.connection)) {
                outgoing.headers.connection = "close";
            }
        }

        // the final path is target path + relative path requested by user:
        const target = options[forward || "target"];
        const targetPath = target && options.prependPath !== false ? (target.path || '') : '';

        let outgoingPath = !options.toProxy ? (parse(req.url).path || '') : req.url;
        outgoingPath = !options.ignorePath ? outgoingPath : '';

        outgoing.path = shared.urlJoin(targetPath, outgoingPath);

        if (options.changeOrigin) {
            outgoing.headers.host =
                required(outgoing.port, options[forward || "target"].protocol) && !hasPort(outgoing.host)
                    ? outgoing.host + ":" + outgoing.port : outgoing.host;
        }
        return outgoing;
    },
    /**
     * Set the proper configuration for sockets, set no delay and set keep alive, also set the timeout to 0.
     * @example
     *    shared.setupSocket(socket)
     *    // => Socket
     * @param {Socket} socket instance to setup
     * @return {Socket} Return the configured socket.
     */
    setupSocket(socket) {
        socket.setTimeout(0);
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 0);
        return socket;
    },
    /**
     * Get the port number from the host. Or guess it based on the connection type.
     * @param {Request} req Incoming HTTP request.
     * @return {String} The port number.
     */
    getPort(req) {
        const res = req.headers.host ? req.headers.host.match(/:(\d+)/) : '';
        return res ? res[1] : shared.hasEncryptedConnection(req) ? "443" : "80";
    },
    /**
     * Check if the request has an encrypted connection.
     * @param {Request} req Incoming HTTP request.
     * @return {boolean} Whether the connection is encrypted or not.
     */
    hasEncryptedConnection(req) {
        return Boolean(req.connection.encrypted || req.connection.pair);
    },
    /**
     * OS-agnostic join (doesn't break on URLs like path.join does on Windows)>
     * @return {string} The generated path.
     */
    urlJoin() {
        let args = Array.prototype.slice.call(arguments), lastIndex = args.length - 1, lastSegs = args[lastIndex].split("?");
        args[lastIndex] = lastSegs.shift();
        let retSegs = [args.filter(Boolean).join("/")
            .replace(/\/+/g, "/")
            .replace("http:/", "http://")
            .replace("https:/", "https://")];
        retSegs.push.apply(retSegs, lastSegs);
        return retSegs.join("?")
    },
    /**
     * Rewrites or removes the domain of a cookie header
     * @param {string|string[]} header
     * @param {object} config, mapping of domain to rewritten domain.
     *                 "*" key to match any domain, null value to remove the domain.
     * @param {string} property
     */
    rewriteCookieProperty(header, config, property) {
        return Array.isArray(header)
            ? header.map(headerElement => {
                return shared.rewriteCookieProperty(headerElement, config, property);
            })
            : header.replace(new RegExp("(;\\s*" + property + "=)([^;]+)", "i"), (match, prefix, previousValue) => {
                let newValue;
                if (previousValue in config) {
                    newValue = config[previousValue];
                } else if ("*" in config) {
                    newValue = config["*"];
                } else return match;
                return newValue ? prefix + newValue : '';
            });
    }
}

/**
 * Check the host and see if it potentially has a port in it (keep it simple)
 * @returns {boolean} Whether we have one or not
 */
function hasPort(host) {
    return !!~host.indexOf(":");
}

function required(port, protocol) {
    port = +port;
    if (!port) return false;
    switch (protocol.split(":")[0]) {
        case "http":    case "ws":  return port !== 80;
        case "https":   case "wss": return port !== 443;
        case "ftp":                 return port !== 21;
        case "gopher":              return port !== 70;
        case "file":                return false;
    }
    return port !== 0;
}

module.exports = shared;
