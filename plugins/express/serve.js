const debug = require("debug")("express:static");
const { normalize, basename, extname, resolve, join, parse, sep } = require("node:path");
const { stat, access } = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const assert = require("node:assert");
const createError = require("http-errors")
const resolvePath = require("resolve-path");

function serveStatic(root, opts = {}) {
    assert(root, "root directory is required to serve files");

    debug(`static "%s" %j`, root, opts);
    opts.root = resolve(root);
    opts.index = opts.index ?? "index.html";

    if (opts.defer) {
        return async function serveStatic(ctx, next) {
            await next();
            if (ctx.method !== "HEAD" && ctx.method !== "GET") return;
            if (ctx.body != null || ctx.status !== 404) return;
            try {
                await send(ctx, ctx.path, opts);
            } catch (err) {
                if (err.status !== 404) throw err;
            }
        }
    } else {
        return async function serveStatic(ctx, next) {
            let done = false;
            if (ctx.method !== "HEAD" && ctx.method !== "GET") return;
            try {
                done = await send(ctx, ctx.path, opts);
            } catch (err) {
                if (err.status !== 404) throw err;
            }
            if (!done) await next();
        }
    }
}

function serveRender(path, { extension = "html" } = {}) {
    return function serveRender(ctx, next) {
        let extendsContext = false;
        function render(relativePath) {
            if (extendsContext)
                ctx = this.ctx && this.ctx.req === this.req ? this.ctx : this;
            return getFile(path, relativePath, extension).then(({ rel, ext }) => {
                debug("render %s with %s", rel, ctx.state);
                ctx.type = "text/html";
                if (ext === "html") {
                    return send(ctx, rel, { root: path });
                } else throw new TypeError("No render engine registered");
            });
        }
        if (!ctx) {
            extendsContext = true;
            return render;
        }
        if (ctx.render) return next();
        ctx.response.render = ctx.render = render;
        return next();
    }
}

/**
 * Send a file.
 * @param {Context} ctx
 * @param {string} path
 * @param {object} opts
 * @return {Promise<string, void>}
 */
async function send(ctx, path, opts = {}) {
    assert(ctx, "context required");
    assert(path, "pathname required");
    debug(`send "%s" %j`, path, opts);
    const root = opts.root ? normalize(resolve(opts.root)) : '';
    const trailingSlash = path[path.length - 1] === "/";
    path = path.substring(parse(path).root.length);
    const index = opts.index;
    const maxAge = opts.maxAge || 0;
    const immutable = opts.immutable || false;
    const hidden = opts.hidden || false;
    const format = opts.format !== false;
    const extensions = Array.isArray(opts.extensions) ? opts.extensions : false;
    const brotli = opts.brotli !== false;
    const gzip = opts.gzip !== false;
    const setHeaders = opts.setHeaders;

    if (setHeaders && typeof setHeaders !== "function")
        throw new TypeError("option setHeaders must be function");

    // normalize path
    try { path = decodeURIComponent(path); } catch { return ctx.throw(400, "failed to decode"); }

    // index file support
    if (index && trailingSlash) path += index;
    path = resolvePath(root, path);

    // hidden file support, ignore
    if (!hidden && isHidden(root, path)) return;

    let encodingExt = '';
    // serve brotli file when possible otherwise gzipped file when possible
    if (ctx.acceptsEncodings("br", "identity") === "br" && brotli && (await exists(path + ".br"))) {
        path = path + ".br";
        ctx.set("Content-Encoding", "br");
        ctx.res.removeHeader("Content-Length");
        encodingExt = ".br";
    } else if (ctx.acceptsEncodings("gzip", "identity") === "gzip" && gzip && (await exists(path + ".gz"))) {
        path = path + ".gz";
        ctx.set("Content-Encoding", "gzip");
        ctx.res.removeHeader("Content-Length");
        encodingExt = ".gz";
    }

    if (extensions && !/\./.exec(basename(path))) {
        const list = [].concat(extensions);
        for (let i = 0; i < list.length; i++) {
            let ext = list[i];
            if (typeof ext !== "string") throw new TypeError("option extensions must be array of strings or false");
            if (!/^\./.exec(ext)) ext = `.${ext}`;
            if (await exists(`${path}${ext}`)) {
                path = `${path}${ext}`;
                break;
            }
        }
    }

    // stat
    let stats;
    try {
        stats = await stat(path);

        // Format the path to serve static file servers and not require a trailing slash for directories,
        // so that you can do both `/directory` and `/directory/`
        if (stats.isDirectory()) {
            if (format && index) {
                path += `/${index}`;
                stats = await stat(path);
            } else return;
        }
    } catch (err) {
        const notfound = ["ENOENT", "ENAMETOOLONG", "ENOTDIR"];
        if (notfound.includes(err.code)) throw createError(404, err);
        err.status = 500;
        throw err;
    }

    if (setHeaders) setHeaders(ctx.res, path, stats);

    // stream
    ctx.set("Content-Length", stats.size);
    if (!ctx.response.get("Last-Modified")) ctx.set("Last-Modified", stats.mtime.toUTCString());
    if (!ctx.response.get("Cache-Control")) {
        const directives = [`max-age=${(maxAge / 1000 | 0)}`];
        if (immutable) directives.push("immutable");
        ctx.set("Cache-Control", directives.join(","));
    }
    if (!ctx.type) ctx.type = encodingExt !== '' ? extname(basename(path, encodingExt)) : extname(path);
    ctx.body = createReadStream(path);

    return path;
}

/**
 * Check file exists.
 * @param {string} path
 * @return {Promise<boolean>}
 */
async function exists(path) {
    try {
        await access(path);
        return true;
    } catch { return false; }
}

/**
 * Target is a hidden file.
 * @param {string} root
 * @param {string} path
 * @return {boolean}
 */
function isHidden(root, path) {
    for (const part of path.substring(root.length).split(sep)) {
        if (part[0] === ".") return true;
    }
    return false;
}

/**
 * Get a file info.
 * @param {string} absolutePath
 * @param {string} relativePath
 * @param {string} ext
 * @return {Promise<{rel:string,ext:string}>}
 */
function getFile(absolutePath, relativePath, ext) {
    return stat(join(absolutePath, relativePath)).
        then(stats => stats.isDirectory() ?
            { rel: join(relativePath, `index.${ext}`), ext } :
            { rel: relativePath, ext: extname(relativePath).slice(1) }).
        catch(err => {
            if (!extname(relativePath) || extname(relativePath).slice(1) !== ext)
                return getFile(absolutePath, `${relativePath}.${ext}`, ext);
            throw err;
        });
}

module.exports = { serveStatic, serveRender, send };
