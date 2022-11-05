const debug = require("debug")("express:router");
const { parse: parseUrl, format: formatUrl } = require("node:url");
const { METHODS } = require("node:http");
const { pathToRegexp, compile, parse } = require("path-to-regexp");
const HttpError = require("http-errors");
const compose = require("./compose.js");

const httpMethods = METHODS && METHODS.map(method => method.toLowerCase());

class Layer {
    methods = [];
    paramNames = [];

    /**
     * Initialize a new routing Layer with given `method`, `path`, and `middleware`.
     * @param {string|RegExp} path Path string or regular expression.
     * @param {Array} methods Array of HTTP verbs.
     * @param {Array} middleware Layer callback/middleware or series of.
     * @param {object} opts
     * @param {string} opts.name route name
     * @param {string} opts.sensitive case sensitive (default: false)
     * @param {string} opts.strict require the trailing slash (default: false)
     * @param {boolean} opts.ignoreCaptures ignore capture
     * @returns {Layer}
     */
    constructor(path, methods, middleware, opts = {}) {
        debug("new %o", path);
        this.opts = opts;
        this.name = this.opts.name || null;
        this.stack = Array.isArray(middleware) ? middleware : [middleware];
        for (const method of methods) {
            const l = this.methods.push(method.toUpperCase());
            if (this.methods[l - 1] === "GET") this.methods.unshift("HEAD");
        }
        // ensure middleware is a function
        for (let i = 0; i < this.stack.length; i++) {
            const func = this.stack[i], type = typeof func;
            if (type !== "function")
                throw new Error(`${methods.toString()} \`${this.opts.name || path}\`: \`middleware\` must be a function, not \`${type}\``);
        }
        this.path = path;
        this.regexp = pathToRegexp(path, this.paramNames, this.opts);
    }

    /**
     * Returns whether request `path` matches route.
     * @param {string} path
     * @returns {boolean}
     */
    match(path) {
        return this.regexp.test(path);
    }

    /**
     * Returns map of URL parameters for given `path` and `paramNames`.
     * @param {string} path
     * @param {string[]} captures
     * @param {object} params
     * @returns {object}
     */
    params(path, captures, params = {}) {
        for (let i = 0; i < captures.length; i++) {
            if (this.paramNames[i]) {
                const capture = captures[i];
                if (capture && capture.length > 0) {
                    try {
                        params[this.paramNames[i].name] = capture ? decodeURIComponent(capture) : capture;
                    } catch {
                        params[this.paramNames[i].name] = capture;
                    }
                }
            }
        }
        return params;
    }

    /**
     * Returns array of regexp url path captures.
     * @param {string} path
     * @returns {string[]}
     */
    captures(path) {
        return this.opts.ignoreCaptures ? [] : path.match(this.regexp).slice(1);
    }

    /**
     * Generate URL for route using given `params`.
     * @example
     * const route = new Layer('/users/:id', ['GET'], fn);
     * route.url({ id: 123 }); // => "/users/123"
     * @param {object} params url parameters
     * @param {object} options
     * @returns {string}
     */
    url(params, options) {
        let args = params;
        const url = this.path.replace(/\(\.\*\)/g, '');
        if (typeof params !== "object") {
            args = Array.prototype.slice.call(arguments);
            if (typeof args[args.length - 1] === "object") {
                options = args[args.length - 1];
                args = args.slice(0, -1);
            }
        }
        const toPath = compile(url, { encode: encodeURIComponent, ...options });
        let replaced;
        const tokens = parse(url);
        let replace = {};
        if (Array.isArray(args)) {
            for (let i = 0, j = 0; i < tokens.length; i++) {
                if (tokens[i].name) replace[tokens[i].name] = args[j++];
            }
        } else if (tokens.some(token => token.name)) {
            replace = params;
        } else if (!options) {
            options = params;
        }
        replaced = toPath(replace);
        if (options && options.query) {
            replaced = parseUrl(replaced);
            if (typeof options.query === "string") {
                replaced.search = options.query;
            } else {
                replaced.search = undefined;
                replaced.query = options.query;
            }
            return formatUrl(replaced);
        }
        return replaced;
    }

