const debug = require("debug")("express:application");
const { inspect, format } = require("node:util");
const { EventEmitter } = require("node:events");
const { createServer } = require("node:http");
const { Stream } = require("node:stream");
const { HttpError } = require("http-errors");
const onFinished = require("on-finished");
const statuses = require("statuses");
const compose = require("./compose.js");
const context = require("./context.js");
const request = require("./request.js");
const response = require("./response.js");

class Application extends EventEmitter {
    /**
     * Initialize a new `Application`.
     * @param {object} [options] Application options
     * @param {string} [options.env="development"] Environment
     * @param {string[]} [options.keys] Signed cookie keys
     * @param {boolean} [options.proxy] Trust proxy headers
     * @param {function} [options.compose] Compose
     * @param {number} [options.subdomainOffset] Subdomain offset
     * @param {string} [options.proxyIpHeader] Proxy IP header, defaults to X-Forwarded-For
     * @param {number} [options.maxIpsCount] Max IPs read from proxy IP header, default to 0 (means infinity)
     */
    constructor(options = {}) {
        super();
        this.proxy = options.proxy || false;
        this.subdomainOffset = options.subdomainOffset || 2;
        this.proxyIpHeader = options.proxyIpHeader || "X-Forwarded-For";
        this.maxIpsCount = options.maxIpsCount || 0;
        this.env = options.env || process.env.NODE_ENV || "development";
        this.compose = options.compose || compose;
        if (options.keys) this.keys = options.keys;
        this.middleware = [];
        this.context = Object.create(context);
        this.request = Object.create(request);
        this.response = Object.create(response);
    }

    /**
     * @example
     *    http.createServer(app.callback()).listen(...)
     * @param {*} args
     * @return {Server}
     */
    listen(...args) {
        debug("listen");
        const server = createServer(this.callback());
        return server.listen(...args);
    }

    /**
     * Use the given middleware `fn`.
     * @param {function} func
     * @return {Application} self
     */
    use(func) {
        if (typeof func !== "function") throw new TypeError("middleware must be a function!");
        debug("use %s", func._name || func.name || "-");
        this.middleware.push(func);
        return this;
    }

    /**
     * Return a request handler callback for node's native http server.
     * @return {function}
     */
    callback() {
        const fn = this.compose(this.middleware);
        if (!this.listenerCount("error")) this.on("error", this.onerror);
        return (req, res) => {
            const ctx = this.createContext(req, res);
            return this.handleRequest(ctx, fn);
        }
    }

    /**
     * Handle request in callback.
     */
    handleRequest(ctx, fnMiddleware) {
        const res = ctx.res;
        res.statusCode = 404;
        const onerror = err => ctx.onerror(err);
        const handleResponse = () => {
            if (ctx.respond === false) return;
            if (!ctx.writable) return;

            const res = ctx.res;
            let body = ctx.body;
            const code = ctx.status;

            // ignore body
            if (statuses.empty[code]) {
                // strip headers
                ctx.body = null;
                return res.end();
            }

            if (ctx.method === "HEAD") {
                if (!res.headersSent && !ctx.response.has("Content-Length")) {
                    const { length } = ctx.response;
                    if (Number.isInteger(length)) ctx.length = length;
                }
                return res.end();
            }

            // status body
            if (body == null) {
                if (ctx.response._explicitNullBody) {
                    ctx.response.remove("Content-Type");
                    ctx.response.remove("Transfer-Encoding");
                    ctx.length = 0;
                    return res.end();
                }
                body = ctx.req.httpVersionMajor >= 2 ? String(code) : ctx.message || String(code);
                if (!res.headersSent) {
                    ctx.type = "text";
                    ctx.length = Buffer.byteLength(body);
                }
                return res.end(body);
            }

            // responses
            if (Buffer.isBuffer(body)) return res.end(body);
            if (typeof body === "string") return res.end(body);
            if (body instanceof Stream) return body.pipe(res);

            // body: json
            body = JSON.stringify(body);
            if (!res.headersSent) ctx.length = Buffer.byteLength(body);
            res.end(body);
        }
        onFinished(res, onerror);
        return fnMiddleware(ctx).then(handleResponse).catch(onerror);
    }

    /**
     * Initialize a new context.
     */
    createContext(req, res) {
        const context = Object.create(this.context);
        const request = context.request = Object.create(this.request);
        const response = context.response = Object.create(this.response);
        context.app = request.app = response.app = this;
        context.req = request.req = response.req = req;
        context.res = request.res = response.res = res;
        request.ctx = response.ctx = context;
        request.response = response;
        response.request = request;
        context.originalUrl = request.originalUrl = req.url;
        context.state = {};
        return context;
    }

    /**
     * Default error handler.
     * @param {*} err
     */
    onerror(err) {
        if (!(Object.prototype.toString.call(err) === "[object Error]" || err instanceof Error))
            throw new TypeError(format("non-error thrown: %j", err));
        if (err.status === 404 || err.expose) return;
        if (this.silent) return;
        const msg = err.stack || err.toString();
        console.error(`\n${msg.replace(/^/gm, "  ")}\n`);
    }

    /**
     * Return JSON representation. We only bother showing settings.
     * @return {object}
     */
    toJSON() {
        return ["subdomainOffset", "proxy", "env"].reduce((ret, key) => {
            if (this[key] == null) return ret;
            ret[key] = this[key];
            return ret;
        }, {});
    }

    /**
     * util.inspect() implementation.
     * @return {object}
     */
    [inspect.custom]() {
        return this.toJSON();
    }
}

module.exports = Application;
module.exports.express = Application;
module.exports.HttpError = HttpError;
// Binding
const router = require("./router.js");
const compress = require("./compress.js");
const logger = require("./logger.js");
const { serveStatic, serveRender } = require("./serve.js");
module.exports.logger = logger;
module.exports.router = opts => new router(opts);
module.exports.compression = compress;
module.exports.static = serveStatic;
module.exports.views = serveRender;
