const debug = require("debug")("express:context");
const { inspect, format } = require("node:util");
const createError = require("http-errors");
const statuses = require("statuses");
const Cookies = require("cookies");

const COOKIES = Symbol("context#cookies");

const proto = module.exports = {
    /**
     * Get cookies data
     * @return {Cookies}
     */
    get cookies() {
        if (!this[COOKIES])
            this[COOKIES] = new Cookies(this.req, this.res, {
                keys: this.app.keys,
                secure: this.request.secure
            });
        return this[COOKIES];
    },

    /**
     * Set cookies data
     * @param {Cookies} value
     */
    set cookies(value) {
        this[COOKIES] = value;
    },

    /**
     * Similar to .throw(), adds assertion.
     * @example
     *    this.assert(this.user, 401, "Please login!");
     * See: https://github.com/jshttp/http-assert
     * @param {object} value
     * @param {string|number|Error} args
     */
    assert(value, ...args) {
        if (value) return;
        throw createError(...args);
    },

    /**
     * Throw an error with `status` (default 500) and `msg`. Note that these are
     * user-level errors, and the message may be exposed to the client.
     * @example
     *    this.throw(403)
     *    this.throw(400, "name required")
     *    this.throw("something exploded")
     *    this.throw(new Error("invalid"))
     *    this.throw(400, new Error("invalid"))
     * See: https://github.com/jshttp/http-errors
     * Note: `status` should only be passed as the first parameter.
     * @param {string|number|Error} args err, msg or status
     */
    throw(...args) {
        throw createError(...args);
    },

    /**
     * Default error handling.
     * @param {Error} err
     */
    onerror(err) {
        // don't do anything if there is no error. this allows you to pass `this.onerror` to node-style callbacks.
        if (err == null) return;

        if (!(Object.prototype.toString.call(err) === "[object Error]" || err instanceof Error))
            err = new Error(format("non-error thrown: %j", err));

        let headerSent = false;
        if (this.headerSent || !this.writable)
            headerSent = err.headerSent = true;

        // delegate
        this.app.emit("error", err, this);

        // nothing we can do here other than delegate to the app-level handler and log.
        if (headerSent) return;

        const { res } = this;

        // first unset all headers
        res.getHeaderNames().forEach(name => res.removeHeader(name));

        // then set those specified
        this.set(err.headers);

        // force text/plain
        this.type = "text";

        let statusCode = err.status || err.statusCode;

        // ENOENT support
        if (err.code === "ENOENT") statusCode = 404;

        // default to 500
        if (typeof statusCode !== "number" || !statuses.message[statusCode]) statusCode = 500;

        // respond
        const msg = err.expose ? err.message : statuses.message[statusCode];
        this.status = err.status = statusCode;
        this.length = Buffer.byteLength(msg);
        res.end(msg);
    },

    /**
     * Return JSON representation.
     * Here we explicitly invoke .toJSON() on each object, as iteration will otherwise
     * fail due to the getters and cause utilities such as clone() to fail.
     * @return {object}
     */
    toJSON() {
        return {
            request: this.request.toJSON(),
            response: this.response.toJSON(),
            app: this.app.toJSON(),
            originalUrl: this.originalUrl,
            req: "<original node req>",
            res: "<original node res>",
            socket: "<original node socket>"
        };
    },

    /**
     * util.inspect() implementation, which just returns the JSON output.
     * @return {object}
     */
    [inspect.custom]() {
        if (this === proto) return this;
        return this.toJSON();
    }
}

/**
 * Delegate register.
 * @param {object} holder delegate holder
 * @param {object} delegate delegate registration map
 */
void function(holder, delegate) {
    for (const [target, delegateMap] of Object.entries(delegate)) {
        for (const [accessor, funcList] of Object.entries(delegateMap)) {
            for (const name of funcList) {
                switch (accessor) {
                    case "method":
                        holder[name] = function() { return this[target][name].apply(this[target], arguments); }
                        break;
                    case "access":
                        Object.defineProperty(holder, name, {
                            get() { return this[target][name]; },
                            set(value) { this[target][name] = value; },
                            configurable: true
                        });
                        break;
                    case "getter":
                        Object.defineProperty(holder, name, {
                            get() { return this[target][name]; },
                            configurable: true
                        });
                        break;
                    case "setter":
                        Object.defineProperty(holder, name, {
                            set(value) { this[target][name] = value; },
                            configurable: true
                        });
                        break;
                    default:
                        throw TypeError(`Invalid ${accessor} accessor, please select from "method", "access", "getter" and "setter"`);
                }
                debug('register [%s] with %s accessor to "%s"', name, accessor, target);
            }
        }
    }
}(proto, {
    response: {
        method: ["attachment", "redirect", "remove", "vary", "has", "set", "append", "flushHeaders"],
        access: ["status", "message", "body", "length", "type", "lastModified", "etag"],
        getter: ["headerSent", "writable"]
    },
    request: {
        method: ["acceptsLanguages", "acceptsEncodings", "acceptsCharsets", "accepts", "get", "is"],
        access: ["querystring", "idempotent", "socket", "search", "method", "query", "path", "url", "accept"],
        getter: ["origin", "href", "subdomains", "protocol", "host", "hostname", "URL", "header", "headers", "secure", "stale", "fresh", "ips", "ip"]
    }
});