    /**
     * Run validations on route named parameters.
     * @example
     * router
     *   .param('user', function (id, ctx, next) {
     *     ctx.user = users[id];
     *     if (!ctx.user) return ctx.status = 404;
     *     next();
     *   })
     *   .get('/users/:user', function (ctx, next) {
     *     ctx.body = ctx.user;
     *   });
     * @param {string} param
     * @param {function} func
     * @returns {Layer}
     */
    param(param, func) {
        const { stack } = this;
        const params = this.paramNames;
        const middleware = function(ctx, next) { return func.call(this, ctx.params[param], ctx, next); };
        middleware.param = param;
        const names = params.map(function(param) { return param.name; });
        const x = names.indexOf(param);
        if (x > -1) {
            // iterate through the stack, to figure out where to place the handler fn
            stack.some(function(func, i) {
                // param handlers are always first, so when we find an fn w/o a param property, stop here
                // if the param handler at this part of the stack comes after the one we are adding, stop here
                if (!func.param || names.indexOf(func.param) > x) {
                    // inject this param handler right before the current item
                    stack.splice(i, 0, middleware);
                    return true; // then break the loop
                }
            });
        }
        return this;
    }

    /**
     * Prefix route path.
     * @param {string} prefix
     * @returns {Layer}
     */
    setPrefix(prefix) {
        if (this.path) {
            this.path = this.path !== '/' || this.opts.strict === true ? `${prefix}${this.path}` : prefix;
            this.paramNames = [];
            this.regexp = pathToRegexp(this.path, this.paramNames, this.opts);
        }
        return this;
    }

    /**
     * Clone layer instance.
     * @param {Layer} target
     * @return {Layer}
     */
    clone(target) {
        return Object.assign(this, target);
    }
}

class Router {
    params = {};
    stack = [];

    constructor(opts = {}) {
        this.opts = opts;
        this.methods = this.opts.methods || ["HEAD", "OPTIONS", "GET", "PUT", "PATCH", "POST", "DELETE"];
        this.exclusive = Boolean(this.opts.exclusive);
        this.host = this.opts.host;
    }

    /**
     * Use given middleware.
     * Middleware run in the order they are defined by `.use()`. They are invoked sequentially,
     * requests start at the first middleware and work their way "down" the middleware stack.
     * @example
     * // session middleware will run before authorize
     * router.use(session()).use(authorize());
     * // use middleware only with given path
     * router.use('/users', userAuth());
     * // or with an array of paths
     * router.use(['/users', '/admin'], userAuth());
     * app.use(router.routes());
     * @returns {Router}
     */
    use() {
        const router = this;
        const middlewares = Array.prototype.slice.call(arguments);
        let path;

        // support array of paths
        if (Array.isArray(middlewares[0]) && typeof middlewares[0][0] === "string") {
            const arrPaths = middlewares[0];
            for (const arrPath of arrPaths)
                router.use.apply(router, [arrPath].concat(middlewares.slice(1)));
            return this;
        }

        const hasPath = typeof middlewares[0] === "string";
        if (hasPath) path = middlewares.shift();

        for (const middleware of middlewares) {
            if (middleware.router) {
                const cloneRouter = Object.create(Router.prototype).clone(middleware.router, { stack: [...middleware.router.stack] });

                for (let j = 0; j < cloneRouter.stack.length; j++) {
                    const cloneLayer = Object.create(Layer.prototype).clone(cloneRouter.stack[j]);
                    if (path) cloneLayer.setPrefix(path);
                    if (router.opts.prefix) cloneLayer.setPrefix(router.opts.prefix);
                    router.stack.push(cloneLayer);
                    cloneRouter.stack[j] = cloneLayer;
                }

                if (router.params) {
                    for (const key of Object.keys(router.params))
                        cloneRouter.param(key, router.params[key]);
                }
            } else {
                const keys = [];
                pathToRegexp(router.opts.prefix || '', keys);
                const routerPrefixHasParam = router.opts.prefix && keys.length;
                router.register(path || "([^/]*)", [], middleware, {
                    end: false,
                    ignoreCaptures: !hasPath && !routerPrefixHasParam
                });
            }
        }
        return this;
    }

    /**
     * Set the path prefix for a Router instance that was already initialized.
     * @example
     * router.prefix('/things/:thing_id')
     * @param {string} prefix
     * @returns {Router}
     */
    prefix(prefix) {
        prefix = prefix.replace(/\/$/, '');
        this.opts.prefix = prefix;
        for (const route of this.stack)
            route.setPrefix(prefix);
        return this;
    }

