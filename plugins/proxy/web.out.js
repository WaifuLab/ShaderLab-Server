const { parse } = require("node:url");
const shared = require("./shared.js");

const redirectRegex = /^201|30([1278])$/;

module.exports = {
    /**
     * If is a HTTP 1.0 request, remove chunk headers.
     * @param {ClientRequest} req Request object
     * @param {IncomingMessage} res Response object
     * @param {proxyResponse} proxyRes Response object from the proxy request
     */
    removeChunked(req, res, proxyRes) {
        if (req.httpVersion === "1.0")
            delete proxyRes.headers["transfer-encoding"];
    },
    /**
     * If is a HTTP 1.0 request, set the correct connection header or if connection header not present, then use `keep-alive`
     * @param {ClientRequest} req Request object
     * @param {IncomingMessage} res Response object
     * @param {proxyResponse} proxyRes Response object from the proxy request
     */
    setConnection(req, res, proxyRes) {
        if (req.httpVersion === "1.0") {
            proxyRes.headers.connection = req.headers.connection || "close";
        } else if (req.httpVersion !== "2.0" && !proxyRes.headers.connection) {
            proxyRes.headers.connection = req.headers.connection || "keep-alive";
        }
    },
    /**
     * @param {ClientRequest} req
     * @param {IncomingMessage} res
     * @param {proxyResponse} proxyRes
     * @param {object} options
     */
    setRedirectHostRewrite(req, res, proxyRes, options) {
        if ((options.hostRewrite || options.autoRewrite || options.protocolRewrite) &&
            proxyRes.headers["location"] && redirectRegex.test(proxyRes.statusCode)) {
            const target = parse(options.target);
            const url = parse(proxyRes.headers["location"]);
            // make sure the redirected host matches the target host before rewriting
            if (target.host != url.host) return;
            if (options.hostRewrite) {
                url.host = options.hostRewrite;
            } else if (options.autoRewrite) {
                url.host = req.headers["host"];
            }
            if (options.protocolRewrite)
                url.protocol = options.protocolRewrite;
            proxyRes.headers["location"] = url.format();
        }
    },
    /**
     * Copy headers from proxyResponse to response set each header in response object.
     * @param {ClientRequest} req Request object
     * @param {IncomingMessage} res Response object
     * @param {proxyResponse} proxyRes Response object from the proxy request
     * @param {Object} options options.cookieDomainRewrite: Config to rewrite cookie domain
     */
    writeHeaders(req, res, proxyRes, options) {
        let { cookieDomainRewrite: rewriteCookieDomainConfig, cookiePathRewrite: rewriteCookiePathConfig, preserveHeaderKeyCase } = options, rawHeaderKeyMap;
        const setHeader = function(key, header) {
            if (header == undefined) return;
            if (rewriteCookieDomainConfig && key.toLowerCase() === "set-cookie")
                header = shared.rewriteCookieProperty(header, rewriteCookieDomainConfig, "domain");
            if (rewriteCookiePathConfig && key.toLowerCase() === "set-cookie")
                header = shared.rewriteCookieProperty(header, rewriteCookiePathConfig, "path");
            res.setHeader(String(key).trim(), header);
        };
        if (typeof rewriteCookieDomainConfig === "string")
            rewriteCookieDomainConfig = { "*": rewriteCookieDomainConfig };
        if (typeof rewriteCookiePathConfig === "string")
            rewriteCookiePathConfig = { "*": rewriteCookiePathConfig };
        if (preserveHeaderKeyCase && !!proxyRes.rawHeaders) {
            rawHeaderKeyMap = {};
            for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
                const key = proxyRes.rawHeaders[i];
                rawHeaderKeyMap[key.toLowerCase()] = key;
            }
        }
        Object.keys(proxyRes.headers).forEach(key => {
            const header = proxyRes.headers[key];
            if (preserveHeaderKeyCase && rawHeaderKeyMap)
                key = rawHeaderKeyMap[key] || key;
            setHeader(key, header);
        });
    },
    /**
     * Set the statusCode from the proxyResponse
     * @param {ClientRequest} req Request object
     * @param {IncomingMessage} res Response object
     * @param {proxyResponse} proxyRes Response object from the proxy request
     */
    writeStatusCode(req, res, proxyRes) {
        // From Node.js docs: response.writeHead(statusCode[, statusMessage][, headers])
        if(proxyRes.statusMessage) {
            res.statusCode = proxyRes.statusCode;
            res.statusMessage = proxyRes.statusMessage;
        } else {
            res.statusCode = proxyRes.statusCode;
        }
    }
};
