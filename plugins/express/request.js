const { parse, stringify } = require("node:querystring");
const { URL, format } = require("node:url");
const { inspect } = require("node:util");
const { isIP } = require("node:net");
const accepts = require("accepts");
const contentType = require("content-type");
const parseurl = require("parseurl");
const typeis = require("type-is");
const fresh = require("fresh");

const IP = Symbol("context#ip");

/**
 * ┌────────────────────────────────────────────────────────────────────────────────────────────────┐
 * │                                              href                                              │
 * ├──────────┬──┬─────────────────────┬────────────────────────┬───────────────────────────┬───────┤
 * │ protocol │  │        auth         │          host          │           path            │ hash  │
 * │          │  │                     ├─────────────────┬──────┼──────────┬────────────────┤       │
 * │          │  │                     │    hostname     │ port │ pathname │     search     │       │
 * │          │  │                     │                 │      │          ├─┬──────────────┤       │
 * │          │  │                     │                 │      │          │ │    query     │       │
 * "  https:   //    user   :   pass   @ sub.example.com : 8080   /p/a/t/h  ?  query=string   #hash "
 * │          │  │          │          │    hostname     │ port │          │                │       │
 * │          │  │          │          ├─────────────────┴──────┤          │                │       │
 * │ protocol │  │ username │ password │          host          │          │                │       │
 * ├──────────┴──┴──────────┴──────────┴────────────────────────┤          │                │       │
 * │                           origin                           │ pathname │     search     │ hash  │
 * ├────────────────────────────────────────────────────────────┴──────────┴────────────────┴───────┤
 * │                                              href                                              │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 * (All spaces in the "" line should be ignored. They are purely for formatting.)
 */