    /**
     * Returns router middleware which dispatches a route matching the request.
     * @returns {function}
     */
    routes() {
        const router = this;

        const dispatch = function dispatch(ctx, next) {
            debug("%s %s", ctx.method, ctx.path);

            const hostMatched = router.matchHost(ctx.host);
            if (!hostMatched) return next();

            const path = router.opts.routerPath || ctx.routerPath || ctx.path;
            const matched = router.match(path, ctx.method);
            let layerChain;

            if (ctx.matched)
                ctx.matched.push.apply(ctx.matched, matched.path);
            else
                ctx.matched = matched.path;

            ctx.router = router;

            if (!matched.route) return next();

            const matchedLayers = matched.pathAndMethod;
            const mostSpecificLayer = matchedLayers[matchedLayers.length - 1];
            ctx._matchedRoute = mostSpecificLayer.path;
            if (mostSpecificLayer.name)
                ctx._matchedRouteName = mostSpecificLayer.name;

            layerChain = (router.exclusive ? [mostSpecificLayer] : matchedLayers).reduce(function(memo, layer) {
                memo.push(function(ctx, next) {
                    ctx.captures = layer.captures(path, ctx.captures);
                    ctx.params = ctx.request.params = layer.params(path, ctx.captures, ctx.params);
                    ctx.routerPath = layer.path;
                    ctx.routerName = layer.name;
                    ctx._matchedRoute = layer.path;
                    if (layer.name) ctx._matchedRouteName = layer.name;
                    return next();
                });
                return memo.concat(layer.stack);
            }, []);

            return compose(layerChain)(ctx, next);
        };

        dispatch.router = this;

        return dispatch;
    }

    /**
     * Returns separate middleware for responding to `OPTIONS` requests with an `Allow` header
     * containing the allowed methods, as well as responding with `405 Method Not Allowed` and
     * `501 Not Implemented` as appropriate.
     * @param {object} options
     * @param {boolean} options.throw throw error instead of setting status and header
     * @param {function} options.notImplemented throw the returned value in place of the default NotImplemented error
     * @param {function} options.methodNotAllowed throw the returned value in place of the default MethodNotAllowed error
     * @returns {function}
     */
    allowedMethods(options = {}) {
        const implemented = this.methods;

        return function allowedMethods(ctx, next) {
            return next().then(function() {
                const allowed = {};

                if (!ctx.status || ctx.status === 404) {
                    for (let i = 0; i < ctx.matched.length; i++) {
                        const route = ctx.matched[i];
                        for (let j = 0; j < route.methods.length; j++) {
                            const method = route.methods[j];
                            allowed[method] = method;
                        }
                    }

                    const allowedArr = Object.keys(allowed);

                    if (!~implemented.indexOf(ctx.method)) {
                        if (options.throw) {
                            throw typeof options.notImplemented === "function" ? options.notImplemented() : new HttpError.NotImplemented();
                        } else {
                            ctx.status = 501;
                            ctx.set("Allow", allowedArr.join(", "));
                        }
                    } else if (allowedArr.length > 0) {
                        if (ctx.method === "OPTIONS") {
                            ctx.status = 200;
                            ctx.body = '';
                            ctx.set("Allow", allowedArr.join(", "));
                        } else if (!allowed[ctx.method]) {
                            if (options.throw) {
                                throw typeof options.methodNotAllowed === "function" ? options.methodNotAllowed() : new HttpError.MethodNotAllowed();
                            } else {
                                ctx.status = 405;
                                ctx.set("Allow", allowedArr.join(", "));
                            }
                        }
                    }
                }
            });
        };
    }

    /**
     * Register route with all methods.
     * @param {string} name Optional.
     * @param {string} path
     * @param {function[]} middleware You may also pass multiple middleware.
     * @returns {Router}
     */
    all(name, path, middleware) {
        if (typeof path === "string") {
            middleware = Array.prototype.slice.call(arguments, 2);
        } else {
            middleware = Array.prototype.slice.call(arguments, 1);
            path = name;
            name = null;
        }
        // Sanity check to ensure we have a viable path candidate (eg: string|regex|non-empty array)
        if (typeof path !== "string" && !(path instanceof RegExp) && (!Array.isArray(path) || path.length === 0))
            throw new Error("You have to provide a path when adding an all handler");

        this.register(path, httpMethods, middleware, { name });

        return this;
    }

    /**
     * Redirect `source` to `destination` URL with optional 30x status `code`. Both `source` and `destination` can be route names.
     * ```javascript
     * router.redirect("/login", "sign-in");
     * ```
     * This is equivalent to:
     * ```javascript
     * router.all("/login", ctx => {
     *   ctx.redirect("/sign-in");
     *   ctx.status = 301;
     * });
     * ```
     * @param {string} source URL or route name.
     * @param {string} destination URL or route name.
     * @param {number} code HTTP status code (default: 301).
     * @returns {Router}
     */
    redirect(source, destination, code) {
        // lookup source route by name
        if (typeof source === "symbol" || source[0] !== "/") {
            source = this.url(source);
            if (source instanceof Error) throw source;
        }
        // lookup destination route by name
        if (typeof destination === "symbol" || (destination[0] !== "/" && !destination.includes("://"))) {
            destination = this.url(destination);
            if (destination instanceof Error) throw destination;
        }
        return this.all(source, ctx => {
            ctx.redirect(destination);
            ctx.status = code || 301;
        });
    }

