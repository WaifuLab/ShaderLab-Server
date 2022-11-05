const { hrtime, stdout } = require("node:process");
const onFinished = require("on-finished");
const onHeaders = require("on-headers");

/**
 * Create a logger middleware.
 * @param {string|function} format
 * @param {boolean} immediate
 * @param {boolean} skip
 * @param {WriteStream} stream
 * @return {function} middleware
 */
function logger(format, { immediate, skip = false, stream = stdout } = {}) {
    // format function
    const formatLine = typeof format !== "function" ? getFormatPrefab(format) : format;
    return async (ctx, next) => {
        const { req, res } = ctx;
        // request data
        req.startAt = undefined;
        req.startTime = undefined;
        req.remoteAddress = req.ip || req.remoteAddress ||
            (req.connection && req.connection.remoteAddress) || undefined;
        // response data
        res.startAt = undefined;
        res.startTime = undefined;
        // record request start
        recordStartTime.call(req)
        const logRequest = () => {
            if (skip !== false && skip(req, res)) return;
            const line = formatLine(prefabFactory, req, res);
            if (line == null) return;
            stream.write(line + '\n');
        }
        if (immediate) {
            logRequest();
        } else {
            onHeaders(res, recordStartTime);
            onFinished(res, logRequest);
        }
        await next();
    }
}

/**
 * Compile a format string into a function.
 * @param {string} format
 * @return {function}
 */
function compile(format) {
    if (typeof format !== "string") throw new TypeError("format must be string");
    return new Function("tokens, req, res", '  "use strict"\n  return ' +
        String(JSON.stringify(format)).replace(/:([-\w]{2,})(?:\[([^\]]+)])?/g,
            (substring, name, arg) => {
                let tokenArguments = "req, res", tokenFunction = "tokens[" + String(JSON.stringify(name)) + "]";
                if (arg !== undefined) tokenArguments += ", " + String(JSON.stringify(arg));
                return '" +\n    (' + tokenFunction + "(" + tokenArguments + ') || "-") + "';
            }
        ));
}

/**
 * Lookup and compile a named format function.
 * @param {string} name
 * @return {function}
 */
function getFormatPrefab(name) {
    // lookup format
    let fmt = prefabFactory[name] || name;
    // return compiled format
    return typeof fmt !== "function" ? compile(fmt) : fmt;
}

/**
 * Record the start time.
 */
function recordStartTime() {
    this.startAt = hrtime();
    this.startTime = new Date();
}

module.exports = logger;
module.exports.logger = logger;
module.exports.compile = compile;

//region prefab register factory

/** Array of CLF month names. */
const CLF_MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let prefabFactory = {
    /**
     * Define a token function with the given name, and callback fn(req, res).
     * @param {string} name
     * @param {function} fn
     */
    token: (name, fn) => {
        prefabFactory[name] = fn;
        return this;
    },
    /**
     * Define a format with the given name.
     * @param {string} name
     * @param {string|function} fmt
     */
    format: (name, fmt) => {
        prefabFactory[name] = fmt;
        return this;
    }
};

prefabFactory.format("default", ':remote-addr - :remote-user [:date] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"');

prefabFactory.format("dev", function developmentFormatLine (tokens, req, res) {
    // get the status code if response written
    const status = headersSent(res) ? res.statusCode : undefined;
    // get status color
    const color = status >= 500 ? 31 /* red */ : status >= 400 ? 33 /* yellow */ : status >= 300 ? 36 /* cyan */ : status >= 200 ? 32 /* green */ : 0 /* no color */;
    // get colored function
    let fn = developmentFormatLine[color];
    if (!fn) fn = developmentFormatLine[color] = compile(`\x1b[0m:method :url \x1b[${color}m:status\x1b[0m :response-time ms - :res[content-length]\x1b[0m`);
    return fn(tokens, req, res);
})

prefabFactory.token("url", function getUrlToken(req) {
    return req.originalUrl || req.url;
});

prefabFactory.token("method", function getMethodToken(req) {
    return req.method;
});

prefabFactory.token("response-time", function getResponseTimeToken(req, res, digits) {
    // missing request and/or response start time
    if (!req.startAt || !res.startAt) return;
    // calculate diff
    const ms = (res.startAt[0] - req.startAt[0]) * 1e3 + (res.startAt[1] - req.startAt[1]) * 1e-6;
    // return truncated value
    return ms.toFixed(digits === undefined ? 3 : digits)
});

prefabFactory.token("total-time", function getTotalTimeToken(req, res, digits) {
    // missing request and/or response start time
    if (!req.startAt || !res.startAt) return;
    // time elapsed from request start
    const elapsed = process.hrtime(req._startAt);
    // cover to milliseconds
    const ms = (elapsed[0] * 1e3) + (elapsed[1] * 1e-6);
    // return truncated value
    return ms.toFixed(digits === undefined ? 3 : digits)
});

prefabFactory.token("date", function getDateToken(req, res, format) {
    const date = new Date();
    switch (format || "web") {
        case "clf":
            return clfdate(date);
        case "iso":
            return date.toISOString();
        case "web":
            return date.toUTCString();
    }
});

prefabFactory.token("status", function getStatusToken(req, res) {
    return headersSent(res) ? String(res.statusCode) : undefined;
});

prefabFactory.token("referrer", function getReferrerToken(req) {
    return req.headers.referer || req.headers.referrer;
});

prefabFactory.token("remote-addr", function getIpToken(req) {
    return req.ip || req._remoteAddress || (req.connection && req.connection.remoteAddress) || undefined;
});

prefabFactory.token("http-version", function getHttpVersionToken(req) {
    return req.httpVersionMajor + '.' + req.httpVersionMinor;
});

prefabFactory.token("user-agent", function getUserAgentToken(req) {
    return req.headers["user-agent"];
});

prefabFactory.token("req", function getRequestToken(req, res, field) {
    // get header
    const header = req.headers[field.toLowerCase()];
    return Array.isArray(header) ? header.join(", ") : header;
});

prefabFactory.token("res", function getResponseHeader(req, res, field) {
    if (!headersSent(res)) return undefined;
    // get header
    const header = res.getHeader(field);
    return Array.isArray(header) ? header.join(", ") : header;
});

/**
 * Format a Date in the common log format.
 * @param {Date} dateTime
 * @return {string}
 */
function clfdate(dateTime) {
    const date = dateTime.getUTCDate();
    const hour = dateTime.getUTCHours();
    const mins = dateTime.getUTCMinutes();
    const secs = dateTime.getUTCSeconds();
    const year = dateTime.getUTCFullYear();
    const month = CLF_MONTH[dateTime.getUTCMonth()];
    return pad2(date) + "/" + month + "/" + year + ":" + pad2(hour) + ":" + pad2(mins) + ":" + pad2(secs) + " +0000";
}

/**
 * Pad number to two digits.
 * @param {number} num
 * @return {string}
 */
function pad2 (num) {
    const str = String(num);
    return (str.length === 1 ? "0" : '') + str;
}

/**
 * Determine if the response headers have been sent.
 * @param {object} res
 * @returns {boolean}
 */
function headersSent (res) {
    return typeof res.headersSent !== "boolean" ? Boolean(res._header) : res.headersSent
}

//endregion

module.exports.format = prefabFactory.format;
module.exports.token = prefabFactory.token;