module.exports = {
    /**
     * Return request header.
     * @return {object}
     */
    get header() {
        return this.req.headers;
    },

    /**
     * Set request header.
     */
    set header(value) {
        this.req.headers = value;
    },

    /**
     * Return request header, alias as {@link header}
     * @return {object}
     */
    get headers() {
        return this.header;
    },

    /**
     * Set request header, alias as {@link header}
     */
    set headers(value) {
        this.header = value;
    },

    /**
     * Get request URL.
     * @return {string}
     */
    get url() {
        return this.req.url;
    },

    /**
     * Set request URL.
     */
    set url(value) {
        this.req.url = value;
    },

    /**
     * Get origin of URL.
     * @return {string}
     */
    get origin() {
        return `${this.protocol}://${this.host}`;
    },

    /**
     * Get full request URL. Support: `GET http://example.com/foo`
     * @return {string}
     */
    get href() {
        return /^https?:\/\//i.test(this.originalUrl) ? this.originalUrl : this.origin + this.originalUrl;
    },

    /**
     * Get request method.
     * @return {string}
     */
    get method() {
        return this.req.method;
    },

    /**
     * Set request method.
     * @param {string} value
     */
    set method(value) {
        this.req.method = value;
    },

    /**
     * Get request pathname.
     * @return {string}
     */
    get path() {
        return parseurl(this.req).pathname;
    },

    /**
     * Set pathname, retaining the query string when present.
     * @param {string} path
     */
    set path(path) {
        const url = parseurl(this.req);
        if (url.pathname === path) return;
        url.pathname = path;
        url.path = null;
        this.url = format(url);
    },

    /**
     * Get parsed query string.
     * @return {object}
     */
    get query() {
        const str = this.querystring;
        const cache = this._querycache = this._querycache || {};
        return cache[str] || (cache[str] = parse(str));
    },

    /**
     * Set query string as an object.
     * @param {object} obj
     */
    set query(obj) {
        this.querystring = stringify(obj);
    },

    /**
     * Get query string.
     * @return {string}
     */
    get querystring() {
        if (!this.req) return '';
        return parseurl(this.req).query || '';
    },

    /**
     * Set query string.
     * @param {string} str
     */
    set querystring(str) {
        const url = parseurl(this.req);
        if (url.search === `?${str}`) return;
        url.search = str;
        url.path = null;
        this.url = format(url);
    },

    /**
     * Get the search string. Same as the query string except it includes the leading ?.
     * @return {string}
     */
    get search() {
        if (!this.querystring) return '';
        return `?${this.querystring}`;
    },

    /**
     * Set the search string. Same as request.querystring= but included for ubiquity.
     * @param {string} str
     */
    set search(str) {
        this.querystring = str;
    },

    /**
     * Parse the "Host" header field host and support X-Forwarded-Host when a proxy is enabled.
     * @return {string} hostname:port
     */
    get host() {
        const proxy = this.app.proxy;
        let host = proxy && this.get("X-Forwarded-Host");
        if (!host) {
            if (this.req.httpVersionMajor >= 2) host = this.get(":authority");
            if (!host) host = this.get("Host");
        }
        if (!host) return '';
        return host.split(/\s*,\s*/, 1)[0];
    },

    /**
     * Parse the "Host" header field hostname and support X-Forwarded-Host when a proxy is enabled.
     * @return {string} hostname
     */
    get hostname() {
        const host = this.host;
        if (!host) return '';
        if (host[0] === "[") return this.URL.hostname || ''; // IPv6
        return host.split(":", 1)[0];
    },

    /**
     * Get WHATWG parsed URL.
     * Lazily memoized.
     * @return {URL|object}
     */
    get URL() {
        if (!this.memoizedURL) {
            const originalUrl = this.originalUrl || ''; // avoid undefined in template string
            try {
                this.memoizedURL = new URL(`${this.origin}${originalUrl}`);
            } catch (err) {
                this.memoizedURL = Object.create(null);
            }
        }
        return this.memoizedURL;
    },

    /**
     * Check if the request is fresh, aka Last-Modified and/or the ETag still match.
     * @return {boolean}
     */
    get fresh() {
        const method = this.method;
        const status = this.ctx.status;
        // GET or HEAD for weak freshness validation only
        if (method !== "GET" && method !== "HEAD") return false;
        // 2xx or 304 as per rfc2616 14.26
        if ((status >= 200 && status < 300) || status === 304)
            return fresh(this.header, this.response.header);
        return false;
    },

    /**
     * Check if the request is stale, aka "Last-Modified" and / or the "ETag" for the resource has changed.
     * @return {boolean}
     */
    get stale() {
        return !this.fresh;
    },

    /**
     * Check if the request is idempotent.
     * @return {boolean}
     */
    get idempotent() {
        const methods = ["GET", "HEAD", "PUT", "DELETE", "OPTIONS", "TRACE"];
        return !!~methods.indexOf(this.method);
    },

    /**
     * Return the request socket.
     * @return {Connection}
     */
    get socket() {
        return this.req.socket;
    },

    /**
     * Get the charset when present or undefined.
     * @return {string}
     */
    get charset() {
        try {
            const { parameters } = contentType.parse(this.req);
            return parameters.charset || '';
        } catch (err) { return ''; }
    },

    /**
     * Return parsed Content-Length when present.
     * @return {number|undefined}
     */
    get length() {
        const len = this.get("Content-Length");
        if (len === '') return;
        return ~~len;
    },

    /**
     * Return the protocol string "http" or "https" when requested with TLS. When the proxy
     * setting is enabled the "X-Forwarded-Proto" header field will be trusted. If you're
     * running behind a reverse proxy that supplies https for you this may be enabled.
     * @return {string}
     */
    get protocol() {
        if (this.socket.encrypted) return "https";
        if (!this.app.proxy) return "http";
        const proto = this.get("X-Forwarded-Proto");
        return proto ? proto.split(/\s*,\s*/, 1)[0] : "http";
    },

    /**
     * Shorthand for:
     * @example
     *    this.protocol == "https"
     * @return {boolean}
     */
    get secure() {
        return this.protocol === "https";
    },

    /**
     * When `app.proxy` is `true`, parse the "X-Forwarded-For" ip address list.
     * For example if the value was "client, proxy1, proxy2" you would receive the array
     * `["client", "proxy1", "proxy2"]` where "proxy2" is the furthest down-stream.
     * @return {string[]}
     */
    get ips() {
        const proxy = this.app.proxy;
        const val = this.get(this.app.proxyIpHeader);
        let ips = proxy && val ? val.split(/\s*,\s*/) : [];
        if (this.app.maxIpsCount > 0)
            ips = ips.slice(-this.app.maxIpsCount);
        return ips;
    },

    /**
     * Return request's remote address
     * When `app.proxy` is `true`, parse the "X-Forwarded-For" ip address list and return the first one
     * @return {string}
     */
    get ip() {
        if (!this[IP]) this[IP] = this.ips[0] || this.socket.remoteAddress || '';
        return this[IP];
    },

    /**
     * Set ip address
     * @param {string} value
     */
    set ip(value) {
        this[IP] = value;
    },

    /**
     * Return subdomains as an array.
     *
     * Subdomains are the dot-separated parts of the host before the main domain
     * of the app. By default, the domain of the app is assumed to be the last two
     * parts of the host. This can be changed by setting `app.subdomainOffset`.
     *
     * For example, if the domain is "tobi.ferrets.example.com":
     * If `app.subdomainOffset` is not set, this.subdomains is `["ferrets", "tobi"]`.
     * If `app.subdomainOffset` is 3, this.subdomains is `["tobi"]`.
     *
     * @return {string[]}
     */
    get subdomains() {
        const offset = this.app.subdomainOffset;
        const hostname = this.hostname;
        if (isIP(hostname)) return [];
        return hostname.split(".").reverse().slice(offset);
    },

    /**
     * Get accept object.
     * Lazily memoized.
     * @return {object}
     */
    get accept() {
        return this._accept || (this._accept = accepts(this.req));
    },

    /**
     * Set accept object.
     * @param {object} obj
     */
    set accept(obj) {
        this._accept = obj;
    },

    /**
     * Check if the given `type(s)` is acceptable, returning the best match when true,
     * otherwise `false`, in which case you should respond with 406 "Not Acceptable".
     * The `type` value may be a single mime type string
     * such as "application/json", the extension name
     * such as "json" or an array `["json", "html", "text/plain"]`. When a list
     * or array is given the _best_ match, if any is returned.
     * @example
     *     // Accept: text/html
     *     this.accepts("html");
     *     // => "html"
     *
     *     // Accept: text/*, application/json
     *     this.accepts("html");
     *     // => "html"
     *     this.accepts("text/html");
     *     // => "text/html"
     *     this.accepts("json", "text");
     *     // => "json"
     *     this.accepts("application/json");
     *     // => "application/json"
     *
     *     // Accept: text/*, application/json
     *     this.accepts("image/png");
     *     this.accepts("png");
     *     // => false
     *
     *     // Accept: text/*;q=.5, application/json
     *     this.accepts(["html", "json"]);
     *     this.accepts("html", "json");
     *     // => "json"
     * @param {string|string[]} args type(s)...
     * @return {string|string[]|false}
     */
    accepts(...args) {
        return this.accept.types(...args);
    },

    /**
     * Return accepted encodings or best fit based on `encodings`.
     * Given `Accept-Encoding: gzip, deflate` an array sorted by quality is returned:
     *     ["gzip", "deflate"]
     * @param {string|string[]} args encoding(s)...
     * @return {string|string[]}
     */
    acceptsEncodings(...args) {
        return this.accept.encodings(...args);
    },

    /**
     * Return accepted charsets or best fit based on `charsets`.
     * Given `Accept-Charset: utf-8, iso-8859-1;q=0.2, utf-7;q=0.5` an array sorted by quality is returned:
     *     ["utf-8", "utf-7", "iso-8859-1"]
     * @param {string|string[]} args charset(s)...
     * @return {string|string[]}
     */
    acceptsCharsets(...args) {
        return this.accept.charsets(...args);
    },

    /**
     * Return accepted languages or best fit based on `langs`.
     * Given `Accept-Language: en;q=0.8, es, pt` an array sorted by quality is returned:
     *     ["es", "pt", "en"]
     * @param {string|string[]} args lang(s)...
     * @return {string|string[]}
     */
    acceptsLanguages(...args) {
        return this.accept.languages(...args);
    },

    /**
     * Check if the incoming request contains the "Content-Type" header field and
     * if it contains any of the given mime `type`s. If there is no request body,
     * `null` is returned. If there is no content type, `false` is returned.
     * Otherwise, it returns the first `type` that matches.
     * @example
     *     // With Content-Type: text/html; charset=utf-8
     *     this.is("html"); // => "html"
     *     this.is("text/html"); // => "text/html"
     *     this.is("text/*", "application/json"); // => "text/html"
     *
     *     // When Content-Type is application/json
     *     this.is("json", "urlencoded"); // => "json"
     *     this.is("application/json"); // => "application/json"
     *     this.is("html", "application/*"); // => "application/json"
     *
     *     this.is("html"); // => false
     * @param {string|string[]} [type]
     * @param {string[]} [types]
     * @return {string|false|null}
     */
    is(type, ...types) {
        return typeis(this.req, type, ...types);
    },

    /**
     * Return the request mime type void of parameters such as "charset".
     * @return {string}
     */
    get type() {
        const type = this.get("Content-Type");
        if (!type) return '';
        return type.split(";")[0];
    },

    /**
     * Return request header.
     * The `Referrer` header field is special-cased,
     * both `Referrer` and `Referer` are interchangeable.
     * @example
     *     this.get("Content-Type");
     *     // => "text/plain"
     *
     *     this.get("content-type");
     *     // => "text/plain"
     *
     *     this.get("Something");
     *     // => ''
     * @param {string} field
     * @return {string}
     */
    get(field) {
        const req = this.req
        switch (field = field.toLowerCase()) {
            case "referer":
            case "referrer":
                return req.headers.referrer || req.headers.referer || '';
            default:
                return req.headers[field] || '';
        }
    },

    /**
     * Return JSON representation.
     * @return {object}
     */
    toJSON() {
        return ["method", "url", "header"].reduce((ret, key) => {
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
        if (!this.req) return;
        return this.toJSON();
    },
}