    /**
     * Create and register a route.
     * @param {string} path Path string.
     * @param {string[]} methods Array of HTTP verbs.
     * @param {function[]} middleware Multiple middleware also accepted.
     * @param {object} opts
     * @returns {Layer}
     */
    register(path, methods, middleware, opts = {}) {
        const router = this;
        const { stack } = this;

        // support array of paths
        if (Array.isArray(path)) {
            for (const curPath of path) {
                router.register.call(router, curPath, methods, middleware, opts);
            }
            return this;
        }

        // create route
        const route = new Layer(path, methods, middleware, {
            end: opts.end === false ? opts.end : true,
            name: opts.name,
            sensitive: opts.sensitive || this.opts.sensitive || false,
            strict: opts.strict || this.opts.strict || false,
            prefix: opts.prefix || this.opts.prefix || '',
            ignoreCaptures: opts.ignoreCaptures
        });

        if (this.opts.prefix) route.setPrefix(this.opts.prefix);

        // add parameter middleware
        for (const param of Object.keys(this.params))
            route.param(param, this.params[param]);

        stack.push(route);

        debug("defined route %s %s", route.methods, route.path);

        return route;
    }

    /**
     * Lookup route with given `name`.
     * @param {string} name
     * @returns {Layer|false}
     */
    route(name) {
        const routes = this.stack;
        for (const route of routes) {
            if (route.name && route.name === name) return route;
        }
        return false;
    }

    /**
     * Generate URL for route. Takes a route name and map of named `params`.
     * @param {string} name route name
     * @param {object} params url parameters
     * @returns {string|Error}
     */
    url(name, params) {
        const route = this.route(name);
        if (route) {
            const args = Array.prototype.slice.call(arguments, 1);
            return route.url.apply(route, args);
        }
        return new Error(`No route found for name: ${String(name)}`);
    }

    /**
     * Match given `path` and return corresponding routes.
     * @param {string} path
     * @param {string} method
     * @return {{path:string[],route:boolean,pathAndMethod:string[]}}
     */
    match(path, method) {
        const matched = { path: [], pathAndMethod: [], route: false };
        for (const layer of this.stack) {
            debug("test %s %s", layer.path, layer.regexp);
            if (layer.match(path)) {
                matched.path.push(layer);
                if (layer.methods.length === 0 || ~layer.methods.indexOf(method)) {
                    matched.pathAndMethod.push(layer);
                    if (layer.methods.length > 0) matched.route = true;
                }
            }
        }
        return matched;
    }

    /**
     * Match given `input` to allowed host
     * @param {string} input
     * @returns {boolean}
     */
    matchHost(input) {
        const { host } = this;
        switch (true) {
            case !host:  return true;
            case !input: return false;
            case typeof host === "string":
                return input === host;
            case typeof host === "object" && host instanceof RegExp:
                return host.test(input);
        }
    }

    /**
     * Run middleware for named route parameters. Useful for auto-loading or validation.
     * @param {string} param
     * @param {function} middleware
     * @return {Router}
     */
    param(param, middleware) {
        this.params[param] = middleware;
        for (let i = 0; i < this.stack.length; i++) {
            const route = this.stack[i];
            route.param(param, middleware);
        }
        return this;
    }

    /**
     * Clone router instance.
     * @param {Router} target
     * @param {object} override
     */
    clone(target, override) {
        return Object.assign(this, target, { stack: [...target.stack] });
    }
}

for (const method of httpMethods) {
    Router.prototype[method] = function(name, path, middleware) {
        if (typeof path === "string" || path instanceof RegExp) {
            middleware = Array.prototype.slice.call(arguments, 2);
        } else {
            middleware = Array.prototype.slice.call(arguments, 1);
            path = name;
            name = null;
        }
        // Sanity check to ensure we have a viable path candidate (eg: string|regex|non-empty array)
        if (typeof path !== "string" && !(path instanceof RegExp) && (!Array.isArray(path) || path.length === 0))
            throw new Error(`You have to provide a path when adding a ${method} handler`);
        this.register(path, [method], middleware, { name });
        return this;
    };
}

module.exports = Router;
