const { strict: assert } = require("node:assert");
const { Stream } = require("node:stream");
const { extname } = require("node:path");
const { inspect } = require("node:util");
const { is: typeis } = require("type-is");
const contentDisposition = require("content-disposition");
const mimeTypes = require("mime-types");
const onFinish = require("on-finished");
const statuses = require("statuses");
const destroy = require("destroy");
const vary = require("vary");
const LRU = require("ylru");

const ENCODE_CHARS_REGEXP = /(?:[^\x21\x25\x26-\x3B\x3D\x3F-\x5B\x5D\x5F\x61-\x7A\x7E]|%(?:[^0-9A-Fa-f]|[0-9A-Fa-f][^0-9A-Fa-f]|$))+/g;
const UNMATCHED_SURROGATE_REGEXP = /(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF]([^\uDC00-\uDFFF]|$)/g;
const typeLRUCache = new LRU(100);

module.exports = {
    /**
     * Return the request socket.
     * @return {Connection}
     */
    get socket() {
        return this.res.socket;
    },

    /**
     * Return response header.
     * @return {object}
     */
    get header() {
        return this.res.getHeaders() || {};
    },

    /**
     * Return response header, alias as {@link header}
     * @return {object}
     */
    get headers() {
        return this.header;
    },

    /**
     * Get response status code.
     * @return {number}
     */
    get status() {
        return this.res.statusCode;
    },

    /**
     * Set response status code.
     * @param {number} code
     */
    set status(code) {
        if (this.headerSent) return;
        assert(Number.isInteger(code), "status code must be a number");
        assert(code >= 100 && code <= 999, `invalid status code: ${code}`);
        this._explicitStatus = true;
        this.res.statusCode = code;
        if (this.req.httpVersionMajor < 2) this.res.statusMessage = statuses.message[code];
        if (this.body && statuses.empty[code]) this.body = null;
    },

    /**
     * Get response status message
     * @return {string}
     */
    get message() {
        return this.res.statusMessage || statuses.message[this.status];
    },

    /**
     * Set response status message
     * @param {string} msg
     */
    set message(msg) {
        this.res.statusMessage = msg;
    },

    /**
     * Get response body.
     * @return {string|Buffer|object|Stream}
     */
    get body() {
        return this._body;
    },

    /**
     * Set response body.
     * @param {string|Buffer|object|Stream} value
     */
    set body(value) {
        const original = this._body;
        this._body = value;

        // no content
        if (value == null) {
            if (!statuses.empty[this.status]) {
                if (this.type === "application/json") {
                    this._body = "null";
                    return;
                }
                this.status = 204;
            }
            if (value === null) this._explicitNullBody = true;
            this.remove("Content-Type");
            this.remove("Content-Length");
            this.remove("Transfer-Encoding");
            return;
        }

        // set the status
        if (!this._explicitStatus) this.status = 200;

        // set the content-type only if not yet set
        const setType = !this.has("Content-Type");

        // string
        if (typeof value === "string") {
            if (setType) this.type = /^\s*</.test(value) ? "html" : "text";
            this.length = Buffer.byteLength(value);
            return;
        }

        // buffer
        if (Buffer.isBuffer(value)) {
            if (setType) this.type = "bin";
            this.length = value.length;
            return;
        }

        // stream
        if (value instanceof Stream) {
            onFinish(this.res, destroy.bind(null, value));
            if (original !== value) {
                value.once("error", err => this.ctx.onerror(err));
                // overwriting
                if (original != null) this.remove("Content-Length");
            }
            if (setType) this.type = "bin";
            return;
        }

        // json
        this.remove("Content-Length");
        this.type = "json";
    },

    /**
     * Set Content-Length field to `n`.
     * @param {number} number
     */
    set length(number) {
        if (!this.has("Transfer-Encoding"))
            this.set("Content-Length", number);
    },

    /**
     * Return parsed response Content-Length when present.
     * @return {number}
     */
    get length() {
        if (this.has("Content-Length"))
            return parseInt(this.get("Content-Length"), 10) || 0;
        const { body } = this;
        if (!body || body instanceof Stream) return undefined;
        if (typeof body === "string") return Buffer.byteLength(body);
        if (Buffer.isBuffer(body)) return body.length;
        return Buffer.byteLength(JSON.stringify(body));
    },

    /**
     * Check if a header has been written to the socket.
     * @return {boolean}
     */
    get headerSent() {
        return this.res.headersSent;
    },

    /**
     * Vary on `field`.
     * @param {string} field
     */
    vary(field) {
        if (this.headerSent) return;
        vary(this.res, field);
    },

    /**
     * Perform a 302 redirect to `url`.
     * The string "back" is special-cased to provide Referrer support, when Referrer is
     * not present `alt` or "/" is used.
     * @example
     *    this.redirect("back");
     *    this.redirect("back", "/index.html");
     *    this.redirect("/login");
     *    this.redirect("http://google.com");
     * @param {string} url
     * @param {string} [alt]
     */
    redirect(url, alt) {
        // location
        if (url === "back") url = this.ctx.get("Referrer") || alt || "/";
        this.set("Location", String(url).replace(UNMATCHED_SURROGATE_REGEXP, "$1\uFFFD$2").replace(ENCODE_CHARS_REGEXP, encodeURI));

        // status
        if (!statuses.redirect[this.status]) this.status = 302;

        // html
        if (this.ctx.accepts("html")) {
            const str = '' + url, match = /["'&<>]/.exec(str);
            if (match) {
                let escape, html = '', index = 0, lastIndex = 0;
                for (index = match.index; index < str.length; index++) {
                    switch (str.charCodeAt(index)) {
                        case 34: escape = "&quot;"; break;
                        case 38: escape = "&amp;";  break;
                        case 39: escape = "&#39;";  break;
                        case 60: escape = "&lt;";   break;
                        case 62: escape = "&gt;";   break;
                        default: continue;
                    }
                    if (lastIndex !== index) html += str.substring(lastIndex, index);
                    lastIndex = index + 1;
                    html += escape;
                }
                url = lastIndex !== index ? html + str.substring(lastIndex, index) : html;
            } else url = str;
            this.type = "text/html; charset=utf-8";
            this.body = `Redirecting to <a href="${url}">${url}</a>.`;
            return;
        }

        // text
        this.type = "text/plain; charset=utf-8";
        this.body = `Redirecting to ${url}.`;
    },

    /**
     * Set Content-Disposition header to "attachment" with optional `filename`.
     * @param {string} filename
     * @param {object} options
     */
    attachment(filename, options) {
        if (filename) this.type = extname(filename);
        this.set("Content-Disposition", contentDisposition(filename, options));
    },

    /**
     * Set Content-Type response header with `type` through `mime.lookup()`
     * when it does not contain a charset.
     * @example
     *     this.type = ".html";
     *     this.type = "html";
     *     this.type = "json";
     *     this.type = "application/json";
     *     this.type = "png";
     * @param {string} type
     */
    set type(type) {
        let mimeType = typeLRUCache.get(type);
        if (!!mimeType) {
            this.set("Content-Type", mimeType);
        } else {
            if ((mimeType = mimeTypes.contentType(type))) {
                typeLRUCache.set(type, mimeType);
                this.set("Content-Type", mimeType);
            } else this.remove("Content-Type");
        }
    },

    /**
     * Set the Last-Modified date using a string or a Date.
     * @example
     *     this.response.lastModified = new Date();
     *     this.response.lastModified = "2013-09-13";
     * @param {string|Date} value
     */
    set lastModified(value) {
        if (typeof value === "string") value = new Date(value);
        this.set("Last-Modified", value.toUTCString());
    },

    /**
     * Get the Last-Modified date in Date form, if it exists.
     * @return {Date}
     */
    get lastModified() {
        const date = this.get("Last-Modified");
        if (date) return new Date(date);
    },

    /**
     * Set the ETag of a response.
     * This will normalize the quotes if necessary.
     * @example
     *     this.response.etag = "md5hashsum";
     *     this.response.etag = ""md5hashsum"";
     *     this.response.etag = "W/"123456789"";
     * @param {string} value
     */
    set etag(value) {
        if (!/^(W\/)?"/.test(value)) value = `"${value}"`;
        this.set("ETag", value);
    },

    /**
     * Get the ETag of a response.
     * @return {string}
     */
    get etag() {
        return this.get("ETag");
    },

    /**
     * Return the response mime type void of parameters such as "charset".
     * @return {string}
     */
    get type() {
        const type = this.get("Content-Type");
        if (!type) return '';
        return type.split(";", 1)[0];
    },

    /**
     * Check whether the response is one of the listed types. Pretty much the same as `this.request.is()`.
     * @param {string|string[]} [type]
     * @param {string[]} [types]
     * @return {string|false}
     */
    is(type, ...types) {
        return typeis(this.type, type, ...types);
    },

    /**
     * Return response header.
     * @examples:
     *     this.get("Content-Type");
     *     // => "text/plain"
     *     this.get("content-type");
     *     // => "text/plain"
     * @param {string} field
     * @return {number|string|string[]|undefined}
     */
    get(field) {
        return this.res.getHeader(field);
    },

    /**
     * Returns true if the header identified by name is currently set in the outgoing headers.
     * The header name matching is case-insensitive.
     * @example
     *     this.has("Content-Type");
     *     // => true
     *     this.get("content-type");
     *     // => true
     * @param {string} field
     * @return {boolean}
     */
    has(field) {
        return this.res.hasHeader(field);
    },

    /**
     * Set header `field` to `val` or pass an object of header fields.
     * @example
     *    this.set("Foo", ["bar", "baz"]);
     *    this.set("Accept", "application/json");
     *    this.set({ Accept: "text/plain", "X-API-Key": "tobi" });
     * @param {string|object|string[]} field
     * @param {string} value
     */
    set(field, value) {
        if (this.headerSent) return;
        if (arguments.length === 2) {
            if (Array.isArray(value)) value = value.map(v => typeof v === "string" ? v : String(v));
            else if (typeof value !== "string") value = String(value);
            this.res.setHeader(field, value);
        } else {
            for (const key in field) {
                this.set(key, field[key]);
            }
        }
    },

    /**
     * Append additional header `field` with value `val`.
     * @example
     *    this.append("Link", ["<http://localhost/>", "<http://localhost:3000/>"]);
     *    this.append("Set-Cookie", "foo=bar; Path=/; HttpOnly");
     *    this.append("Warning", "199 Miscellaneous warning");
     * @param {string} field
     * @param {string|string[]} value
     */
    append(field, value) {
        const prev = this.get(field)
        if (prev) value = Array.isArray(prev) ? prev.concat(value) : [prev].concat(value)
        return this.set(field, value)
    },

    /**
     * Remove header `field`.
     * @param {string} field
     */
    remove(field) {
        if (this.headerSent) return;
        this.res.removeHeader(field);
    },

    /**
     * Checks if the request is writable. Tests for the existence of the socket as node sometimes does not set it.
     * @return {boolean}
     */
    get writable() {
        if (this.res.writableEnded) return false;
        const socket = this.res.socket;
        if (!socket) return true;
        return socket.writable;
    },

    /**
     * Return JSON representation.
     * @return {object}
     */
    toJSON() {
        return ["status", "message", "header"].reduce((ret, key) => {
            if (this[key] == null) return ret;
            ret[key] = this[key];
            return ret;
        }, {});
    },

    /**
     * util.inspect() implementation.
     * @return {object}
     */
    [inspect.custom]() {
        if (!this.res) return;
        const obj = this.toJSON();
        obj.body = this.body;
        return obj;
    },

    /**
     * Flush any set headers and begin the body.
     */
    flushHeaders() {
        this.res.flushHeaders();
    }
};
