const EventEmitter = require("node:events");
const https = require("node:https");
const http = require("node:http");
const { parse } = require("node:url");
const web = require("./web.in.js");
const ws = require("./ws.in.js");

class ProxyServer extends EventEmitter {
    constructor(options = {}) {
        super();
        options.prependPath = options.prependPath !== false;

        this.web = this.proxyRequest          = createRightProxy("web")(options);
        this.ws  = this.proxyWebsocketRequest = createRightProxy("ws")(options);
        this.options = options;

        this.webPasses = Object.keys(web).map(pass => web[pass]);
        this.wsPasses = Object.keys(ws).map(pass => ws[pass]);
    }

    listen(port, hostname) {
        const self = this, closure = (req, res) => this.web(req, res);
        this._server  = this.options.ssl ? https.createServer(this.options.ssl, closure) : http.createServer(closure);
        if(this.options.ws)
            this._server.on("upgrade", (req, socket, head) => self.ws(req, socket, head));
        this._server.listen(port, hostname);
        return this;
    }

    close(callback) {
        const self = this;
        if (this._server) self._server.close(done);

        // Wrap callback to nullify server after all open connections are closed.
        function done() {
            this._server = null;
            if (callback) callback.apply(null, arguments);
        }
    }

    before(type, passName, callback) {
        if (type !== "ws" && type !== "web") throw new Error("type must be `web` or `ws`");
        let passes = (type === "ws") ? this.wsPasses : this.webPasses, i = false;
        passes.forEach((v, idx) => {
            if(v.name === passName) i = idx;
        })
        if(i === false) throw new Error("No such pass");
        passes.splice(i, 0, callback);
    }

    after(type, passName, callback) {
        if (type !== "ws" && type !== "web") throw new Error("type must be `web` or `ws`");
        let passes = (type === "ws") ? this.wsPasses : this.webPasses, i = false;
        passes.forEach((v, idx) => {
            if(v.name === passName) i = idx;
        })
        if(i === false) throw new Error("No such pass");
        passes.splice(i++, 0, callback);
    }
}

/**
 * Returns a function that creates the loader for either `ws` or `web`'s  passes.
 * @example
 *    httpProxy.createRightProxy("ws")
 *    // => [Function]
 * @param {string} type Either "ws" or "web"
 * @return {function} Loader Function that when called returns an iterator for the right passes
 */
function createRightProxy(type) {
    return function(options) {
        return function(req, res /*, [head], [opts] */) {
            const passes = (type === "ws") ? this.wsPasses : this.webPasses;
            const args = [].slice.call(arguments);
            let cntr = args.length - 1, head, cbl;
            /* optional args parse begin */
            if (typeof args[cntr] === "function") {
                cbl = args[cntr];
                cntr--;
            }
            let requestOptions = options;
            if (!(args[cntr] instanceof Buffer) && args[cntr] !== res) {
                requestOptions = Object.assign({}, options);
                Object.assign(requestOptions, args[cntr]);
                cntr--;
            }
            if (args[cntr] instanceof Buffer) head = args[cntr];
            ["target", "forward"].forEach(e => {
                if (typeof requestOptions[e] === "string")
                    requestOptions[e] = parse(requestOptions[e]);
            });
            if (!requestOptions.target && !requestOptions.forward)
                return this.emit("error", new Error("Must provide a proper URL as target"));
            for (let i = 0; i < passes.length; i++) {
                if (passes[i](req, res, requestOptions, head, this, cbl))
                    break;
            }
        };
    };
}

module.exports = options => new ProxyServer(options);
module.exports.server = ProxyServer;
module.exports.createRightProxy = createRightProxy;
