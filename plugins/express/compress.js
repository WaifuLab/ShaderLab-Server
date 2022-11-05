const { createGzip, createDeflate, createBrotliCompress, constants } = require("node:zlib");
const { Stream } = require("node:stream");
const { formatSize } = require("../../utils/size.js");
const createError = require("http-errors");
const compressible = require("compressible");

const emptyBodyStatues = new Set([204, 205, 304]);

const WILD_CARD_ACCEPT_ENCODING = ["gzip", "deflate"];
const PREFERRED_ENCODINGS = ["br", "gzip", "deflate"];
const NO_TRANSFORM_REGEX = /(?:^|,)\s*?no-transform\s*?(?:,|$)/;
const RE_DIRECTIVE_REGEX = /^\s*(gzip|compress|deflate|br|identity|\*)\s*(?:;\s*q\s*=\s*(\d(?:\.\d)?))?\s*$/;

class Encodings {
    encodingWeights = new Map();

    constructor({ wildcardAcceptEncoding = WILD_CARD_ACCEPT_ENCODING,
                  preferredEncodings = PREFERRED_ENCODINGS,
                  reDirective = RE_DIRECTIVE_REGEX } = {}) {
        this.wildcardAcceptEncoding = wildcardAcceptEncoding;
        this.preferredEncodings = preferredEncodings;
        this.reDirective = reDirective;
    }

    parseAcceptEncoding(acceptEncoding = "*") {
        const { encodingWeights, reDirective } = this;
        acceptEncoding.split(",").forEach(directive => {
            const match = reDirective.exec(directive);
            if (!match) return // not a supported encoding above
            const encoding = match[1];
            // weight must be in [0, 1]
            let weight = match[2] && !isNaN(match[2]) ? parseFloat(match[2], 10) : 1;
            weight = Math.min(Math.max(weight, 0), 1);
            if (encoding === "*") {
                // set the weights for the default encodings
                this.wildcardAcceptEncoding.forEach(enc => {
                    if (!encodingWeights.has(enc)) encodingWeights.set(enc, weight);
                });
                return;
            }
            encodingWeights.set(encoding, weight);
        });
    }

    getPreferredContentEncoding () {
        const { encodingWeights, preferredEncodings } = this;
        // get ordered list of accepted encodings
        const acceptedEncodings = Array.from(encodingWeights.keys()).
            sort((a, b) => encodingWeights.get(b) - encodingWeights.get(a)).
                filter(encoding => encoding === "identity" || typeof Encodings.encodingMethods[encoding] === "function");
        // group them by weights
        const weightClasses = new Map();
        acceptedEncodings.forEach(encoding => {
            const weight = encodingWeights.get(encoding);
            if (!weightClasses.has(weight)) weightClasses.set(weight, new Set());
            weightClasses.get(weight).add(encoding);
        });
        // search by weight, descending
        const weights = Array.from(weightClasses.keys()).sort((a, b) => b - a);
        for (let i = 0; i < weights.length; i++) {
            // encodings at this weight
            const encodings = weightClasses.get(weights[i]);
            // return the first encoding in the preferred list
            for (let j = 0; j < preferredEncodings.length; j++) {
                const preferredEncoding = preferredEncodings[j];
                if (encodings.has(preferredEncoding)) return preferredEncoding;
            }
        }
        // no encoding matches, check to see if the client set identity, q=0
        if (encodingWeights.get("identity") === 0) throw createError(406, "Please accept br, gzip, deflate, or identity.");
        // by default, return nothing
        return "identity";
    }

    static encodingMethods = {
        gzip: createGzip,
        deflate: createDeflate,
        br: createBrotliCompress
    }
}

function compress(options = {}) {
    const encodingMethodDefaultOptions = { gzip: {}, deflate: {}, br: { [constants.BROTLI_PARAM_QUALITY]: 4 } };
    let { filter = compressible, threshold = 1024, defaultEncoding = "identity" } = options;
    if (typeof threshold === "string") threshold = formatSize(threshold);

    // `options.br = false` would remove it as a preferred encoding
    const preferredEncodings = PREFERRED_ENCODINGS.filter(encoding => options[encoding] !== false && options[encoding] !== null), encodingOptions = {};
    preferredEncodings.forEach(encoding => encodingOptions[encoding] = { ...encodingMethodDefaultOptions[encoding], ...(options[encoding] || {}) });

    async function compressMiddleware(ctx, next) {
        ctx.vary("Accept-Encoding");
        await next();
        let { body } = ctx;
        if (!body || ctx.res.headersSent || !ctx.writable || ctx.compress === false || ctx.request.method === "HEAD" ||
            emptyBodyStatues.has(+ctx.response.status) || ctx.response.get("Content-Encoding") ||
            !(ctx.compress === true || filter(ctx.response.type)) || NO_TRANSFORM_REGEX.test(ctx.response.get("Cache-Control")) ||
            (threshold && ctx.response.length < threshold)) return;

        // get the preferred content encoding
        const encodings = new Encodings({ preferredEncodings });
        encodings.parseAcceptEncoding(ctx.request.headers["accept-encoding"] || defaultEncoding);
        const encoding = encodings.getPreferredContentEncoding();

        // no compression
        if (encoding === "identity") return;

        /** compression logic */

        // json
        if (!!body && typeof body !== "string" && typeof body.pipe !== "function" && !Buffer.isBuffer(body))
            body = ctx.body = JSON.stringify(body);

        ctx.set("Content-Encoding", encoding);
        ctx.res.removeHeader("Content-Length");

        const compress = Encodings.encodingMethods[encoding];
        const stream = ctx.body = compress(encodingOptions[encoding]);

        if (body instanceof Stream) return body.pipe(stream);
        stream.end(body);
    }

    Object.assign(compressMiddleware, { preferredEncodings, encodingOptions });

    return compressMiddleware;
}

module.exports = compress;
