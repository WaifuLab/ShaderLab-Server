const request = require("supertest");
const assert = require("node:assert");
const { stdout, stderr } = require("node:process");
const Stream = require("node:stream");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const express = require("../plugins/express");
const { captureStream } = require("../utils/capture.js");

function testContext(req, res, app) {
    const socket = new Stream.Duplex();
    req = Object.assign({ headers: {}, socket }, Stream.Readable.prototype, req);
    res = Object.assign({ _headers: {}, socket }, Stream.Writable.prototype, res);
    req.socket.remoteAddress ??= "127.0.0.1";
    app ??= new express();
    res.hasHeader = k => k.toLowerCase() in res._headers;
    res.getHeaders = () => res._headers;
    res.getHeader = k => res._headers[k.toLowerCase()];
    res.setHeader = (k, v) => { res._headers[k.toLowerCase()] = v };
    res.removeHeader = (k, v) => delete res._headers[k.toLowerCase()];
    return app.createContext(req, res);
}

function testRequest(req, res, app) {
    return testContext(req, res, app).request;
}

function testResponse(req, res, app) {
    return testContext(req, res, app).response;
}

describe("Express test", () => {
    describe("app test", () => {
        it("should not .writeHead when !socket.writable", done => {
            const app = new express();
            app.use((ctx, next) => {
                // set .writable to false
                ctx.socket.writable = false;
                ctx.status = 204;
                // throw if .writeHead or .end is called
                ctx.res.writeHead = ctx.res.end = () => { throw new Error("response sent"); };
            });
            // hackish, but the response should occur in a single tick
            setImmediate(done);
            request(app.callback()).get("/").end(() => {});
        });
        it("should set development env when NODE_ENV missing", () => {
            const NODE_ENV = process.env.NODE_ENV;
            process.env.NODE_ENV = '';
            const app = new express();
            process.env.NODE_ENV = NODE_ENV;
            assert.strictEqual(app.env, "development");
        });
        it("should set env from the constructor", () => {
            const env = "custom";
            const app = new express({ env });
            assert.strictEqual(app.env, env);
        });
        it("should set proxy flag from the constructor", () => {
            const proxy = true;
            const app = new express({ proxy });
            assert.strictEqual(app.proxy, proxy);
        });
        it("should set signed cookie keys from the constructor", () => {
            const keys = ["customkey"];
            const app = new express({ keys });
            assert.strictEqual(app.keys, keys);
        });
        it("should set subdomainOffset from the constructor", () => {
            const subdomainOffset = 3;
            const app = new express({ subdomainOffset });
            assert.strictEqual(app.subdomainOffset, subdomainOffset);
        });
        it("should set compose from the constructor", () => {
            const compose = () => (ctx) => {};
            const app = new express({ compose });
            assert.strictEqual(app.compose, compose);
        });
        it("should have a static property exporting `HttpError` from http-errors library", () => {
            const CreateError = require("http-errors");
            assert.strictEqual("HttpError" in express, true);
            assert.deepStrictEqual(express.HttpError, CreateError.HttpError);
            assert.throws(() => { throw new CreateError(500, "test error") }, express.HttpError);
        });
    });
    describe("app use test", () => {
        it("should compose middleware", async () => {
            const app = new express(), calls = [];
            app.use((ctx, next) => {
                calls.push(1);
                return next().then(() => calls.push(6));
            });
            app.use((ctx, next) => {
                calls.push(2)
                return next().then(() => calls.push(5));
            });
            app.use((ctx, next) => {
                calls.push(3)
                return next().then(() => calls.push(4));
            });
            const server = app.listen();
            await request(server).get("/").expect(404);
            assert.deepStrictEqual(calls, [1, 2, 3, 4, 5, 6]);
        });
        it("should compose mixed middleware", async () => {
            const app = new express(), calls = [];
            app.use((ctx, next) => {
                calls.push(1);
                return next().then(() => calls.push(6));
            });
            app.use(async (ctx, next) => {
                calls.push(2);
                await next();
                calls.push(5);
            });
            app.use((ctx, next) => {
                calls.push(3);
                return next().then(() => calls.push(4));
            });
            const server = app.listen();
            await request(server).get("/").expect(404);
            assert.deepStrictEqual(calls, [1, 2, 3, 4, 5, 6]);
        });
        it("should catch thrown errors in non-async functions", () => {
            const app = new express();
            app.use(ctx => ctx.throw(404, "Not Found"));
            return request(app.callback()).get("/").expect(404);
        });
        it("should throw error for non-function", () => {
            const app = new express();
            [null, undefined, 0, false, "not a function"].forEach(v => assert.throws(() => app.use(v), /middleware must be a function!/));
        });
    });
    describe("app compose test", () => {
        const compose = require("../plugins/express/compose.js");
        // https://github.com/koajs/compose/commit/37d083f
        it("should work in correct order", async () => {
            const arr = [], stack = [];
            stack.push(async (context, next) => {
                arr.push(1);
                await (new Promise(resolve => setTimeout(resolve, 1)));
                await next();
                await (new Promise(resolve => setTimeout(resolve, 1)));
                arr.push(6);
            });
            stack.push(async (context, next) => {
                arr.push(2);
                await (new Promise(resolve => setTimeout(resolve, 1)));
                await next();
                await (new Promise(resolve => setTimeout(resolve, 1)));
                arr.push(5);
            });
            stack.push(async (context, next) => {
                arr.push(3);
                await (new Promise(resolve => setTimeout(resolve, 1)));
                await next();
                await (new Promise(resolve => setTimeout(resolve, 1)));
                arr.push(4);
            });
            await compose(stack)({});
            assert.deepStrictEqual(arr, [1, 2, 3, 4, 5, 6]);
        });
        it("should be able to be called twice", () => {
            const stack = [];
            stack.push(async (context, next) => {
                context.arr.push(1);
                await (new Promise(resolve => setTimeout(resolve, 1)));
                await next();
                await (new Promise(resolve => setTimeout(resolve, 1)));
                context.arr.push(6);
            });
            stack.push(async (context, next) => {
                context.arr.push(2);
                await (new Promise(resolve => setTimeout(resolve, 1)));
                await next();
                await (new Promise(resolve => setTimeout(resolve, 1)));
                context.arr.push(5);
            });
            stack.push(async (context, next) => {
                context.arr.push(3);
                await (new Promise(resolve => setTimeout(resolve, 1)));
                await next();
                await (new Promise(resolve => setTimeout(resolve, 1)));
                context.arr.push(4);
            });
            const ctx1 = { arr: [] }, ctx2 = { arr: [] };
            return compose(stack)(ctx1).then(() => {
                assert.deepStrictEqual(ctx1.arr, [1, 2, 3, 4, 5, 6]);
                return compose(stack)(ctx2);
            }).then(() => {
                assert.deepStrictEqual(ctx2.arr, [1, 2, 3, 4, 5, 6]);
            });
        });
        it("should only accept an array", () => {
            assert.throws(() => compose(), TypeError);
        });
        it("should create next functions that return a Promise", () => {
            const stack = [], arr = [];
            for (let i = 0; i < 5; i++) stack.push((context, next) => arr.push(next()));
            compose(stack)({});
            for (const next of arr) assert(next && typeof next.then === "function", "one of the functions next is not a Promise");
        });
        it("should work with 0 middleware", () => {
            return compose([])({});
        });
        it("should only accept middleware as functions", async () => {
            try {
                await compose([{}]);
            } catch (err) {
                assert.strictEqual(err instanceof TypeError, true);
            }
        });
        it("should work when yielding at the end of the stack", async () => {
            const stack = [];
            let called = false;
            stack.push(async (ctx, next) => {
                await next();
                called = true;
            });
            await compose(stack)({});
            assert(called);
        });
        it("should reject on errors in middleware", () => {
            const stack = [];
            stack.push(() => { throw new Error(); });
            return compose(stack)({}).then(() => {
                throw new Error("promise was not rejected");
            }, err => {
                assert.strictEqual(err instanceof Error, true);
            });
        });
        it("should keep the context", () => {
            const ctx = {}, stack = [];
            stack.push(async (ctx2, next) => {
                await next();
                assert.strictEqual(ctx2, ctx);
            });
            stack.push(async (ctx2, next) => {
                await next();
                assert.strictEqual(ctx2, ctx);
            });
            stack.push(async (ctx2, next) => {
                await next();
                assert.strictEqual(ctx2, ctx);
            });
            return compose(stack)(ctx);
        });
        it("should catch downstream errors", async () => {
            const arr = [], stack = [];
            stack.push(async (ctx, next) => {
                arr.push(1);
                try {
                    arr.push(6);
                    await next();
                    arr.push(7);
                } catch (err) {
                    arr.push(2);
                }
                arr.push(3);
            });
            stack.push(async (ctx, next) => {
                arr.push(4);
                throw new Error();
            });
            await compose(stack)({});
            assert.deepStrictEqual(arr, [1, 6, 4, 2, 3]);
        });
        it("should compose w/ next", () => {
            let called = false;
            return compose([])({}, async () => {
                called = true;
            }).then(() => assert(called));
        });
        it("should handle errors in wrapped non-async functions", async () => {
            const stack = [];
            stack.push(() => { throw new Error(); });
            await compose(stack)({}).then(() => {
                throw new Error("promise was not rejected");
            }, err => assert(err instanceof Error));
        });
        it("should compose w/ other compositions", () => {
            const called = [];
            return compose([
                compose([
                    (ctx, next) => {
                        called.push(1);
                        return next();
                    },
                    (ctx, next) => {
                        called.push(2);
                        return next();
                    }
                ]),
                (ctx, next) => {
                    called.push(3);
                    return next();
                }
            ])({}).then(() => assert.deepStrictEqual(called, [1, 2, 3]));
        })
        it("should throw if next() is called multiple times", () => {
            return compose([async (ctx, next) => {
                await next();
                await next();
            }])({}).then(() => {
                throw new Error("boom");
            }, err => {
                assert(/multiple times/.test(err.message));
            });
        });
        it("should return a valid middleware", () => {
            let val = 0;
            return compose([
                compose([
                    (ctx, next) => {
                        val++;
                        return next();
                    },
                    (ctx, next) => {
                        val++;
                        return next();
                    }
                ]),
                (ctx, next) => {
                    val++;
                    return next();
                }
            ])({}).then(() => {
                assert.strictEqual(val, 3);
            });
        });
        it("should return last return value", () => {
            const stack = [];
            stack.push(async (context, next) => {
                const val = await next();
                assert.strictEqual(val, 2);
                return 1;
            });
            stack.push(async (context, next) => {
                const val = await next();
                assert.strictEqual(val, 0);
                return 2;
            });
            const next = () => 0;
            return compose(stack)({}, next).then(val => {
                assert.strictEqual(val, 1);
            });
        });
        it("should not affect the original middleware array", () => {
            const middleware = [];
            const fn1 = (ctx, next) => next();
            middleware.push(fn1);
            for (const fn of middleware)
                assert.equal(fn, fn1);
            compose(middleware);
            for (const fn of middleware)
                assert.equal(fn, fn1);
        });
        it("should not get stuck on the passed in next", () => {
            const middleware = [(ctx, next) => {
                ctx.middleware++;
                return next();
            }]
            const ctx = { middleware: 0, next: 0 };
            return compose(middleware)(ctx, (ctx, next) => {
                ctx.next++;
                return next();
            }).then(() => {
                assert.deepStrictEqual(ctx, { middleware: 1, next: 1 });
            });
        });
        it("should work with default compose ", async () => {
            const app = new express();
            const calls = [];
            app.use((ctx, next) => {
                calls.push(1);
                return next().then(() => calls.push(4));
            });
            app.use((ctx, next) => {
                calls.push(2);
                return next().then(() => calls.push(3));
            });
            const server = app.listen();
            await request(server).get("/").expect(404);
            assert.deepStrictEqual(calls, [1, 2, 3, 4]);
        });
        it("should work with configurable compose", async () => {
            const calls = []
            let count = 0
            const app = new express({
                compose (fns){
                    return async (ctx) => {
                        const dispatch = async function () {
                            count++;
                            const fn = fns.shift();
                            fn && fn(ctx, dispatch);
                        }
                        dispatch();
                    }
                }
            });
            app.use((ctx, next) => {
                calls.push(1);
                next();
                calls.push(4);
            });
            app.use((ctx, next) => {
                calls.push(2);
                next();
                calls.push(3);
            });
            const server = app.listen();
            await request(server).get("/");
            assert.deepStrictEqual(calls, [1, 2, 3, 4]);
            assert.equal(count, 3);
        });
    });
    describe("app onerror test", () => {
        it("should throw an error if a non-error is given", () => {
            const app = new express();
            assert.throws(() => app.onerror("foo"), TypeError, "non-error thrown: foo");
        });
        it("should accept errors coming from other scopes", () => {
            const ExternError = require("node:vm").runInNewContext("Error");
            const app = new express();
            const error = Object.assign(new ExternError("boom"), { status: 418, expose: true });
            assert.doesNotThrow(() => app.onerror(error));
        });
        it("should do nothing if status is 404", () => {
            const app = new express();
            const err = new Error();
            err.status = 404;
            assert.doesNotThrow(() => app.onerror(err));
        });
        it("should do nothing if .silent", () => {
            const app = new express();
            app.silent = true;
            const err = new Error();
            assert.doesNotThrow(() => app.onerror(err));
        });
        it("should log the error to stderr", () => {
            const app = new express();
            app.env = "dev";
            const err = new Error();
            err.stack = "Foo";
            const hook = captureStream(stderr);
            app.onerror(err);
            assert(hook.captured().includes("Foo"));
            hook.unhook();
        });
    });
    describe("app respond test", () => {
        describe("when ctx.respond === false", () => {
            it("should function (ctx)", () => {
                const app = new express();
                app.use(ctx => {
                    ctx.body = "Hello";
                    ctx.respond = false;
                    const res = ctx.res;
                    res.statusCode = 200;
                    setImmediate(() => {
                        res.setHeader("Content-Type", "text/plain");
                        res.setHeader("Content-Length", "3");
                        res.end("lol");
                    });
                });
                const server = app.listen()
                return request(server).get("/").expect(200).expect("lol");
            });
            it("should ignore set header after header sent", () => {
                const app = new express();
                app.use(ctx => {
                    ctx.body = "Hello";
                    ctx.respond = false;
                    const res = ctx.res;
                    res.statusCode = 200;
                    res.setHeader("Content-Type", "text/plain");
                    res.setHeader("Content-Length", "3");
                    res.end("lol");
                    ctx.set("foo", "bar");
                });
                const server = app.listen();
                return request(server).get("/").expect(200).expect("lol").expect(res => assert(!res.headers.foo));
            });
            it("should ignore set status after header sent", () => {
                const app = new express();
                app.use(ctx => {
                    ctx.body = "Hello";
                    ctx.respond = false;
                    const res = ctx.res;
                    res.statusCode = 200;
                    res.setHeader("Content-Type", "text/plain");
                    res.setHeader("Content-Length", "3");
                    res.end("lol");
                    ctx.status = 201;
                });
                const server = app.listen();
                return request(server).get("/").expect(200).expect("lol");
            });
        });
        describe("when this.type === null", () => {
            it("should not send Content-Type header", async () => {
                const app = new express();
                app.use(ctx => {
                    ctx.body = '';
                    ctx.type = null;
                });
                const server = app.listen();
                const res = await request(server).get("/").expect(200);
                assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "Content-Type"), false);
            });
        });
        describe("when HEAD is used", () => {
            it("should not respond with the body", async () => {
                const app = new express();
                app.use(ctx => { ctx.body = "Hello"; })
                const server = app.listen();
                const res = await request(server).head("/").expect(200);
                assert.strictEqual(res.headers["content-type"], "text/plain; charset=utf-8");
                assert.strictEqual(res.headers["content-length"], "5");
                assert(!res.text);
            });
            it("should keep json headers", async () => {
                const app = new express();
                app.use(ctx => { ctx.body = { hello: "world" }; });
                const server = app.listen();
                const res = await request(server).head("/").expect(200);
                assert.strictEqual(res.headers["content-type"], "application/json; charset=utf-8");
                assert.strictEqual(res.headers["content-length"], "17");
                assert(!res.text);
            });
            it("should keep string headers", async () => {
                const app = new express();
                app.use(ctx => { ctx.body = "hello world"; });
                const server = app.listen();
                const res = await request(server).head("/").expect(200);
                assert.strictEqual(res.headers["content-type"], "text/plain; charset=utf-8");
                assert.strictEqual(res.headers["content-length"], "11");
                assert(!res.text);
            });
            it("should keep buffer headers", async () => {
                const app = new express();
                app.use(ctx => { ctx.body = Buffer.from("hello world") });
                const server = app.listen();
                const res = await request(server).head("/").expect(200);
                assert.strictEqual(res.headers["content-type"], "application/octet-stream");
                assert.strictEqual(res.headers["content-length"], "11");
                assert(!res.text);
            });
            it("should keep stream header if set manually", async () => {
                const { readFileSync, createReadStream } = require("node:fs");
                const app = new express();
                const { length } = readFileSync("package.json");
                app.use(ctx => {
                    ctx.length = length;
                    ctx.body = createReadStream("package.json");
                });
                const server = app.listen();
                const res = await request(server).head("/").expect(200);
                assert.strictEqual(~~res.header["content-length"], length);
                assert(!res.text);
            });
            it("should respond with a 404 if no body was set", () => {
                const app = new express();
                app.use(ctx => { });
                const server = app.listen();
                return request(server).head("/").expect(404);
            });
            it("should respond with a 200 if body = ''", () => {
                const app = new express();
                app.use(ctx => ctx.body = '');
                const server = app.listen();
                return request(server).head("/").expect(200);
            });
            it("should not overwrite the content-type", () => {
                const app = new express();
                app.use(ctx => {
                    ctx.status = 200;
                    ctx.type = "application/javascript";
                });
                const server = app.listen();
                return request(server).head("/").expect("content-type", /application\/javascript/).expect(200);
            });
        });
        describe("when no middleware is present", () => {
            it("should 404", () => {
                const app = new express();
                const server = app.listen();
                return request(server).get("/").expect(404);
            });
        });
        describe("when res has already been written to", () => {
            it("should not cause an app error", () => {
                const app = new express();
                app.use((ctx, next) => {
                    const res = ctx.res;
                    ctx.status = 200;
                    res.setHeader("Content-Type", "text/html");
                    res.write("Hello");
                });
                app.on("error", err => { throw err; });
                const server = app.listen();
                return request(server).get("/").expect(200);
            });
            it("should send the right body", () => {
                const app = new express();
                app.use((ctx, next) => {
                    const res = ctx.res;
                    ctx.status = 200;
                    res.setHeader("Content-Type", "text/html");
                    res.write("Hello");
                    return new Promise(resolve => {
                        setTimeout(() => {
                            res.end("Goodbye");
                            resolve();
                        }, 0);
                    });
                });
                const server = app.listen();
                return request(server).get("/").expect(200).expect("HelloGoodbye");
            });
        });
        describe("when .body is missing", () => {
            describe("with status=400", () => {
                it("should respond with the associated status message", () => {
                    const app = new express();
                    app.use(ctx => ctx.status = 400);
                    const server = app.listen();
                    return request(server).get("/").expect(400).expect("Content-Length", "11").expect("Bad Request");
                });
            });
            describe("with status=204", () => {
                it("should respond without a body", async () => {
                    const app = new express();
                    app.use(ctx => ctx.status = 204);
                    const server = app.listen();
                    const res = await request(server).get("/").expect(204).expect('');
                    assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "Content-Type"), false);
                });
            });
            describe("with status=205", () => {
                it("should respond without a body", async () => {
                    const app = new express();
                    app.use(ctx => ctx.status = 205);
                    const server = app.listen();
                    const res = await request(server).get("/").expect(205).expect('');
                    assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "Content-Type"), false);
                });
            });
            describe("with status=304", () => {
                it("should respond without a body", async () => {
                    const app = new express();
                    app.use(ctx => ctx.status = 304);
                    const server = app.listen();
                    const res = await request(server).get("/").expect(304).expect('');
                    assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "Content-Type"), false);
                });
            });
            describe("with custom status=700", () => {
                it("should respond with the associated status message", async () => {
                    const statuses = require("statuses");
                    const app = new express();
                    statuses.message["700"] = "custom status";
                    app.use(ctx => ctx.status = 700);
                    const server = app.listen();
                    const res = await request(server).get("/").expect(700).expect("custom status");
                    assert.strictEqual(res.res.statusMessage, "custom status");
                });
            });
            describe("with custom statusMessage=ok", () => {
                it("should respond with the custom status message", async () => {
                    const app = new express();
                    app.use(ctx => {
                        ctx.status = 200;
                        ctx.message = "ok";
                    });
                    const server = app.listen();
                    const res = await request(server).get("/").expect(200).expect("ok");
                    assert.strictEqual(res.res.statusMessage, "ok");
                });
            });
            describe("with custom status without message", () => {
                it("should respond with the status code number", () => {
                    const app = new express();
                    app.use(ctx => ctx.res.statusCode = 701);
                    const server = app.listen();
                    return request(server).get("/").expect(701).expect("701");
                });
            });
        });
        describe("when .body is a null", () => {
            it("should respond 204 by default", async () => {
                const app = new express();
                app.use(ctx => { ctx.body = null });
                const server = app.listen();
                const res = await request(server).get("/").expect(204).expect('');
                assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "Content-Type"), false);
            });
            it("should respond 204 with status=200", async () => {
                const app = new express();
                app.use(ctx => {
                    ctx.status = 200;
                    ctx.body = null;
                });
                const server = app.listen();
                const res = await request(server).get("/").expect(204).expect('');
                assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "Content-Type"), false);
            });
            it("should respond 205 with status=205", async () => {
                const app = new express();
                app.use(ctx => {
                    ctx.status = 205;
                    ctx.body = null;
                });
                const server = app.listen();
                const res = await request(server).get("/").expect(205).expect('');
                assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "Content-Type"), false);
            });
            it("should respond 304 with status=304", async () => {
                const app = new express();
                app.use(ctx => {
                    ctx.status = 304;
                    ctx.body = null;
                });
                const server = app.listen();
                const res = await request(server).get("/").expect(304).expect('');
                assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "Content-Type"), false);
            });
        });
        describe("when .body is a string", () => {
            it("should respond", () => {
                const app = new express();
                app.use(ctx => ctx.body = "Hello");
                const server = app.listen();
                return request(server).get("/").expect("Hello");
            });
        });
        describe("when .body is a Buffer", () => {
            it("should respond", () => {
                const app = new express();
                app.use(ctx => ctx.body = Buffer.from("Hello"));
                const server = app.listen();
                return request(server).get("/").expect(200).expect(Buffer.from("Hello"));
            });
        });
        describe("when .body is a Stream", () => {
            it("should respond", async () => {
                const { createReadStream } = require("node:fs");
                const app = new express();
                app.use(ctx => {
                    ctx.body = createReadStream("package.json");
                    ctx.set("Content-Type", "application/json; charset=utf-8");
                });
                const server = app.listen();
                const res = await request(server).get("/").expect("Content-Type", "application/json; charset=utf-8");
                const pkg = require("../package.json");
                assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "content-length"), false);
                assert.deepStrictEqual(res.body, pkg);
            });
            it("should strip content-length when overwriting", async () => {
                const { createReadStream } = require("node:fs");
                const app = new express();
                app.use(ctx => {
                    ctx.body = "hello";
                    ctx.body = createReadStream("package.json");
                    ctx.set("Content-Type", "application/json; charset=utf-8");
                });
                const server = app.listen();
                const res = await request(server).get("/").expect("Content-Type", "application/json; charset=utf-8");
                const pkg = require("../package.json")
                assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "content-length"), false);
                assert.deepStrictEqual(res.body, pkg);
            });
            it("should keep content-length if not overwritten", async () => {
                const { readFileSync, createReadStream } = require("node:fs");
                const app = new express();
                app.use(ctx => {
                    ctx.length = readFileSync("package.json").length;
                    ctx.body = createReadStream("package.json");
                    ctx.set("Content-Type", "application/json; charset=utf-8");
                });
                const server = app.listen();
                const res = await request(server).get("/").expect("Content-Type", "application/json; charset=utf-8");
                const pkg = require("../package.json");
                assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "content-length"), true);
                assert.deepStrictEqual(res.body, pkg);
            })
        });
        describe("when .body is an Object", () => {
            it("should respond with json", () => {
                const app = new express();
                app.use(ctx => ctx.body = { hello: "world" });
                const server = app.listen();
                return request(server).get("/").expect("Content-Type", "application/json; charset=utf-8").expect('{"hello":"world"}');
            })
            describe("and headers sent", () => {
                it("should respond with json body and headers", () => {
                    const app = new express();
                    app.use(ctx => {
                        ctx.length = 17
                        ctx.type = "json"
                        ctx.set("foo", "bar")
                        ctx.res.flushHeaders()
                        ctx.body = { hello: "world" }
                    });
                    const server = app.listen();
                    return request(server).get("/").expect("Content-Type", "application/json; charset=utf-8").expect("Content-Length", "17").expect("foo", "bar").expect('{"hello":"world"}');
                });
            });
        });
        describe("when an error occurs", () => {
            it("should emit 'error' on the app", done => {
                const app = new express();
                app.use(ctx => { throw new Error("boom") });
                app.on("error", err => {
                    assert.strictEqual(err.message, "boom");
                    done();
                });
                request(app.callback()).get("/").end(() => {});
            });
            describe("with an .expose property", () => {
                it("should expose the message", () => {
                    const app = new express();
                    app.use(ctx => {
                        const err = new Error("sorry!");
                        err.status = 403;
                        err.expose = true;
                        throw err;
                    });
                    return request(app.callback()).get("/").expect(403, "sorry!");
                });
            });
            describe("with a .status property", () => {
                it("should respond with .status", () => {
                    const app = new express();
                    app.use(ctx => {
                        const err = new Error("s3 explodes");
                        err.status = 403;
                        throw err;
                    });
                    return request(app.callback()).get("/").expect(403, "Forbidden");
                });
            });
            it("should respond with 500", () => {
                const app = new express();
                app.use(ctx => { throw new Error("boom!"); });
                const server = app.listen();
                return request(server).get("/").expect(500, "Internal Server Error");
            });
            it("should be catchable", () => {
                const app = new express();
                app.use((ctx, next) => next().then(() => ctx.body = "Hello").catch(() => ctx.body = "Got error"));
                app.use((ctx, next) => { throw new Error("boom!"); });
                const server = app.listen();
                return request(server).get("/").expect(200, "Got error");
            })
        });
        describe("when status and body property", () => {
            it("should 200", () => {
                const app = new express();
                app.use(ctx => {
                    ctx.status = 304;
                    ctx.body = "hello";
                    ctx.status = 200;
                });
                const server = app.listen();
                return request(server).get("/").expect(200).expect("hello");
            });
            it("should 204", async () => {
                const app = new express();
                app.use(ctx => {
                    ctx.status = 200;
                    ctx.body = "hello";
                    ctx.set("content-type", "text/plain; charset=utf8");
                    ctx.status = 204;
                });
                const server = app.listen();
                const res = await request(server).get("/").expect(204);
                assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "Content-Type"), false);
            });
        });
        describe("with explicit null body", () => {
            it("should preserve given status", async () => {
                const app = new express();
                app.use(ctx => {
                    ctx.body = null;
                    ctx.status = 404;
                });
                const server = app.listen();
                return request(server).get("/").expect(404).expect('').expect({});
            })
            it("should respond with correct headers", async () => {
                const app = new express();
                app.use(ctx => {
                    ctx.body = null;
                    ctx.status = 401;
                });
                const server = app.listen();
                const res = await request(server).get("/").expect(401).expect('').expect({});
                assert.equal(Object.prototype.hasOwnProperty.call(res.headers, "transfer-encoding"), false);
                assert.equal(Object.prototype.hasOwnProperty.call(res.headers, "Content-Type"), false);
                assert.equal(Object.prototype.hasOwnProperty.call(res.headers, "content-length"), true);
            });
            it("should return content-length equal to 0", async () => {
                const app = new express();
                app.use(ctx => {
                    ctx.body = null;
                    ctx.status = 401;
                });
                const server = app.listen();
                const res = await request(server).get("/").expect(401).expect('').expect({});
                assert.equal(res.headers["content-length"], 0);
            })
            it("should not overwrite the content-length", async () => {
                const app = new express();
                app.use(ctx => {
                    ctx.body = null;
                    ctx.length = 10;
                    ctx.status = 404;
                });
                const server = app.listen();
                const res = await request(server).get("/").expect(404).expect('').expect({});
                assert.equal(res.headers["content-length"], 0);
            })
        })
    });
    describe("app context test", () => {
        const app1 = new express();
        app1.context.msg = "hello";
        const app2 = new express();
        it("should merge properties", () => {
            app1.use((ctx, next) => {
                assert.strictEqual(ctx.msg, "hello");
                ctx.status = 204;
            })
            return request(app1.listen()).get("/").expect(204);
        });
        it("should not affect the original prototype", () => {
            app2.use((ctx, next) => {
                assert.strictEqual(ctx.msg, undefined);
                ctx.status = 204;
            })
            return request(app2.listen()).get("/").expect(204);
        })
    });
    describe("app request test", () => {
        const app1 = new express();
        app1.request.message = "hello";
        const app2 = new express();
        it("should merge properties", () => {
            app1.use((ctx, next) => {
                assert.strictEqual(ctx.request.message, "hello");
                ctx.status = 204;
            });
            return request(app1.listen()).get("/").expect(204);
        });
        it("should not affect the original prototype", () => {
            app2.use((ctx, next) => {
                assert.strictEqual(ctx.request.message, undefined);
                ctx.status = 204;
            })
            return request(app2.listen()).get("/").expect(204);
        });
    });
    describe("app response test", () => {
        const app1 = new express();
        app1.response.msg = "hello";
        const app2 = new express();
        const app3 = new express();
        const app4 = new express();
        const app5 = new express();
        const app6 = new express();
        const app7 = new express();
        it("should merge properties", () => {
            app1.use((ctx, next) => {
                assert.strictEqual(ctx.response.msg, "hello");
                ctx.status = 204;
            });
            return request(app1.listen()).get("/").expect(204);
        });
        it("should not affect the original prototype", () => {
            app2.use((ctx, next) => {
                assert.strictEqual(ctx.response.msg, undefined);
                ctx.status = 204;
            })
            return request(app2.listen()).get("/").expect(204);
        });
        it("should not include status message in body for http2", async () => {
            app3.use((ctx, next) => {
                ctx.req.httpVersionMajor = 2;
                ctx.status = 404;
            });
            const response = await request(app3.listen()).get("/").expect(404);
            assert.strictEqual(response.text, "404");
        });
        it("should set ._explicitNullBody correctly", async () => {
            app4.use((ctx, next) => {
                ctx.body = null;
                assert.strictEqual(ctx.response._explicitNullBody, true);
            });
            return request(app4.listen()).get("/").expect(204);
        });
        it("should not set ._explicitNullBody incorrectly", async () => {
            app5.use((ctx, next) => {
                ctx.body = undefined;
                assert.strictEqual(ctx.response._explicitNullBody, undefined);
                ctx.body = '';
                assert.strictEqual(ctx.response._explicitNullBody, undefined);
                ctx.body = false;
                assert.strictEqual(ctx.response._explicitNullBody, undefined);
            });
            return request(app5.listen()).get("/").expect(204);
        });
        it("should add Content-Length when Transfer-Encoding is not defined", () => {
            app6.use((ctx, next) => {
                ctx.body = "hello world";
            });
            return request(app6.listen()).get("/").expect("Content-Length", "11").expect(200);
        });
        it("should not add Content-Length when Transfer-Encoding is defined", () => {
            app7.use((ctx, next) => {
                ctx.set("Transfer-Encoding", "chunked");
                ctx.body = "hello world";
                assert.strictEqual(ctx.response.get("Content-Length"), undefined);
            });
            return request(app7.listen()).get("/").expect("Transfer-Encoding", "chunked").expect(200)
        });
    });
    describe("app toJSON test", () => {
        it("should work", () => {
            const app = new express({ env: "test" });
            const obj = app.toJSON();
            assert.deepStrictEqual({
                subdomainOffset: 2,
                proxy: false,
                env: "test"
            }, obj);
        });
    });
    describe("app inspect test", () => {
        const { inspect } = require("node:util");
        const app = new express();
        it("should work", () => {
            const str = inspect(app);
            assert.strictEqual("{ subdomainOffset: 2, proxy: false, env: 'development' }", str)
        });
    });
    describe("ctx cookies test", () => {
        describe("ctx.cookies.set()", () => {
            it("should set an unsigned cookie", async () => {
                const app = new express();
                app.use((ctx, next) => {
                    ctx.cookies.set("name", "jon");
                    ctx.status = 204;
                });
                const server = app.listen();
                const res = await request(server).get("/").expect(204);
                const cookie = res.headers["set-cookie"].some(cookie => /^name=/.test(cookie))
                assert.strictEqual(cookie, true)
            });
            describe("with .signed", () => {
                describe("when no .keys are set", () => {
                    it("should error", () => {
                        const app = new express();
                        app.use((ctx, next) => {
                            try {
                                ctx.cookies.set("foo", "bar", { signed: true });
                            } catch (err) {
                                ctx.body = err.message;
                            }
                        });
                        return request(app.callback()).get("/").expect(".keys required for signed cookies");
                    });
                });
                it("should send a signed cookie", async () => {
                    const app = new express();
                    app.keys = ["a", "b"];
                    app.use((ctx, next) => {
                        ctx.cookies.set("name", "jon", { signed: true });
                        ctx.status = 204;
                    });
                    const server = app.listen();
                    const res = await request(server).get("/").expect(204);
                    const cookies = res.headers["set-cookie"];
                    assert.strictEqual(cookies.some(cookie => /^name=/.test(cookie)), true);
                    assert.strictEqual(cookies.some(cookie => /(,|^)name\.sig=/.test(cookie)), true);
                })
            })
            describe("with secure", () => {
                it("should get secure from request", async () => {
                    const app = new express();
                    app.proxy = true;
                    app.keys = ["a", "b"];
                    app.use(ctx => {
                        ctx.cookies.set("name", "jon", { signed: true });
                        ctx.status = 204;
                    });
                    const server = app.listen();
                    const res = await request(server).get("/").set("x-forwarded-proto", "https").expect(204);
                    const cookies = res.headers["set-cookie"];
                    assert.strictEqual(cookies.some(cookie => /^name=/.test(cookie)), true);
                    assert.strictEqual(cookies.some(cookie => /(,|^)name\.sig=/.test(cookie)), true);
                    assert.strictEqual(cookies.every(cookie => /secure/.test(cookie)), true);
                });
            });
        });
        describe("ctx.cookies setter", () => {
            it("should override cookie work", async () => {
                const app = new express();
                app.use((ctx, next) => {
                    ctx.cookies = {
                        set (key, value){
                            ctx.set(key, value);
                        }
                    }
                    ctx.cookies.set("name", "jon");
                    ctx.status = 204;
                });
                const server = app.listen();
                await request(server).get("/").expect("name", "jon").expect(204);
            });
        });
    });
    describe("ctx assert test", () => {
        it("should throw an error", () => {
            const ctx = testContext();
            try {
                ctx.assert(false, 404, "asdf");
                //throw new Error("asdf");
            } catch (err) {
                assert.strictEqual(err.status, 404);
                assert.strictEqual(err.expose, true);
            }
        });
    });
    describe("ctx throw test", () => {
        it("should set .status to 500 with string", () => {
            const ctx = testContext();
            try {
                ctx.throw("boom");
            } catch (err) {
                assert.strictEqual(err.status, 500);
                assert.strictEqual(err.expose, false);
            }
        });
        it("should set .status to 500 with error", () => {
            const ctx = testContext();
            const err = new Error("test");
            try {
                ctx.throw(err);
            } catch (err) {
                assert.strictEqual(err.status, 500);
                assert.strictEqual(err.message, "test");
                assert.strictEqual(err.expose, false);
            }
        });
        it("should throw an error and set .status with string", () => {
            const ctx = testContext();
            try {
                ctx.throw(400, "name required");
            } catch (err) {
                assert.strictEqual(err.message, "name required")
                assert.strictEqual(400, err.status)
                assert.strictEqual(true, err.expose)
            }
        });
        it("should throw the error and set .status with error", () => {
            const ctx = testContext();
            const error = new Error("test");
            try {
                ctx.throw(422, error);
            } catch (err) {
                assert.strictEqual(err.status, 422);
                assert.strictEqual(err.message, "test");
                assert.strictEqual(err.expose, true);
            }
        });
        it("should throw an error with number", () => {
            const ctx = testContext();
            try {
                ctx.throw(400);
            } catch (err) {
                assert.strictEqual(err.message, "Bad Request");
                assert.strictEqual(err.status, 400);
                assert.strictEqual(err.expose, true);
            }
        });
        it("should not expose", () => {
            const ctx = testContext();
            try {
                const err = new Error("some error");
                err.status = -1;
                ctx.throw(err);
            } catch (err) {
                assert.strictEqual(err.message, "some error");
                assert.strictEqual(err.expose, false);
            }
        });
    });
    describe("ctx onerror test", () => {
        it("should respond", () => {
            const app = new express();
            app.use((ctx, next) => {
                ctx.body = "something else";
                ctx.throw(418, "boom");
            });
            const server = app.listen();
            return request(server).get("/").expect(418).expect("Content-Type", "text/plain; charset=utf-8").expect("Content-Length", "4");
        });
        it("should unset all headers", async () => {
            const app = new express()
            app.use((ctx, next) => {
                ctx.set("Vary", "Accept-Encoding");
                ctx.set("X-CSRF-Token", "asdf");
                ctx.body = "response";
                ctx.throw(418, "boom");
            });
            const server = app.listen();
            const res = await request(server).get("/").expect(418).expect("Content-Type", "text/plain; charset=utf-8").expect("Content-Length", "4");
            assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "vary"), false);
            assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "x-csrf-token"), false);
        });
        it("should set headers specified in the error", async () => {
            const app = new express();
            app.use((ctx, next) => {
                ctx.set("Vary", "Accept-Encoding");
                ctx.set("X-CSRF-Token", "asdf");
                ctx.body = "response";
                throw Object.assign(new Error("boom"), {
                    status: 418,
                    expose: true,
                    headers: {
                        "X-New-Header": "Value"
                    }
                });
            });
            const server = app.listen();
            const res = await request(server).get("/").expect(418).expect("Content-Type", "text/plain; charset=utf-8").expect("X-New-Header", "Value");
            assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "vary"), false);
            assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "x-csrf-token"), false);
        });
        it("should ignore error after headerSent", done => {
            const app = new express();
            app.on("error", err => {
                assert.strictEqual(err.message, "mock error");
                assert.strictEqual(err.headerSent, true);
                done();
            });
            app.use(async ctx => {
                ctx.status = 200;
                ctx.set("X-Foo", "Bar");
                ctx.flushHeaders();
                await Promise.reject(new Error("mock error"));
                ctx.body = "response";
            });
            request(app.callback()).get("/").expect("X-Foo", "Bar").expect(200, () => {});
        });
        it("should set status specified in the error using statusCode", () => {
            const app = new express();
            app.use((ctx, next) => {
                ctx.body = "something else";
                const err = new Error("Not found");
                err.statusCode = 404;
                throw err;
            });
            const server = app.listen();
            return request(server).get("/").expect(404).expect("Content-Type", "text/plain; charset=utf-8").expect("Not Found");
        });
        describe("when invalid err.statusCode", () => {
            describe("not number", () => {
                it("should respond 500", () => {
                    const app = new express();
                    app.use((ctx, next) => {
                        ctx.body = "something else";
                        const err = new Error("some error");
                        err.statusCode = "notnumber";
                        throw err;
                    });
                    const server = app.listen();
                    return request(server).get("/").expect(500).expect("Content-Type", "text/plain; charset=utf-8").expect("Internal Server Error");
                });
            });
        });
        describe("when invalid err.status", () => {
            describe("not number", () => {
                it("should respond 500", () => {
                    const app = new express();
                    app.use((ctx, next) => {
                        ctx.body = "something else";
                        const err = new Error("some error");
                        err.status = "notnumber";
                        throw err;
                    });
                    const server = app.listen();
                    return request(server).get("/").expect(500).expect("Content-Type", "text/plain; charset=utf-8").expect("Internal Server Error");
                });
            });
            describe("when ENOENT error", () => {
                it("should respond 404", () => {
                    const app = new express();
                    app.use((ctx, next) => {
                        ctx.body = "something else";
                        const err = new Error("test for ENOENT");
                        err.code = "ENOENT";
                        throw err;
                    });
                    const server = app.listen();
                    return request(server).get("/").expect(404).expect("Content-Type", "text/plain; charset=utf-8").expect("Not Found");
                });
            });
            describe("not http status code", () => {
                it("should respond 500", () => {
                    const app = new express();
                    app.use((ctx, next) => {
                        ctx.body = "something else";
                        const err = new Error("some error");
                        err.status = 9999;
                        throw err;
                    });
                    const server = app.listen();
                    return request(server).get("/").expect(500).expect("Content-Type", "text/plain; charset=utf-8").expect("Internal Server Error");
                });
            });
        });
        describe("when error from another scope thrown", () => {
            it("should handle it like a normal error", async () => {
                const ExternError = require("node:vm").runInNewContext("Error");
                const app = new express();
                const error = Object.assign(new ExternError("boom"), {
                    status: 418,
                    expose: true
                });
                app.use((ctx, next) => {
                    throw error;
                });
                const server = app.listen();
                const gotRightErrorPromise = new Promise((resolve, reject) => {
                    app.on("error", receivedError => {
                        try {
                            assert.strictEqual(receivedError, error);
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
                await request(server).get("/").expect(418);
                await gotRightErrorPromise;
            });
        });
        describe("when non-error thrown", () => {
            it("should respond with non-error thrown message", () => {
                const app = new express();
                app.use((ctx, next) => {
                    throw "string error";
                });
                const server = app.listen();
                return request(server).get("/").expect(500).expect("Content-Type", "text/plain; charset=utf-8").expect("Internal Server Error");
            });
            it("should use res.getHeaderNames() accessor when available", () => {
                let removed = 0
                const ctx = testContext();
                ctx.app.emit = () => {};
                ctx.res = {
                    getHeaderNames: () => ["content-type", "content-length"],
                    removeHeader: () => removed++,
                    end: () => {},
                    emit: () => {}
                };
                ctx.onerror(new Error("error"));
                assert.strictEqual(removed, 2);
            });
            it("should stringify error if it is an object", done => {
                const app = new express();
                app.on("error", err => {
                    assert.strictEqual(err.message, 'non-error thrown: {"key":"value"}');
                    done();
                });
                app.use(async ctx => {
                    throw { key: "value" };
                });
                request(app.callback()).get("/").expect(500).expect("Internal Server Error", () => {});
            });
        });
    });
    describe("ctx toJSON test", () => {
        it("should return a json representation", () => {
            const ctx = testContext();
            ctx.req.method = "POST";
            ctx.req.url = "/items";
            ctx.req.headers["content-type"] = "text/plain";
            ctx.status = 200;
            ctx.body = "<p>Hey</p>";
            const { request: req, response: res } = JSON.parse(JSON.stringify(ctx));
            assert.deepStrictEqual({
                method: "POST",
                url: "/items",
                header: {
                    "content-type": "text/plain"
                }
            }, req);
            assert.deepStrictEqual({
                status: 200,
                message: "OK",
                header: {
                    "content-type": "text/html; charset=utf-8",
                    "content-length": "10"
                }
            }, res);
        });
    });
    describe("ctx inspect test", () => {
        const { inspect } = require("node:util");
        it("should return a json representation", () => {
            const ctx = testContext(), toJSON = ctx.toJSON(ctx);
            assert.deepStrictEqual(inspect(toJSON), inspect(ctx));
        });
    });
    describe("req header test", () => {
        it("should return the request header object", () => {
            const req = testRequest();
            assert.deepStrictEqual(req.header, req.req.headers);
        });
        it("should set the request header object", () => {
            const req = testRequest();
            req.header = { "X-Custom-Headerfield": "Its one header, with headerfields" };
            assert.deepStrictEqual(req.header, req.req.headers);
        });
    });
    describe("req headers test", () => {
        it("should return the request header object", () => {
            const req = testRequest();
            assert.deepStrictEqual(req.headers, req.req.headers);
        });
        it("should set the request header object", () => {
            const req = testRequest();
            req.headers = { "X-Custom-Headerfield": "Its one header, with headerfields" };
            assert.deepStrictEqual(req.headers, req.req.headers);
        });
    });
    describe("req origin test", () => {
        it("should return the origin of url", () => {
            const socket = new Stream.Duplex();
            const req = {
                url: "/users/1?next=/dashboard",
                headers: { host: "localhost" },
                socket: socket,
                __proto__: Stream.Readable.prototype
            };
            const ctx = testContext(req);
            assert.strictEqual(ctx.origin, "http://localhost");
            // change it also work
            ctx.url = "/foo/users/1?next=/dashboard";
            assert.strictEqual(ctx.origin, "http://localhost");
        })
    });
    describe("req href test", () => {
        it("should return the full request url", () => {
            const socket = new Stream.Duplex();
            const req = {
                url: "/users/1?next=/dashboard",
                headers: { host: "localhost" },
                socket: socket,
                __proto__: Stream.Readable.prototype
            };
            const ctx = testContext(req);
            assert.strictEqual(ctx.href, "http://localhost/users/1?next=/dashboard");
            // change it also work
            ctx.url = "/foo/users/1?next=/dashboard";
            assert.strictEqual(ctx.href, "http://localhost/users/1?next=/dashboard");
        });
        it("should work with `GET http://example.com/foo`", done => {
            const app = new express();
            app.use(ctx => ctx.body = ctx.href);
            app.listen(function (){
                const address = this.address();
                http.get({
                    host: "localhost",
                    path: "http://example.com/foo",
                    port: address.port
                }, res => {
                    assert.strictEqual(res.statusCode, 200);
                    let buf = '';
                    res.setEncoding("utf8");
                    res.on("data", s => { buf += s });
                    res.on("end", () => {
                        assert.strictEqual(buf, "http://example.com/foo");
                        done();
                    });
                });
            });
        })
    });
    describe("req path test", () => {
        it("should return the pathname", () => {
            const ctx = testContext();
            ctx.url = "/login?next=/dashboard";
            assert.strictEqual(ctx.path, "/login");
        });
        it("should set the pathname", () => {
            const ctx = testContext();
            ctx.url = "/login?next=/dashboard";
            ctx.path = "/logout";
            assert.strictEqual(ctx.path, "/logout");
            assert.strictEqual(ctx.url, "/logout?next=/dashboard");
        });
        it("should change .url but not .originalUrl", () => {
            const ctx = testContext({ url: "/login" });
            ctx.path = "/logout";
            assert.strictEqual(ctx.url, "/logout");
            assert.strictEqual(ctx.originalUrl, "/login");
            assert.strictEqual(ctx.request.originalUrl, "/login");
        });
        it("should not affect parseurl", () => {
            const ctx = testContext({ url: "/login?foo=bar" });
            ctx.path = "/login";
            const url = require("parseurl")(ctx.req);
            assert.strictEqual(url.path, "/login?foo=bar");
        });
    });
    describe("req querystring test", () => {
        it("should return the querystring", () => {
            const ctx = testContext({ url: "/store/shoes?page=2&color=blue" });
            assert.strictEqual(ctx.querystring, "page=2&color=blue");
        });
        describe("when ctx.req not present", () => {
            it("should return an empty string", () => {
                const ctx = testContext();
                ctx.request.req = null;
                assert.strictEqual(ctx.querystring, '');
            });
        });
        it("should replace the querystring", () => {
            const ctx = testContext({ url: "/store/shoes" });
            ctx.querystring = "page=2&color=blue";
            assert.strictEqual(ctx.url, "/store/shoes?page=2&color=blue");
            assert.strictEqual(ctx.querystring, "page=2&color=blue");
        });
        it("should update ctx.search and ctx.query", () => {
            const ctx = testContext({ url: "/store/shoes" });
            ctx.querystring = "page=2&color=blue";
            assert.strictEqual(ctx.url, "/store/shoes?page=2&color=blue");
            assert.strictEqual(ctx.search, "?page=2&color=blue");
            assert.strictEqual(ctx.query.page, "2");
            assert.strictEqual(ctx.query.color, "blue");
        });
        it("should change .url but not .originalUrl", () => {
            const ctx = testContext({ url: "/store/shoes" });
            ctx.querystring = "page=2&color=blue";
            assert.strictEqual(ctx.url, "/store/shoes?page=2&color=blue");
            assert.strictEqual(ctx.originalUrl, "/store/shoes");
            assert.strictEqual(ctx.request.originalUrl, "/store/shoes");
        });
        it("should not affect parseurl", () => {
            const ctx = testContext({ url: "/login?foo=bar" });
            ctx.querystring = "foo=bar";
            const url = require("parseurl")(ctx.req);
            assert.strictEqual(url.path, "/login?foo=bar");
        });
    });
    describe("req search test", () => {
        it("should replace the search", () => {
            const ctx = testContext({ url: "/store/shoes" });
            ctx.search = "?page=2&color=blue";
            assert.strictEqual(ctx.url, "/store/shoes?page=2&color=blue");
            assert.strictEqual(ctx.search, "?page=2&color=blue");
        });
        it("should update ctx.querystring and ctx.query", () => {
            const ctx = testContext({ url: "/store/shoes" });
            ctx.search = "?page=2&color=blue";
            assert.strictEqual(ctx.url, "/store/shoes?page=2&color=blue");
            assert.strictEqual(ctx.querystring, "page=2&color=blue");
            assert.strictEqual(ctx.query.page, "2");
            assert.strictEqual(ctx.query.color, "blue");
        });
        it("should change .url but not .originalUrl", () => {
            const ctx = testContext({ url: "/store/shoes" })
            ctx.search = "?page=2&color=blue";
            assert.strictEqual(ctx.url, "/store/shoes?page=2&color=blue");
            assert.strictEqual(ctx.originalUrl, "/store/shoes");
            assert.strictEqual(ctx.request.originalUrl, "/store/shoes");
        });
        describe("when missing", () => {
            it("should return ''", () => {
                const ctx = testContext({ url: "/store/shoes" });
                assert.strictEqual(ctx.search, '');
            });
        });
    });
    describe("req host test", () => {
        it("should return host with port", () => {
            const req = testRequest();
            req.header.host = "foo.com:3000";
            assert.strictEqual(req.host, "foo.com:3000");
        });
        describe("with no host present", () => {
            it("should return ''", () => {
                const req = testRequest();
                assert.strictEqual(req.host, '');
            });
        });
        describe("when less then HTTP/2", () => {
            it("should not use :authority header", () => {
                const req = testRequest({
                    httpVersionMajor: 1,
                    httpVersion: "1.1"
                });
                req.header[":authority"] = "foo.com:3000";
                req.header.host = "bar.com:8000";
                assert.strictEqual(req.host, "bar.com:8000");
            });
        });
        describe("when HTTP/2", () => {
            it("should use :authority header", () => {
                const req = testRequest({
                    httpVersionMajor: 2,
                    httpVersion: "2.0"
                });
                req.header[":authority"] = "foo.com:3000";
                req.header.host = "bar.com:8000";
                assert.strictEqual(req.host, "foo.com:3000");
            });
            it("should use host header as fallback", () => {
                const req = testRequest({
                    httpVersionMajor: 2,
                    httpVersion: "2.0"
                });
                req.header.host = "bar.com:8000";
                assert.strictEqual(req.host, "bar.com:8000");
            });
        });
        describe("when X-Forwarded-Host is present", () => {
            describe("and proxy is not trusted", () => {
                it("should be ignored on HTTP/1", () => {
                    const req = testRequest();
                    req.header["x-forwarded-host"] = "bar.com";
                    req.header.host = "foo.com";
                    assert.strictEqual(req.host, "foo.com");
                });
                it("should be ignored on HTTP/2", () => {
                    const req = testRequest({
                        httpVersionMajor: 2,
                        httpVersion: "2.0"
                    });
                    req.header["x-forwarded-host"] = "proxy.com:8080";
                    req.header[":authority"] = "foo.com:3000";
                    req.header.host = "bar.com:8000";
                    assert.strictEqual(req.host, "foo.com:3000");
                });
            });
            describe("and proxy is trusted", () => {
                it("should be used on HTTP/1", () => {
                    const req = testRequest();
                    req.app.proxy = true;
                    req.header["x-forwarded-host"] = "bar.com, baz.com";
                    req.header.host = "foo.com";
                    assert.strictEqual(req.host, "bar.com");
                });
                it("should be used on HTTP/2", () => {
                    const req = testRequest({
                        httpVersionMajor: 2,
                        httpVersion: "2.0"
                    });
                    req.app.proxy = true;
                    req.header["x-forwarded-host"] = "proxy.com:8080";
                    req.header[":authority"] = "foo.com:3000";
                    req.header.host = "bar.com:8000";
                    assert.strictEqual(req.host, "proxy.com:8080");
                });
            });
        });
    });
    describe("req hostname test", () => {
        it("should return hostname void of port", () => {
            const req = testRequest();
            req.header.host = "foo.com:3000";
            assert.strictEqual(req.hostname, "foo.com");
        });
        describe("with no host present", () => {
            it("should return ''", () => {
                const req = testRequest();
                assert.strictEqual(req.hostname, '');
            });
        });
        describe("with IPv6 in host", () => {
            it("should parse localhost void of port", () => {
                const req = testRequest();
                req.header.host = "[::1]";
                assert.strictEqual(req.hostname, "[::1]");
            });
            it("should parse localhost with port 80", () => {
                const req = testRequest();
                req.header.host = "[::1]:80";
                assert.strictEqual(req.hostname, "[::1]");
            });
            it("should parse localhost with non-special schema port", () => {
                const req = testRequest();
                req.header.host = "[::1]:1337";
                assert.strictEqual(req.hostname, "[::1]");
            });
            it("should reduce IPv6 with non-special schema port as hostname", () => {
                const req = testRequest();
                req.header.host = "[2001:cdba:0000:0000:0000:0000:3257:9652]:1337";
                assert.strictEqual(req.hostname, "[2001:cdba::3257:9652]");
            });
            it("should return empty string when invalid", () => {
                const req = testRequest();
                req.header.host = "[invalidIPv6]";
                assert.strictEqual(req.hostname, '');
            });
        });
        describe("when X-Forwarded-Host is present", () => {
            describe("and proxy is not trusted", () => {
                it("should be ignored", () => {
                    const req = testRequest();
                    req.header["x-forwarded-host"] = "bar.com";
                    req.header.host = "foo.com";
                    assert.strictEqual(req.hostname, "foo.com");
                });
            });
            describe("and proxy is trusted", () => {
                it("should be used", () => {
                    const req = testRequest();
                    req.app.proxy = true;
                    req.header["x-forwarded-host"] = "bar.com, baz.com";
                    req.header.host = "foo.com";
                    assert.strictEqual(req.hostname, "bar.com");
                });
            });
        });
    });
    describe("req fresh test", () => {
        describe("the request method is not GET and HEAD", () => {
            it("should return false", () => {
                const ctx = testContext();
                ctx.req.method = "POST";
                assert.strictEqual(ctx.fresh, false);
            });
        });
        describe("the response is non-2xx", () => {
            it("should return false", () => {
                const ctx = testContext();
                ctx.status = 404;
                ctx.req.method = "GET";
                ctx.req.headers["if-none-match"] = "123";
                ctx.set("ETag", "123");
                assert.strictEqual(ctx.fresh, false);
            });
        });
        describe("the response is 2xx", () => {
            describe("and etag matches", () => {
                it("should return true", () => {
                    const ctx = testContext();
                    ctx.status = 200;
                    ctx.req.method = "GET";
                    ctx.req.headers["if-none-match"] = "123";
                    ctx.set("ETag", "123");
                    assert.strictEqual(ctx.fresh, true);
                });
            });
            describe("and etag does not match", () => {
                it("should return false", () => {
                    const ctx = testContext();
                    ctx.status = 200;
                    ctx.req.method = "GET";
                    ctx.req.headers["if-none-match"] = "123";
                    ctx.set("ETag", "hey");
                    assert.strictEqual(ctx.fresh, false);
                });
            });
        });
    });
    describe("req stale test", () => {
        it("should be the inverse of req.fresh", () => {
            const ctx = testContext()
            ctx.status = 200
            ctx.method = "GET"
            ctx.req.headers["if-none-match"] = '"123"';
            ctx.set("ETag", '"123"');
            assert.strictEqual(ctx.fresh, true);
            assert.strictEqual(ctx.stale, false);
        });
    });
    describe("req idempotent test", () => {
        describe("when the request method is idempotent", () => {
            it("should return true", () => {
                ["GET", "HEAD", "PUT", "DELETE", "OPTIONS", "TRACE"].forEach(check)
                function check (method){
                    const req = testRequest();
                    req.method = method;
                    assert.strictEqual(req.idempotent, true);
                }
            });
        });
        describe("when the request method is not idempotent", () => {
            it("should return false", () => {
                const req = testRequest();
                req.method = "POST";
                assert.strictEqual(req.idempotent, false);
            });
        });
    });
    describe("req charset test", () => {
        describe("with no content-type present", () => {
            it("should return ''", () => {
                const req = testRequest();
                assert(req.charset === '');
            });
        });
        describe("with charset present", () => {
            it("should return ''", () => {
                const req = testRequest();
                req.header["content-type"] = "text/plain";
                assert(req.charset === '');
            });
        });
        describe("with a charset", () => {
            it("should return the charset", () => {
                const req = testRequest();
                req.header["content-type"] = "text/plain; charset=utf-8";
                assert.strictEqual(req.charset, "utf-8");
            });
            it("should return '' if content-type is invalid", () => {
                const req = testRequest();
                req.header["content-type"] = "application/json; application/text; charset=utf-8";
                assert.strictEqual(req.charset, '');
            });
        });
        describe("ctx.length", () => {
            it("should return length in content-length", () => {
                const req = testRequest();
                req.header["content-length"] = "10";
                assert.strictEqual(req.length, 10);
            });
            it("should return undefined with no content-length present", () => {
                const req = testRequest();
                assert.strictEqual(req.length, undefined);
            });
        });
    });
    describe("req length test", () => {
        it("should return length in content-length", () => {
            const req = testRequest();
            req.header["content-length"] = "10";
            assert.strictEqual(req.length, 10);
        });
        it("should return undefined with no content-length present", () => {
            const req = testRequest();
            assert.strictEqual(req.length, undefined);
        });
    });
    describe("req protocol test", () => {
        describe("when encrypted", () => {
            it("should return 'https'", () => {
                const req = testRequest();
                req.req.socket = { encrypted: true };
                assert.strictEqual(req.protocol, "https");
            });
        });
        describe("when unencrypted", () => {
            it("should return 'http'", () => {
                const req = testRequest();
                req.req.socket = {};
                assert.strictEqual(req.protocol, "http");
            });
        });
        describe("when X-Forwarded-Proto is set", () => {
            describe("and proxy is trusted", () => {
                it("should be used", () => {
                    const req = testRequest();
                    req.app.proxy = true;
                    req.req.socket = {};
                    req.header["x-forwarded-proto"] = "https, http";
                    assert.strictEqual(req.protocol, "https");
                });
                describe("and X-Forwarded-Proto is empty", () => {
                    it("should return 'http'", () => {
                        const req = testRequest();
                        req.app.proxy = true;
                        req.req.socket = {};
                        req.header["x-forwarded-proto"] = '';
                        assert.strictEqual(req.protocol, "http");
                    });
                });
            });
            describe("and proxy is not trusted", () => {
                it("should not be used", () => {
                    const req = testRequest();
                    req.req.socket = {};
                    req.header["x-forwarded-proto"] = "https, http";
                    assert.strictEqual(req.protocol, "http");
                });
            });
        });
    });
    describe("req secure test", () => {
        it("should return true when encrypted", () => {
            const req = testRequest();
            req.req.socket = { encrypted: true };
            assert.strictEqual(req.secure, true);
        });
    });
    describe("req ips test", () => {
        describe("when X-Forwarded-For is present", () => {
            describe("and proxy is not trusted", () => {
                it("should be ignored", () => {
                    const req = testRequest();
                    req.app.proxy = false;
                    req.header["x-forwarded-for"] = "127.0.0.1,127.0.0.2";
                    assert.deepStrictEqual(req.ips, []);
                });
            });
            describe("and proxy is trusted", () => {
                it("should be used", () => {
                    const req = testRequest();
                    req.app.proxy = true;
                    req.header["x-forwarded-for"] = "127.0.0.1,127.0.0.2";
                    assert.deepStrictEqual(req.ips, ["127.0.0.1", "127.0.0.2"]);
                });
            });
        });
        describe("when options.proxyIpHeader is present", () => {
            describe("and proxy is not trusted", () => {
                it("should be ignored", () => {
                    const req = testRequest();
                    req.app.proxy = false;
                    req.app.proxyIpHeader = "x-client-ip";
                    req.header["x-client-ip"] = "127.0.0.1,127.0.0.2";
                    assert.deepStrictEqual(req.ips, []);
                });
            });
            describe("and proxy is trusted", () => {
                it("should be used", () => {
                    const req = testRequest();
                    req.app.proxy = true;
                    req.app.proxyIpHeader = "x-client-ip";
                    req.header["x-client-ip"] = "127.0.0.1,127.0.0.2";
                    assert.deepStrictEqual(req.ips, ["127.0.0.1", "127.0.0.2"]);
                });
            });
        });
        describe("when options.maxIpsCount is present", () => {
            describe("and proxy is not trusted", () => {
                it("should be ignored", () => {
                    const req = testRequest();
                    req.app.proxy = false;
                    req.app.maxIpsCount = 1;
                    req.header["x-forwarded-for"] = "127.0.0.1,127.0.0.2";
                    assert.deepStrictEqual(req.ips, []);
                });
            });
            describe("and proxy is trusted", () => {
                it("should be used", () => {
                    const req = testRequest();
                    req.app.proxy = true;
                    req.app.maxIpsCount = 1;
                    req.header["x-forwarded-for"] = "127.0.0.1,127.0.0.2";
                    assert.deepStrictEqual(req.ips, ["127.0.0.2"]);
                });
            });
        });
    });
    describe("req ip test", () => {
        describe("with req.ips present", () => {
            it("should return req.ips[0]", () => {
                const app = new express();
                const req = { headers: {}, socket: new Stream.Duplex() };
                app.proxy = true;
                req.headers["x-forwarded-for"] = "127.0.0.1";
                req.socket.remoteAddress = "127.0.0.2";
                const request = testRequest(req, undefined, app);
                assert.strictEqual(request.ip, "127.0.0.1");
            });
        });
        describe("with no req.ips present", () => {
            it("should return req.socket.remoteAddress", () => {
                const req = { socket: new Stream.Duplex() };
                req.socket.remoteAddress = "127.0.0.2";
                const request = testRequest(req);
                assert.strictEqual(request.ip, "127.0.0.2");
            });
            describe("with req.socket.remoteAddress not present", () => {
                it("should return an empty string", () => {
                    const socket = new Stream.Duplex();
                    Object.defineProperty(socket, "remoteAddress", {
                        get: () => undefined, // So that the helper doesn't override it with a reasonable value
                        set: () => {}
                    });
                    assert.strictEqual(testRequest({ socket }).ip, '');
                });
            });
        });
        it("should be lazy inited and cached", () => {
            const req = { socket: new Stream.Duplex() };
            req.socket.remoteAddress = "127.0.0.2";
            const request = testRequest(req);
            assert.strictEqual(request.ip, "127.0.0.2");
            req.socket.remoteAddress = "127.0.0.1";
            assert.strictEqual(request.ip, "127.0.0.2");
        });
        it("should reset ip work", () => {
            const req = { socket: new Stream.Duplex() }
            req.socket.remoteAddress = "127.0.0.2";
            const request = testRequest(req);
            assert.strictEqual(request.ip, "127.0.0.2");
            request.ip = "127.0.0.1";
            assert.strictEqual(request.ip, "127.0.0.1");
        });
    });
    describe("req subdomains test", () => {
        it("should return subdomain array", () => {
            const req = testRequest();
            req.header.host = "tobi.ferrets.example.com";
            req.app.subdomainOffset = 2;
            assert.deepStrictEqual(req.subdomains, ["ferrets", "tobi"]);
            req.app.subdomainOffset = 3;
            assert.deepStrictEqual(req.subdomains, ["tobi"]);
        });
        it("should work with no host present", () => {
            const req = testRequest();
            assert.deepStrictEqual(req.subdomains, []);
        });
        it("should check if the host is an ip address, even with a port", () => {
            const req = testRequest();
            req.header.host = "127.0.0.1:3000";
            assert.deepStrictEqual(req.subdomains, []);
        });
    });
    describe("req accept test", () => {
        const Accept = require("accepts");
        it("should return an Accept instance", () => {
            const ctx = testContext();
            ctx.req.headers.accept = "application/*;q=0.2, image/jpeg;q=0.8, text/html, text/plain";
            assert(ctx.accept instanceof Accept);
        });
        it("should replace the accept object", () => {
            const ctx = testContext();
            ctx.req.headers.accept = "text/plain";
            assert.deepStrictEqual(ctx.accepts(), ["text/plain"]);
            const request = testRequest();
            request.req.headers.accept = "application/*;q=0.2, image/jpeg;q=0.8, text/html, text/plain";
            ctx.accept = Accept(request.req);
            assert.deepStrictEqual(ctx.accepts(), ["text/html", "text/plain", "image/jpeg", "application/*"]);
        });
    });
    describe("req accepts (types) test", () => {
        describe("with no arguments", () => {
            describe("when Accept is populated", () => {
                it("should return all accepted types", () => {
                    const ctx = testContext();
                    ctx.req.headers.accept = "application/*;q=0.2, image/jpeg;q=0.8, text/html, text/plain";
                    assert.deepStrictEqual(ctx.accepts(), ["text/html", "text/plain", "image/jpeg", "application/*"]);
                });
            });
        });
        describe("with no valid types", () => {
            describe("when Accept is populated", () => {
                it("should return false", () => {
                    const ctx = testContext();
                    ctx.req.headers.accept = "application/*;q=0.2, image/jpeg;q=0.8, text/html, text/plain";
                    assert.strictEqual(ctx.accepts("image/png", "image/tiff"), false);
                });
            });
            describe("when Accept is not populated", () => {
                it("should return the first type", () => {
                    const ctx = testContext();
                    assert.strictEqual(ctx.accepts("text/html", "text/plain", "image/jpeg", "application/*"), "text/html");
                });
            });
        });
        describe("when extensions are given", () => {
            it("should convert to mime types", () => {
                const ctx = testContext();
                ctx.req.headers.accept = "text/plain, text/html";
                assert.strictEqual(ctx.accepts("html"), "html");
                assert.strictEqual(ctx.accepts(".html"), ".html");
                assert.strictEqual(ctx.accepts("txt"), "txt");
                assert.strictEqual(ctx.accepts(".txt"), ".txt");
                assert.strictEqual(ctx.accepts("png"), false);
            });
        });
        describe("when an array is given", () => {
            it("should return the first match", () => {
                const ctx = testContext();
                ctx.req.headers.accept = "text/plain, text/html";
                assert.strictEqual(ctx.accepts(["png", "text", "html"]), "text");
                assert.strictEqual(ctx.accepts(["png", "html"]), "html");
            });
        });
        describe("when multiple arguments are given", () => {
            it("should return the first match", () => {
                const ctx = testContext();
                ctx.req.headers.accept = "text/plain, text/html";
                assert.strictEqual(ctx.accepts("png", "text", "html"), "text");
                assert.strictEqual(ctx.accepts("png", "html"), "html");
            });
        });
        describe("when value present in Accept is an exact match", () => {
            it("should return the type", () => {
                const ctx = testContext();
                ctx.req.headers.accept = "text/plain, text/html";
                assert.strictEqual(ctx.accepts("text/html"), "text/html");
                assert.strictEqual(ctx.accepts("text/plain"), "text/plain");
            });
        });
        describe("when value present in Accept is a type match", () => {
            it("should return the type", () => {
                const ctx = testContext();
                ctx.req.headers.accept = "application/json, */*";
                assert.strictEqual(ctx.accepts("text/html"), "text/html");
                assert.strictEqual(ctx.accepts("text/plain"), "text/plain");
                assert.strictEqual(ctx.accepts("image/png"), "image/png");
            });
        });
        describe("when value present in Accept is a subtype match", () => {
            it("should return the type", () => {
                const ctx = testContext();
                ctx.req.headers.accept = "application/json, text/*";
                assert.strictEqual(ctx.accepts("text/html"), "text/html");
                assert.strictEqual(ctx.accepts("text/plain"), "text/plain");
                assert.strictEqual(ctx.accepts("image/png"), false);
                assert.strictEqual(ctx.accepts("png"), false);
            });
        });
    });
    describe("req acceptsEncodings test", () => {
        describe("with no arguments", () => {
            describe("when Accept-Encoding is populated", () => {
                it("should return accepted types", () => {
                    const ctx = testContext();
                    ctx.req.headers["accept-encoding"] = "gzip, compress;q=0.2";
                    assert.deepStrictEqual(ctx.acceptsEncodings(), ["gzip", "compress", "identity"]);
                    assert.strictEqual(ctx.acceptsEncodings("gzip", "compress"), "gzip");
                });
            });
            describe("when Accept-Encoding is not populated", () => {
                it("should return identity", () => {
                    const ctx = testContext();
                    assert.deepStrictEqual(ctx.acceptsEncodings(), ["identity"]);
                    assert.strictEqual(ctx.acceptsEncodings("gzip", "deflate", "identity"), "identity");
                });
            });
        });
        describe("with multiple arguments", () => {
            it("should return the best fit", () => {
                const ctx = testContext();
                ctx.req.headers["accept-encoding"] = "gzip, compress;q=0.2";
                assert.strictEqual(ctx.acceptsEncodings("compress", "gzip"), "gzip");
                assert.strictEqual(ctx.acceptsEncodings("gzip", "compress"), "gzip");
            });
        });
        describe("with an array", () => {
            it("should return the best fit", () => {
                const ctx = testContext();
                ctx.req.headers["accept-encoding"] = "gzip, compress;q=0.2";
                assert.strictEqual(ctx.acceptsEncodings(["compress", "gzip"]), "gzip");
            });
        });
    });
    describe("req acceptsCharsets test", () => {
        describe("with no arguments", () => {
            describe("when Accept-Charset is populated", () => {
                it("should return accepted types", () => {
                    const ctx = testContext();
                    ctx.req.headers["accept-charset"] = "utf-8, iso-8859-1;q=0.2, utf-7;q=0.5";
                    assert.deepStrictEqual(ctx.acceptsCharsets(), ["utf-8", "utf-7", "iso-8859-1"]);
                });
            });
        });
        describe("with multiple arguments", () => {
            describe("when Accept-Charset is populated", () => {
                describe("if any types match", () => {
                    it("should return the best fit", () => {
                        const ctx = testContext();
                        ctx.req.headers["accept-charset"] = "utf-8, iso-8859-1;q=0.2, utf-7;q=0.5";
                        assert.strictEqual(ctx.acceptsCharsets("utf-7", "utf-8"), "utf-8");
                    });
                });
                describe("if no types match", () => {
                    it("should return false", () => {
                        const ctx = testContext();
                        ctx.req.headers["accept-charset"] = "utf-8, iso-8859-1;q=0.2, utf-7;q=0.5";
                        assert.strictEqual(ctx.acceptsCharsets("utf-16"), false);
                    });
                });
            });
            describe("when Accept-Charset is not populated", () => {
                it("should return the first type", () => {
                    const ctx = testContext();
                    assert.strictEqual(ctx.acceptsCharsets("utf-7", "utf-8"), "utf-7");
                });
            });
        });
        describe("with an array", () => {
            it("should return the best fit", () => {
                const ctx = testContext();
                ctx.req.headers["accept-charset"] = "utf-8, iso-8859-1;q=0.2, utf-7;q=0.5";
                assert.strictEqual(ctx.acceptsCharsets(["utf-7", "utf-8"]), "utf-8");
            });
        });
    });
    describe("req acceptsLanguages (langs) test", () => {
        describe("with no arguments", () => {
            describe("when Accept-Language is populated", () => {
                it("should return accepted types", () => {
                    const ctx = testContext();
                    ctx.req.headers["accept-language"] = "en;q=0.8, es, pt";
                    assert.deepStrictEqual(ctx.acceptsLanguages(), ["es", "pt", "en"]);
                });
            });
        });
        describe("with multiple arguments", () => {
            describe("when Accept-Language is populated", () => {
                describe("if any types types match", () => {
                    it("should return the best fit", () => {
                        const ctx = testContext();
                        ctx.req.headers["accept-language"] = "en;q=0.8, es, pt";
                        assert.strictEqual(ctx.acceptsLanguages("es", "en"), "es");
                    });
                });
                describe("if no types match", () => {
                    it("should return false", () => {
                        const ctx = testContext();
                        ctx.req.headers["accept-language"] = "en;q=0.8, es, pt";
                        assert.strictEqual(ctx.acceptsLanguages("fr", "au"), false);
                    });
                });
            });
            describe("when Accept-Language is not populated", () => {
                it("should return the first type", () => {
                    const ctx = testContext();
                    assert.strictEqual(ctx.acceptsLanguages("es", "en"), "es");
                });
            });
        });
        describe("with an array", () => {
            it("should return the best fit", () => {
                const ctx = testContext();
                ctx.req.headers["accept-language"] = "en;q=0.8, es, pt";
                assert.strictEqual(ctx.acceptsLanguages(["es", "en"]), "es");
            });
        });
    });
    describe("req is (type) test", () => {
        it("should ignore params", () => {
            const ctx = testContext();
            ctx.header["content-type"] = "text/html; charset=utf-8";
            ctx.header["transfer-encoding"] = "chunked";
            assert.strictEqual(ctx.is("text/*"), "text/html")
        });
        describe("when no body is given", () => {
            it("should return null", () => {
                const ctx = testContext();
                assert.strictEqual(ctx.is(), null);
                assert.strictEqual(ctx.is("image/*"), null);
                assert.strictEqual(ctx.is("image/*", "text/*"), null);
            });
        });
        describe("when no content type is given", () => {
            it("should return false", () => {
                const ctx = testContext();
                ctx.header["transfer-encoding"] = "chunked";
                assert.strictEqual(ctx.is(), false);
                assert.strictEqual(ctx.is("image/*"), false);
                assert.strictEqual(ctx.is("text/*", "image/*"), false);
            });
        });
        describe("give no types", () => {
            it("should return the mime type", () => {
                const ctx = testContext();
                ctx.header["content-type"] = "image/png";
                ctx.header["transfer-encoding"] = "chunked";
                assert.strictEqual(ctx.is(), "image/png");
            });
        });
        describe("given one type", () => {
            it("should return the type or false", () => {
                const ctx = testContext();
                ctx.header["content-type"] = "image/png";
                ctx.header["transfer-encoding"] = "chunked";

                assert.strictEqual(ctx.is("png"), "png");
                assert.strictEqual(ctx.is(".png"), ".png");
                assert.strictEqual(ctx.is("image/png"), "image/png");
                assert.strictEqual(ctx.is("image/*"), "image/png");
                assert.strictEqual(ctx.is("*/png"), "image/png");

                assert.strictEqual(ctx.is("jpeg"), false);
                assert.strictEqual(ctx.is(".jpeg"), false);
                assert.strictEqual(ctx.is("image/jpeg"), false);
                assert.strictEqual(ctx.is("text/*"), false);
                assert.strictEqual(ctx.is("*/jpeg"), false);
            });
        });
        describe("given multiple types", () => {
            it("should return the first match or false", () => {
                const ctx = testContext();
                ctx.header["content-type"] = "image/png";
                ctx.header["transfer-encoding"] = "chunked";

                assert.strictEqual(ctx.is("png"), "png");
                assert.strictEqual(ctx.is(".png"), ".png");
                assert.strictEqual(ctx.is("text/*", "image/*"), "image/png");
                assert.strictEqual(ctx.is("image/*", "text/*"), "image/png");
                assert.strictEqual(ctx.is("image/*", "image/png"), "image/png");
                assert.strictEqual(ctx.is("image/png", "image/*"), "image/png");

                assert.strictEqual(ctx.is(["text/*", "image/*"]), "image/png");
                assert.strictEqual(ctx.is(["image/*", "text/*"]), "image/png");
                assert.strictEqual(ctx.is(["image/*", "image/png"]), "image/png");
                assert.strictEqual(ctx.is(["image/png", "image/*"]), "image/png");

                assert.strictEqual(ctx.is("jpeg"), false);
                assert.strictEqual(ctx.is(".jpeg"), false);
                assert.strictEqual(ctx.is("text/*", "application/*"), false);
                assert.strictEqual(ctx.is("text/html", "text/plain", "application/json; charset=utf-8"), false);
            });
        });
        describe("when Content-Type: application/x-www-form-urlencoded", () => {
            it("should match 'urlencoded'", () => {
                const ctx = testContext();
                ctx.header["content-type"] = "application/x-www-form-urlencoded";
                ctx.header["transfer-encoding"] = "chunked";

                assert.strictEqual(ctx.is("urlencoded"), "urlencoded");
                assert.strictEqual(ctx.is("json", "urlencoded"), "urlencoded");
                assert.strictEqual(ctx.is("urlencoded", "json"), "urlencoded");
            })
        })
    });
    describe("req type test", () => {
        it("should return type void of parameters", () => {
            const req = testRequest();
            req.header["content-type"] = "text/html; charset=utf-8";
            assert.strictEqual(req.type, "text/html");
        });
        it("should return empty string with no host present", () => {
            const req = testRequest();
            assert.strictEqual(req.type, '');
        });
    });
    describe("res socket test", () => {
        it("should return the request socket object", () => {
            const res = testResponse();
            assert.strictEqual(res.socket instanceof Stream, true);
        });
    });
    describe("res header test", () => {
        it("should return the response header object", () => {
            const res = testResponse();
            res.set("X-Foo", "bar");
            res.set("X-Number", 200);
            assert.deepStrictEqual(res.header, { "x-foo": "bar", "x-number": "200" });
        });
        it("should use res.getHeaders() accessor when available", () => {
            const res = testResponse();
            res.res._headers = null;
            res.res.getHeaders = () => ({ "x-foo": "baz" });
            assert.deepStrictEqual(res.header, { "x-foo": "baz" });
        });
        it("should return the response header object when no mocks are in use", async () => {
            const app = new express();
            let header;
            app.use(ctx => {
                ctx.set("x-foo", "42");
                header = Object.assign({}, ctx.response.header);
            })
            await request(app.callback()).get("/");
            assert.deepStrictEqual(header, { "x-foo": "42" });
        });
        describe("when res._headers not present", () => {
            it("should return empty object", () => {
                const res = testResponse();
                res.res._headers = null;
                assert.deepStrictEqual(res.header, {});
            });
        });
    });
    describe("res status test", () => {
        describe("when a status code", () => {
            describe("and valid", () => {
                it("should set the status", () => {
                    const res = testResponse();
                    res.status = 403;
                    assert.strictEqual(res.status, 403);
                });
                it("should not throw", () => {
                    testResponse().status = 403;
                });
            });
            describe("and invalid", () => {
                it("should throw", () => {
                    assert.throws(() => testResponse().status = 99, /invalid status code: 99/)
                });
            });
            describe("and custom status", () => {
                beforeEach(() => {
                    const statuses = require("statuses");
                    statuses["700"] = "custom status"
                });
                it("should set the status", () => {
                    const res = testResponse();
                    res.status = 700;
                    assert.strictEqual(res.status, 700);
                });
                it("should not throw", () => {
                    testResponse().status = 700;
                });
            });
            describe("and HTTP/2", () => {
                it("should not set the status message", () => {
                    const res = testResponse({
                        httpVersionMajor: 2,
                        httpVersion: "2.0"
                    });
                    res.status = 200;
                    assert(!res.res.statusMessage);
                });
            });
        });
        describe("when a status string", () => {
            it("should throw", () => {
                assert.throws(() => { testResponse().status = "forbidden" }, /status code must be a number/);
            });
        });
        function strip(status) {
            it("should strip content related header fields", async () => {
                const app = new express();
                app.use(ctx => {
                    ctx.body = { foo: "bar" };
                    ctx.set("Content-Type", "application/json; charset=utf-8");
                    ctx.set("Content-Length", "15");
                    ctx.set("Transfer-Encoding", "chunked");
                    ctx.status = status;
                    assert(ctx.response.header["content-type"] == null);
                    assert(ctx.response.header["content-length"] == null);
                    assert(ctx.response.header["transfer-encoding"] == null);
                });
                const res = await request(app.callback()).get("/").expect(status);
                assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "Content-Type"), false);
                assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "content-length"), false);
                assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "content-encoding"), false);
                assert.strictEqual(res.text.length, 0);
            });
            it("should strip content related header fields after status set", async () => {
                const app = new express();
                app.use(ctx => {
                    ctx.status = status;
                    ctx.body = { foo: "bar" };
                    ctx.set("Content-Type", "application/json; charset=utf-8");
                    ctx.set("Content-Length", "15");
                    ctx.set("Transfer-Encoding", "chunked");
                });
                const res = await request(app.callback()).get("/").expect(status);
                assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "Content-Type"), false);
                assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "content-length"), false);
                assert.strictEqual(Object.prototype.hasOwnProperty.call(res.headers, "content-encoding"), false);
                assert.strictEqual(res.text.length, 0);
            });
        }
        describe("when 204", () => strip(204));
        describe("when 205", () => strip(205));
        describe("when 304", () => strip(304));
    });
    describe("res message test", () => {
        it("should return the response status message", () => {
            const res = testResponse();
            res.status = 200;
            assert.strictEqual(res.message, "OK");
        });
        describe("when res.message not present", () => {
            it("should look up in statuses", () => {
                const res = testResponse();
                res.res.statusCode = 200;
                assert.strictEqual(res.message, "OK");
            });
        });
        it("should set response status message", () => {
            const res = testResponse();
            res.status = 200;
            res.message = "ok";
            assert.strictEqual(res.res.statusMessage, "ok");
        });
    });
    describe("res body test", () => {
        describe("when Content-Type is set", () => {
            it("should not override", () => {
                const res = testResponse();
                res.type = "png";
                res.body = Buffer.from("something");
                assert.strictEqual("image/png", res.header["content-type"]);
            });

            describe("when body is an object", () => {
                it("should override as json", () => {
                    const res = testResponse();
                    res.body = "<em>hey</em>";
                    assert.strictEqual("text/html; charset=utf-8", res.header["content-type"]);
                    res.body = { foo: "bar" };
                    assert.strictEqual("application/json; charset=utf-8", res.header["content-type"]);
                });
            });
            it("should override length", () => {
                const res = testResponse();
                res.type = "html";
                res.body = "something";
                assert.strictEqual(res.length, 9);
            });
        });
        describe("when a string is given", () => {
            it("should default to text", () => {
                const res = testResponse();
                res.body = "Tobi";
                assert.strictEqual("text/plain; charset=utf-8", res.header["content-type"]);
            });
            it("should set length", () => {
                const res = testResponse();
                res.body = "Tobi";
                assert.strictEqual("4", res.header["content-length"]);
            });
            describe("and contains a non-leading <", () => {
                it("should default to text", () => {
                    const res = testResponse();
                    res.body = "aklsdjf < klajsdlfjasd";
                    assert.strictEqual("text/plain; charset=utf-8", res.header["content-type"]);
                });
            });
        });
        describe("when an html string is given", () => {
            it("should default to html", () => {
                const res = testResponse();
                res.body = "<h1>Tobi</h1>";
                assert.strictEqual("text/html; charset=utf-8", res.header["content-type"]);
            });
            it("should set length", () => {
                const string = "<h1>Tobi</h1>";
                const res = testResponse();
                res.body = string;
                assert.strictEqual(res.length, Buffer.byteLength(string));
            });
            it("should set length when body is overridden", () => {
                const string = "<h1>Tobi</h1>";
                const res = testResponse();
                res.body = string;
                res.body = string + string;
                assert.strictEqual(res.length, 2 * Buffer.byteLength(string));
            });
            describe("when it contains leading whitespace", () => {
                it("should default to html", () => {
                    const res = testResponse();
                    res.body = "    <h1>Tobi</h1>";
                    assert.strictEqual("text/html; charset=utf-8", res.header["content-type"]);
                });
            });
        });
        describe("when an xml string is given", () => {
            it("should default to html", () => {
                const res = testResponse();
                res.body = '<?xml version="1.0" encoding="UTF-8"?>\n<俄语>данные</俄语>';
                assert.strictEqual("text/html; charset=utf-8", res.header["content-type"]);
            });
        });
        describe("when a stream is given", () => {
            it("should default to an octet stream", () => {
                const res = testResponse();
                res.body = fs.createReadStream("package.json");
                assert.strictEqual("application/octet-stream", res.header["content-type"]);
            });
            it("should add error handler to the stream, but only once", () => {
                const res = testResponse();
                const body = new Stream.PassThrough();
                assert.strictEqual(body.listenerCount("error"), 0);
                res.body = body;
                assert.strictEqual(body.listenerCount("error"), 1);
                res.body = body;
                assert.strictEqual(body.listenerCount("error"), 1);
            });
        });
        describe("when a buffer is given", () => {
            it("should default to an octet stream", () => {
                const res = testResponse();
                res.body = Buffer.from("hey");
                assert.strictEqual("application/octet-stream", res.header["content-type"]);
            });
            it("should set length", () => {
                const res = testResponse();
                res.body = Buffer.from("Tobi");
                assert.strictEqual("4", res.header["content-length"]);
            });
        });
        describe("when an object is given", () => {
            it("should default to json", () => {
                const res = testResponse();
                res.body = { foo: "bar" };
                assert.strictEqual("application/json; charset=utf-8", res.header["content-type"]);
            });
        });
    });
    describe("res length test", () => {
        describe("when Content-Length is defined", () => {
            it("should return a number", () => {
                const res = testResponse();
                res.set("Content-Length", "1024");
                assert.strictEqual(res.length, 1024);
            });
            describe("but not number", () => {
                it("should return 0", () => {
                    const res = testResponse();
                    res.set("Content-Length", "hey");
                    assert.strictEqual(res.length, 0);
                });
            });
        });
        describe("when Content-Length is not defined", () => {
            describe("and a .body is set", () => {
                it("should return a number", () => {
                    const res = testResponse();

                    res.body = null;
                    assert.strictEqual(res.length, undefined);

                    res.body = "foo";
                    res.remove("Content-Length");
                    assert.strictEqual(res.length, 3);

                    res.body = "foo";
                    assert.strictEqual(res.length, 3);

                    res.body = Buffer.from("foo bar");
                    res.remove("Content-Length");
                    assert.strictEqual(res.length, 7);

                    res.body = Buffer.from("foo bar");
                    assert.strictEqual(res.length, 7);

                    res.body = { hello: "world" };
                    res.remove("Content-Length");
                    assert.strictEqual(res.length, 17);

                    res.body = { hello: "world" };
                    assert.strictEqual(res.length, 17);

                    res.body = fs.createReadStream("package.json");
                    assert.strictEqual(res.length, undefined);

                    res.body = null;
                    assert.strictEqual(res.length, undefined);
                });
            });
            describe("and .body is not", () => {
                it("should return undefined", () => {
                    const res = testResponse();
                    assert.strictEqual(res.length, undefined);
                });
            });
        });
        describe("and a .type is set to json", () => {
            describe("and a .body is set to null", () => {
                it("should return a number", () => {
                    const res = testResponse();
                    res.type = "json";
                    res.body = null;
                    assert.strictEqual(res.length, 4);
                });
            });
        });
    });
    describe("res vary (field) test", () => {
        describe("when Vary is not set", () => {
            it("should set it", () => {
                const ctx = testContext()
                ctx.vary("Accept");
                assert.strictEqual(ctx.response.header.vary, "Accept");
            });
        });
        describe("when Vary is set", () => {
            it("should append", () => {
                const ctx = testContext();
                ctx.vary("Accept");
                ctx.vary("Accept-Encoding");
                assert.strictEqual(ctx.response.header.vary, "Accept, Accept-Encoding");
            });
        });
        describe("when Vary already contains the value", () => {
            it("should not append", () => {
                const ctx = testContext();
                ctx.vary("Accept");
                ctx.vary("Accept-Encoding");
                ctx.vary("Accept");
                ctx.vary("Accept-Encoding");
                assert.strictEqual(ctx.response.header.vary, "Accept, Accept-Encoding");
            });
        });
    });
    describe("res redirect (url) test", () => {
        function escape (html){
            return String(html).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        }
        it("should redirect to the given url", () => {
            const ctx = testContext();
            ctx.redirect("http://google.com");
            assert.strictEqual(ctx.response.header.location, "http://google.com");
            assert.strictEqual(ctx.status, 302);
        });
        it("should auto fix not encode url", done => {
            const app = new express();
            app.use(ctx => {
                ctx.redirect("http://google.com/😓");
            });
            request(app.callback()).get("/").end((err, res) => {
                if (err) return done(err);
                assert.strictEqual(res.status, 302);
                assert.strictEqual(res.headers.location, "http://google.com/%F0%9F%98%93");
                done();
            });
        });
        describe("with 'back'", () => {
            it("should redirect to Referrer", () => {
                const ctx = testContext();
                ctx.req.headers.referrer = "/login";
                ctx.redirect("back");
                assert.strictEqual(ctx.response.header.location, "/login");
            });
            it("should redirect to Referer", () => {
                const ctx = testContext();
                ctx.req.headers.referer = "/login";
                ctx.redirect("back");
                assert.strictEqual(ctx.response.header.location, "/login");
            });
            it("should default to alt", () => {
                const ctx = testContext();
                ctx.redirect("back", "/index.html");
                assert.strictEqual(ctx.response.header.location, "/index.html");
            });
            it("should default redirect to /", () => {
                const ctx = testContext();
                ctx.redirect("back");
                assert.strictEqual(ctx.response.header.location, "/");
            });
        });
        describe("when html is accepted", () => {
            it("should respond with html", () => {
                const ctx = testContext();
                const url = "http://google.com";
                ctx.header.accept = "text/html";
                ctx.redirect(url);
                assert.strictEqual(ctx.response.header["content-type"], "text/html; charset=utf-8");
                assert.strictEqual(ctx.body, `Redirecting to <a href="${url}">${url}</a>.`);
            });
            it("should escape the url", () => {
                const ctx = testContext();
                let url = "<script>";
                ctx.header.accept = "text/html";
                ctx.redirect(url);
                url = escape(url);
                assert.strictEqual(ctx.response.header["content-type"], "text/html; charset=utf-8");
                assert.strictEqual(ctx.body, `Redirecting to <a href="${url}">${url}</a>.`);
            });
        });
        describe("when text is accepted", () => {
            it("should respond with text", () => {
                const ctx = testContext();
                const url = "http://google.com";
                ctx.header.accept = "text/plain";
                ctx.redirect(url);
                assert.strictEqual(ctx.body, `Redirecting to ${url}.`);
            });
        });
        describe("when status is 301", () => {
            it("should not change the status code", () => {
                const ctx = testContext();
                const url = "http://google.com";
                ctx.status = 301;
                ctx.header.accept = "text/plain";
                ctx.redirect("http://google.com");
                assert.strictEqual(ctx.status, 301);
                assert.strictEqual(ctx.body, `Redirecting to ${url}.`);
            });
        });
        describe("when status is 304", () => {
            it("should change the status code", () => {
                const ctx = testContext();
                const url = "http://google.com";
                ctx.status = 304;
                ctx.header.accept = "text/plain";
                ctx.redirect("http://google.com");
                assert.strictEqual(ctx.status, 302);
                assert.strictEqual(ctx.body, `Redirecting to ${url}.`);
            });
        });
        describe("when content-type was present", () => {
            it("should overwrite content-type", () => {
                const ctx = testContext();
                ctx.body = {};
                const url = "http://google.com";
                ctx.header.accept = "text/plain";
                ctx.redirect("http://google.com");
                assert.strictEqual(ctx.status, 302);
                assert.strictEqual(ctx.body, `Redirecting to ${url}.`);
                assert.strictEqual(ctx.type, "text/plain");
            });
        });
    });
    describe("app logger test", () => {
        describe("logger module test", () => {
            describe("compile with format", () => {
                const logger = express.logger;
                it("should be required", () => {
                    assert.throws(logger.compile.bind(logger), /format must be string/)
                });
                it("should reject functions", () => {
                    assert.throws(logger.compile.bind(logger, () => {}), /format must be string/)
                });
                it("should reject numbers", () => {
                    assert.throws(logger.compile.bind(logger, 42), /format must be string/)
                });
                it("should compile a string into a function", () => {
                    const fn = logger.compile(":method");
                    assert.ok(typeof fn === "function");
                    assert.ok(fn.length === 3);
                });
            });
        });
        describe("logger middleware test", () => {
            describe("Logger function test", () => {
                let hook;
                beforeEach(() => hook = captureStream(stdout));
                afterEach(() => hook.unhook());
                it("should use middleware and display method + url + response time", async () => {
                    const app = new express();
                    app.use(express.logger("dev"));
                    app.use(async ctx => ctx.body = "Message");
                    await request(app.callback()).get("/").expect(200);
                    const capture = hook.captured();
                    assert(capture.includes("GET"));
                    assert(capture.includes("200"));
                    assert(capture.includes("ms"));
                });
            });
        });
    });
    describe("app router test", () => {
        it("should create new router", done => {
            const Router = require("../plugins/express/router.js");
            const router = express.router();
            assert.strictEqual(router instanceof Router, true);
            done();
        });
        it("shares context between routers", done => {
            const app = new express();
            const router1 = express.router();
            const router2 = express.router();
            router1.get("/", (ctx, next) => {
                ctx.foo = "bar";
                return next();
            });
            router2.get("/", (ctx, next) => {
                ctx.baz = "qux";
                ctx.body = { foo: ctx.foo };
                return next();
            });
            app.use(router1.routes()).use(router2.routes());
            request(http.createServer(app.callback())).get("/").expect(200).end((err, res) => {
                if (err) return done(err);
                assert.strictEqual(res.body["foo"], "bar");
                done();
            });
        });
        it("does not register middleware more than once", done => {
            const app = new express();
            const parentRouter = express.router();
            const nestedRouter = express.router();
            nestedRouter.get("/first-nested-route", ctx => ctx.body = { n: ctx.n }).get("/second-nested-route", (ctx, next) => next()).get("/third-nested-route", (ctx, next) => next());
            parentRouter.use("/parent-route", (ctx, next) => { ctx.n = ctx.n ? ctx.n + 1 : 1; return next(); }, nestedRouter.routes());
            app.use(parentRouter.routes());
            request(http.createServer(app.callback())).get("/parent-route/first-nested-route").expect(200).end((err, res) => {
                if (err) return done(err);
                assert.strictEqual(res.body["n"], 1);
                done();
            });
        });
        it("router can be accecced with ctx", done => {
            const app = new express();
            const router = express.router();
            router.get("home", "/", ctx => ctx.body = { url: ctx.router.url("home") });
            app.use(router.routes());
            request(http.createServer(app.callback())).get("/").expect(200).end((err, res) => {
                if (err) return done(err);
                assert.strictEqual(res.body.url, "/");
                done();
            });
        });
        it("registers multiple middleware for one route", done => {
            const app = new express();
            const router = express.router();
            router.get("/double",
                (ctx, next) => new Promise(resolve => {
                    setTimeout(function () {
                        ctx.body = {message: "Hello"};
                        resolve(next());
                    }, 1);
                }),
                (ctx, next) => new Promise(resolve => {
                    setTimeout(function () {
                        ctx.body.message += " World";
                        resolve(next());
                    }, 1);
                }),
                ctx => ctx.body.message += "!");
            app.use(router.routes());
            request(http.createServer(app.callback())).get("/double").expect(200).end((err, res) => {
                if (err) return done(err);
                assert.strictEqual(res.body.message, "Hello World!");
                done();
            });
        });
        it("does not break when nested-routes use regexp paths", done => {
            const app = new express();
            const parentRouter = express.router();
            const nestedRouter = express.router();
            nestedRouter.get(/^\/\w$/i, (ctx, next) => next()).get("/first-nested-route", (ctx, next) => next()).get("/second-nested-route", (ctx, next) => next());
            parentRouter.use("/parent-route", (ctx, next) => next(), nestedRouter.routes());
            app.use(parentRouter.routes());
            assert.ok(app);
            done();
        });
        it("exposes middleware factory", done => {
            const router = express.router();
            assert("routes" in router);
            assert.strictEqual(typeof router.routes, "function");
            const middleware = router.routes();
            assert.ok(middleware);
            assert.strictEqual(typeof middleware, "function");
            done();
        });
        it("supports promises for async/await", done => {
            const app = new express();
            const router = express.router();
            router.get("/async", ctx => new Promise(function (resolve) {
                setTimeout(() => {
                    ctx.body = { msg: "promises!" };
                    resolve();
                }, 1);
            }));
            app.use(router.routes()).use(router.allowedMethods());
            request(http.createServer(app.callback())).get("/async").expect(200).end((err, res) => {
                if (err) return done(err);
                assert.strictEqual(res.body["msg"], "promises!")
                done();
            });
        });
        it("matches middleware only if route was matched", done => {
            const app = new express();
            const router = express.router();
            const otherRouter = express.router();
            router.use((ctx, next) => {
                ctx.body = { bar: "baz" };
                return next();
            });
            otherRouter.get("/bar", ctx => {
                ctx.body = ctx.body || { foo: "bar" };
            });
            app.use(router.routes()).use(otherRouter.routes());
            request(http.createServer(app.callback())).get("/bar").expect(200).end((err, res) => {
                if (err) return done(err);
                assert.strictEqual(res.body["foo"], "bar");
                assert.strictEqual(res.body["bar"], undefined);
                done();
            });
        });
        it("matches first to last", done => {
            const app = new express();
            const router = express.router();
            router.get("user_page", "/user/(.*).jsx", ctx => ctx.body = { order: 1 }).all("app", "/app/(.*).jsx", ctx => ctx.body = { order: 2 }).all("view", "(.*).jsx", ctx => ctx.body = { order: 3 });
            request(http.createServer(app.use(router.routes()).callback())).get("/user/account.jsx").expect(200).end((err, res) => {
                if (err) return done(err);
                assert.strictEqual(res.body["order"], 1);
                done();
            });
        });
        it("runs multiple controllers when there are multiple matches", done => {
            const app = new express();
            const router = express.router();
            router.get("users_single", "/users/:id(.*)", (ctx, next) => {
                ctx.body = { single: true };
                next();
            }).get("users_all", "/users/all", (ctx, next) => {
                ctx.body = { ...ctx.body, all: true };
                next();
            });
            request(http.createServer(app.use(router.routes()).callback())).get("/users/all").expect(200).end((err, res) => {
                if (err) return done(err);
                assert.strictEqual(res.body["single"], true);
                assert.strictEqual(res.body["all"], true);
                done();
            });
        });
        it("runs only the last match when the 'exclusive' option is enabled", done => {
            const app = new express();
            const router = express.router({ exclusive: true });
            router.get("users_single", "/users/:id(.*)", (ctx, next) => {
                ctx.body = { single: true };
                next();
            }).get("users_all", "/users/all", (ctx, next) => {
                ctx.body = { ...ctx.body, all: true };
                next();
            });
            request(http.createServer(app.use(router.routes()).callback())).get("/users/all").expect(200).end((err, res) => {
                if (err) return done(err);
                assert.strictEqual(res.body["single"], undefined);
                assert.strictEqual(res.body["all"], true);
                done();
            });
        });
        it("does not run subsequent middleware without calling next", done => {
            const app = new express();
            const router = express.router();
            router.get("user_page", "/user/(.*).jsx", () => { /* no next() */ }, ctx => ctx.body = { order: 1 });
            request(http.createServer(app.use(router.routes()).callback())).get("/user/account.jsx").expect(404).end(done);
        });
        it("nests routers with prefixes at root", function (done) {
            const app = new express();
            const api = express.router();
            const forums = express.router({ prefix: "/forums" });
            const posts = express.router({ prefix: "/:fid/posts" });
            let server;
            posts.get("/", (ctx, next) => {
                ctx.status = 204;
                return next();
            }).get("/:pid", (ctx, next) => {
                ctx.body = ctx.params;
                return next();
            });
            forums.use(posts.routes());
            server = http.createServer(app.use(forums.routes()).callback());
            request(server).get("/forums/1/posts").expect(204).end(err => {
                if (err) return done(err);
                request(server).get("/forums/1").expect(404).end(err => {
                    if (err) return done(err);
                    request(server).get("/forums/1/posts/2").expect(200).end(function (err, res) {
                        if (err) return done(err);
                        assert.strictEqual(res.body["fid"], "1");
                        assert.strictEqual(res.body["pid"], "2");
                        done();
                    });
                });
            });
        });
        it("nests routers with prefixes at path", done => {
            const app = new express();
            const forums = express.router({ prefix: "/api" });
            const posts = express.router({ prefix: "/posts" });
            let server;
            posts.get("/", (ctx, next) => {
                ctx.status = 204;
                return next();
            }).get("/:pid", (ctx, next) => {
                ctx.body = ctx.params;
                return next();
            });
            forums.use("/forums/:fid", posts.routes());
            server = http.createServer(app.use(forums.routes()).callback());
            request(server).get("/api/forums/1/posts").expect(204).end(err => {
                if (err) return done(err);
                request(server).get("/api/forums/1").expect(404).end(err => {
                    if (err) return done(err);
                    request(server).get("/api/forums/1/posts/2").expect(200).end((err, res) => {
                        if (err) return done(err);
                        assert.strictEqual(res.body["fid"], "1");
                        assert.strictEqual(res.body["pid"], "2");
                        done();
                    });
                });
            });
        });
        it("runs subrouter middleware after parent", done => {
            const app = new express();
            const subrouter = express.router().use((ctx, next) => {
                ctx.msg = "subrouter";
                return next();
            }).get("/", ctx => ctx.body = { msg: ctx.msg });
            const router = express.router().use((ctx, next) => {
                ctx.msg = "router";
                return next();
            }).use(subrouter.routes());
            request(http.createServer(app.use(router.routes()).callback())).get("/").expect(200).end((err, res) => {
                if (err) return done(err);
                assert.strictEqual(res.body["msg"], "subrouter");
                done();
            });
        });
        it("runs parent middleware for subrouter routes", done => {
            const app = new express();
            const subrouter = express.router().get("/sub", ctx => ctx.body = { msg: ctx.msg });
            const router = express.router().use((ctx, next) => {
                ctx.msg = "router";
                return next();
            }).use("/parent", subrouter.routes());
            request(http.createServer(app.use(router.routes()).callback())).get("/parent/sub").expect(200).end((err, res) => {
                if (err) return done(err);
                assert.strictEqual(res.body["msg"], "router");
                done();
            });
        });
        it("matches corresponding requests", done => {
            const app = new express();
            const router = express.router();
            app.use(router.routes());
            router.get("/:category/:title", ctx => {
                assert.strictEqual("params" in ctx, true);
                assert.strictEqual(ctx.params["category"], "programming");
                assert.strictEqual(ctx.params["title"], "how-to-node");
                ctx.status = 204;
            });
            router.post("/:category", ctx => {
                assert.strictEqual("params" in ctx, true);
                assert.strictEqual(ctx.params["category"], "programming");
                ctx.status = 204;
            });
            router.put("/:category/not-a-title", ctx => {
                assert.strictEqual("params" in ctx, true);
                assert.strictEqual(ctx.params["category"], "programming");
                assert.strictEqual(ctx.params["title"], undefined);
                ctx.status = 204;
            });
            const server = http.createServer(app.callback());
            request(server).get("/programming/how-to-node").expect(204).end(err => {
                if (err) return done(err);
                request(server).post("/programming").expect(204).end(err => {
                    if (err) return done(err);
                    request(server).put("/programming/not-a-title").expect(204).end((err, res) => done(err));
                });
            });
        });
        it("matches corresponding requests with optional route parameter", done => {
            const app = new express();
            const router = express.router();
            app.use(router.routes());
            router.get("/resources", ctx => {
                assert.strictEqual("params" in ctx, true);
                assert.deepStrictEqual(ctx.params, {});
                ctx.status = 204;
            });
            const id = "10", ext = ".json";
            router.get("/resources/:id{.:ext}?", ctx => {
                assert.strictEqual("params" in ctx, true);
                assert.strictEqual(ctx.params["id"], id);
                if (ctx.params.ext) assert.strictEqual(ctx.params.ext, ext.slice(1));
                ctx.status = 204;
            });
            const server = http.createServer(app.callback());
            request(server).get("/resources").expect(204).end(err => {
                if (err) return done(err);
                request(server).get("/resources/" + id).expect(204).end(err => {
                    if (err) return done(err);
                    request(server).get("/resources/" + id + ext).expect(204).end((err, res) => done(err));
                });
            });
        });
        it("executes route middleware using `app.context`", done => {
            const app = new express();
            const router = express.router();
            app.use(router.routes());
            router.use((ctx, next) => {
                ctx.bar = "baz";
                return next();
            });
            router.get("/:category/:title",
                (ctx, next) => {
                    ctx.foo = "bar";
                    return next();
                }, ctx => {
                    assert.strictEqual(ctx["bar"], "baz");
                    assert.strictEqual(ctx["foo"], "bar");
                    assert.strictEqual("app" in ctx, true);
                    assert.strictEqual("req" in ctx, true);
                    assert.strictEqual("res" in ctx, true);
                    ctx.status = 204;
                    done();
                }
            );
            request(http.createServer(app.callback())).get("/match/this").expect(204).end(err => {
                if (err) return done(err);
            });
        });
        it("does not match after ctx.throw()", done => {
            const app = new express();
            let counter = 0;
            const router = express.router();
            app.use(router.routes());
            router.get("/", ctx => {
                counter++;
                ctx.throw(403);
            });
            router.get("/", () => counter++);
            const server = http.createServer(app.callback());
            request(server).get("/").expect(403).end((err, res) => {
                if (err) return done(err);
                assert.strictEqual(counter, 1);
                done();
            });
        });
        it("supports promises for route middleware", done => {
            const app = new express();
            const router = express.router();
            app.use(router.routes());
            const readVersion = () => new Promise((resolve, reject) => {
                const packagePath = path.join(__dirname, "..", "package.json");
                fs.readFile(packagePath, "utf8", function (err, data) {
                    if (err) return reject(err);
                    resolve(JSON.parse(data).version);
                });
            });
            router.get("/", (ctx, next) => next(), ctx => readVersion().then(() => ctx.status = 204));
            request(http.createServer(app.callback())).get("/").expect(204).end(done);
        });
        describe("Router#allowedMethods()", () => {
            it("responds to OPTIONS requests", done => {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                app.use(router.allowedMethods());
                router.get("/users", () => {});
                router.put("/users", () => {});
                request(http.createServer(app.callback())).options("/users").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(res.header["content-length"], "0");
                    assert.strictEqual(res.header["allow"], "HEAD, GET, PUT");
                    done();
                });
            });
            it("responds with 405 Method Not Allowed", done => {
                const app = new express();
                const router = express.router();
                router.get("/users", () => {});
                router.put("/users", () => {});
                router.post("/events", () => {});
                app.use(router.routes());
                app.use(router.allowedMethods());
                request(http.createServer(app.callback())).post("/users").expect(405).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(res.header["allow"], "HEAD, GET, PUT");
                    done();
                });
            });
            it("responds with 405 Method Not Allowed using the 'throw' option", done => {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                app.use((ctx, next) => next().catch(err => {
                    // assert that the correct HTTPError was thrown
                    assert.strictEqual(err.name, "MethodNotAllowedError");
                    assert.strictEqual(err.statusCode, 405);

                    // translate the HTTPError to a normal response
                    ctx.body = err.name;
                    ctx.status = err.statusCode;
                }));
                app.use(router.allowedMethods({ throw: true }));
                router.get("/users", () => {});
                router.put("/users", () => {});
                router.post("/events", () => {});
                request(http.createServer(app.callback())).post("/users").expect(405).end((err, res) => {
                    if (err) return done(err);
                    // the "Allow" header is not set when throwing
                    assert.strictEqual("allow" in res.header, false);
                    done();
                });
            });
            it("responds with user-provided throwable using the 'throw' and 'methodNotAllowed' options", done => {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                app.use((ctx, next) => next().catch(err => {
                    // assert that the correct HTTPError was thrown
                    assert.strictEqual(err.message, "Custom Not Allowed Error");
                    assert.strictEqual(err.statusCode, 405);

                    // translate the HTTPError to a normal response
                    ctx.body = err.body;
                    ctx.status = err.statusCode;
                }));
                app.use(router.allowedMethods({
                    throw: true,
                    methodNotAllowed() {
                        const notAllowedErr = new Error("Custom Not Allowed Error");
                        notAllowedErr.type = "custom";
                        notAllowedErr.statusCode = 405;
                        notAllowedErr.body = {
                            error: "Custom Not Allowed Error",
                            statusCode: 405,
                            otherStuff: true
                        };
                        return notAllowedErr;
                    }
                }));
                router.get("/users", () => {});
                router.put("/users", () => {});
                router.post("/events", () => {});
                request(http.createServer(app.callback())).post("/users").expect(405).end((err, res) => {
                    if (err) return done(err);
                    // the "Allow" header is not set when throwing
                    assert.strictEqual("allow" in res.header, false);
                    assert.deepStrictEqual(res.body, {
                        error: "Custom Not Allowed Error",
                        statusCode: 405,
                        otherStuff: true
                    });
                    done();
                });
            });
            it("responds with 501 Not Implemented", done => {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                app.use(router.allowedMethods());
                router.get("/users", () => {});
                router.put("/users", () => {});
                request(http.createServer(app.callback())).search("/users").expect(501).end(err => {
                    if (err) return done(err);
                    done();
                });
            });
            it("responds with 501 Not Implemented using the 'throw' option", done => {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                app.use((ctx, next) => next().catch(err => {
                    // assert that the correct HTTPError was thrown
                    assert.strictEqual(err.name, "NotImplementedError");
                    assert.strictEqual(err.statusCode, 501);

                    // translate the HTTPError to a normal response
                    ctx.body = err.name;
                    ctx.status = err.statusCode;
                }));
                app.use(router.allowedMethods({ throw: true }));
                router.get("/users", () => {});
                router.put("/users", () => {});
                request(http.createServer(app.callback())).search("/users").expect(501).end((err, res) => {
                    if (err) return done(err);
                    // the "Allow" header is not set when throwing
                    assert.strictEqual("allow" in res.header, false);
                    done();
                });
            });
            it("responds with user-provided throwable using the 'throw' and 'notImplemented' options", done => {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                app.use((ctx, next) => next().catch(err => {
                    // assert that our custom error was thrown
                    assert.strictEqual(err.message, "Custom Not Implemented Error");
                    assert.strictEqual(err.type, "custom");
                    assert.strictEqual(err.statusCode, 501);

                    // translate the HTTPError to a normal response
                    ctx.body = err.body;
                    ctx.status = err.statusCode;
                }));
                app.use(router.allowedMethods({
                    throw: true,
                    notImplemented() {
                        const notImplementedErr = new Error("Custom Not Implemented Error");
                        notImplementedErr.type = "custom";
                        notImplementedErr.statusCode = 501;
                        notImplementedErr.body = {
                            error: "Custom Not Implemented Error",
                            statusCode: 501,
                            otherStuff: true
                        };
                        return notImplementedErr;
                    }
                }));
                router.get("/users", () => {});
                router.put("/users", () => {});
                request(http.createServer(app.callback())).search("/users").expect(501).end((err, res) => {
                    if (err) return done(err);
                    // the "Allow" header is not set when throwing
                    assert.strictEqual("allow" in res.header, false);
                    assert.deepStrictEqual(res.body, {
                        error: "Custom Not Implemented Error",
                        otherStuff: true,
                        statusCode: 501
                    });
                    done();
                });
            });
            it("does not send 405 if route matched but status is 404", done => {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                app.use(router.allowedMethods());
                router.get("/users", ctx => ctx.status = 404);
                request(http.createServer(app.callback())).get("/users").expect(404).end(err => {
                    if (err) return done(err);
                    done();
                });
            });
            it("sets the allowed methods to a single Allow header", done => {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                app.use(router.allowedMethods());
                router.get("/", () => {});
                request(http.createServer(app.callback())).options("/").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(res.header["allow"], "HEAD, GET");
                    const allowHeaders = res.res.rawHeaders.filter(item => item === "Allow");
                    assert.strictEqual(allowHeaders.length, 1);
                    done();
                });
            });
        });
        it("allowedMethods check if flow (allowedArr.length)", done => {
            const app = new express();
            const router = express.router();
            app.use(router.routes());
            app.use(router.allowedMethods());
            router.get('');
            request(http.createServer(app.callback())).get("/users").end(() => done());
        });
        it("supports custom routing detect path: ctx.routerPath", done => {
            const app = new express();
            const router = express.router();
            app.use((ctx, next) => {
                // bind helloworld.example.com/users => example.com/helloworld/users
                const appname = ctx.request.hostname.split(".", 1)[0];
                ctx.routerPath = "/" + appname + ctx.path;
                return next();
            });
            app.use(router.routes());
            router.get("/helloworld/users", ctx => ctx.body = ctx.method + " " + ctx.url);
            request(http.createServer(app.callback())).get("/users").set("Host", "helloworld.example.com").expect(200).expect("GET /users", done);
        });
        it("parameter added to request in ctx", done => {
            const app = new express();
            const router = express.router();
            router.get("/echo/:saying", ctx => {
                try {
                    assert.strictEqual(ctx.params["saying"], "helloWorld");
                    assert.strictEqual(ctx.request.params["saying"], "helloWorld");
                    ctx.body = { echo: ctx.params["saying"] };
                } catch (err) {
                    ctx.status = 500;
                    ctx.body = err.message;
                }
            });
            app.use(router.routes());
            request(http.createServer(app.callback())).get("/echo/helloWorld").expect(200).end((err, res) => {
                if (err) return done(err);
                assert.deepStrictEqual(res.body, { echo: "helloWorld" });
                done();
            });
        });
        it("parameter added to request in ctx with sub router", done => {
            const app = new express();
            const router = express.router();
            const subrouter = express.router();
            router.use((ctx, next) => {
                ctx.foo = "boo";
                return next();
            });
            subrouter.get("/:saying", ctx => {
                try {
                    assert.strictEqual(ctx.params["saying"], "helloWorld");
                    assert.strictEqual(ctx.request.params["saying"], "helloWorld");
                    ctx.body = { echo: ctx.params["saying"] };
                } catch (err) {
                    ctx.status = 500;
                    ctx.body = err.message;
                }
            });
            router.use("/echo", subrouter.routes());
            app.use(router.routes());
            request(http.createServer(app.callback())).get("/echo/helloWorld").expect(200).end((err, res) => {
                if (err) return done(err);
                assert.deepStrictEqual(res.body, { echo: "helloWorld" });
                done();
            });
        });
        describe("Router#[verb]()", () => {
            const { METHODS } = require("node:http");
            const methods = METHODS && METHODS.map(method => method.toLowerCase());
            it("registers route specific to HTTP verb", () => {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                for (const method of methods) {
                    assert.strictEqual(method in router, true);
                    assert.strictEqual(typeof router[method], "function");
                    router[method]("/", () => {});
                }
                assert.strictEqual(router.stack.length, methods.length);
            });

            it("registers route with a regexp path", () => {
                const router = express.router();
                for (const method of methods) {
                    assert.strictEqual(router[method](/^\/\w$/i, () => {}), router);
                }
            });
            it("registers route with a given name", () => {
                const router = express.router();
                for (const method of methods) {
                    assert.strictEqual(router[method](method, "/", () => {}), router);
                }
            });
            it("registers route with with a given name and regexp path", () => {
                const router = express.router();
                for (const method of methods) {
                    assert.strictEqual(router[method](method, /^\/$/i, () => {}), router);
                }
            });
            it("enables route chaining", () => {
                const router = express.router();
                for (const method of methods) {
                    assert.strictEqual(router[method]("/", () => {}), router);
                }
            });
            it("registers array of paths", () => {
                const router = express.router();
                router.get(["/one", "/two"], (ctx, next) => next());
                assert.strictEqual(router.stack["length"], 2);
                assert.strictEqual(router.stack[0]["path"], "/one");
                assert.strictEqual(router.stack[1]["path"], "/two");
            });
            it("resolves non-parameterized routes without attached parameters", done => {
                const app = new express();
                const router = express.router();
                router.get("/notparameter", ctx => ctx.body = { param: ctx.params.parameter });
                router.get("/:parameter", ctx => ctx.body = { param: ctx.params.parameter });
                app.use(router.routes());
                request(http.createServer(app.callback())).get("/notparameter").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual("param" in res.body, false);
                    done();
                });
            });
            it("correctly returns an error when not passed a path for verb-specific registration", () => {
                const router = express.router();
                for (const el of methods) {
                    try {
                        router[el](() => {});
                    } catch (err) {
                        assert.strictEqual(err.message, `You have to provide a path when adding a ${el} handler`);
                    }
                }
            });
            it("correctly returns an error when not passed a path for 'all' registration", () => {
                const router = express.router();
                try {
                    router.all(() => {});
                } catch (err) {
                    assert.strictEqual(err.message, "You have to provide a path when adding an all handler");
                }
            });
        });
        describe("Router#use()", () => {
            it("uses router middleware without path", done => {
                const app = new express();
                const router = express.router();
                router.use((ctx, next) => {
                    ctx.foo = "baz";
                    return next();
                });
                router.use((ctx, next) => {
                    ctx.foo = "foo";
                    return next();
                });
                router.get("/foo/bar", ctx => ctx.body = {
                    foobar: ctx.foo + "bar"
                });
                app.use(router.routes());
                request(http.createServer(app.callback())).get("/foo/bar").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(res.body["foobar"], "foobar");
                    done();
                });
            });
            it("uses router middleware at given path", done => {
                const app = new express();
                const router = express.router();
                router.use("/foo/bar", (ctx, next) => {
                    ctx.foo = "foo";
                    return next();
                });
                router.get("/foo/bar", ctx => ctx.body = {
                    foobar: ctx.foo + "bar"
                });
                app.use(router.routes());
                request(http.createServer(app.callback())).get("/foo/bar").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(res.body["foobar"], "foobar");
                    done();
                });
            });
            it("runs router middleware before subrouter middleware", function (done) {
                const app = new express();
                const router = express.router();
                const subrouter = express.router();
                router.use((ctx, next) => {
                    ctx.foo = "boo";
                    return next();
                });
                subrouter.use((ctx, next) => {
                    ctx.foo = "foo";
                    return next();
                }).get("/bar", ctx => ctx.body = {
                    foobar: ctx.foo + "bar"
                });
                router.use("/foo", subrouter.routes());
                app.use(router.routes());
                request(http.createServer(app.callback())).get("/foo/bar").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(res.body["foobar"], "foobar");
                    done();
                });
            });
            it("assigns middleware to array of paths", done => {
                const app = new express();
                const router = express.router();
                router.use(["/foo", "/bar"], (ctx, next) => {
                    ctx.foo = "foo";
                    ctx.bar = "bar";
                    return next();
                });
                router.get("/foo", ctx => ctx.body = {
                    foobar: ctx.foo + "bar"
                });
                router.get("/bar", ctx => ctx.body = {
                    foobar: "foo" + ctx.bar
                });
                app.use(router.routes());
                request(http.createServer(app.callback())).get("/foo").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(res.body["foobar"], "foobar");
                    request(http.createServer(app.callback())).get("/bar").expect(200).end((err, res) => {
                        if (err) return done(err);
                        assert.strictEqual(res.body["foobar"], "foobar");
                        done();
                    });
                });
            });
            it("without path, does not set params.0 to the matched path", done => {
                const app = new express();
                const router = express.router();
                router.use((ctx, next) => next());
                router.get("/foo/:id", ctx => ctx.body = ctx.params);
                app.use(router.routes());
                request(http.createServer(app.callback())).get("/foo/815").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(res.body["id"], "815");
                    assert.strictEqual("0" in res.body, false);
                    done();
                });
            });
            it("does not add an erroneous (.*) to unprefiexed nested routers", done => {
                const app = new express();
                const router = express.router();
                const nested = express.router();
                let called = 0;
                nested.get("/", (ctx, next) => {
                    ctx.body = "root";
                    called += 1;
                    return next();
                }).get("/test", (ctx, next) => {
                    ctx.body = "test";
                    called += 1;
                    return next();
                });
                router.use(nested.routes());
                app.use(router.routes());
                request(app.callback()).get("/test").expect(200).expect("test").end(err => {
                    if (err) return done(err);
                    assert.strictEqual(called, 1, "too many routes matched");
                    done();
                });
            });
            it("assigns middleware to array of paths with function middleware and router need to nest.", done => {
                const app = new express();
                const base = express.router({ prefix: "/api" });
                const nested = express.router({ prefix: "/qux" });
                const pathList = ["/foo", "/bar"];
                nested.get("/baz", ctx => ctx.body = {
                    foo: ctx.foo,
                    bar: ctx.bar,
                    baz: "baz"
                });
                base.use(pathList, (ctx, next) => {
                    ctx.foo = "foo";
                    ctx.bar = "bar";
                    return next();
                }, nested.routes());
                app.use(base.routes());
                Promise.all(pathList.map((pathname) => request(http.createServer(app.callback())).get(`/api${pathname}/qux/baz`).expect(200))).then((resList) => {
                    for (const res of resList)
                        assert.deepEqual(res.body, { foo: "foo", bar: "bar", baz: "baz" });
                    done();
                }, err => done(err));
            });
            it("uses a same router middleware at given paths continuously", done => {
                const app = new express();
                const base = express.router({ prefix: "/api" });
                const nested = express.router({ prefix: "/qux" });
                nested.get("/baz", ctx => ctx.body = {
                    foo: ctx.foo,
                    bar: ctx.bar,
                    baz: "baz"
                });
                base.use("/foo", (ctx, next) => {
                    ctx.foo = "foo";
                    ctx.bar = "bar";
                    return next();
                }, nested.routes()).use("/bar", (ctx, next) => {
                    ctx.foo = "foo";
                    ctx.bar = "bar";
                    return next();
                }, nested.routes());
                app.use(base.routes());
                Promise.all(["/foo", "/bar"].map((pathname) => request(http.createServer(app.callback())).get(`/api${pathname}/qux/baz`).expect(200))).then((resList) => {
                    for (const res of resList)
                        assert.deepEqual(res.body, { foo: "foo", bar: "bar", baz: "baz" });
                    done();
                }, err => done(err));
            });
        });
        describe("Router#register()", () => {
            it("registers new routes", done => {
                const app = new express();
                const router = express.router();
                assert.strictEqual("register" in router, true);
                assert.strictEqual(typeof router["register"], "function");
                router.register("/", ["GET", "POST"], () => {});
                app.use(router.routes());
                assert.strictEqual(router.stack instanceof Array, true);
                assert.strictEqual(router.stack["length"], 1);
                assert.strictEqual(router.stack[0]["path"], "/");
                done();
            });
        });
        describe("Router#redirect()", () => {
            it("registers redirect routes", done => {
                const app = new express();
                const router = express.router();
                assert.strictEqual("redirect" in router, true);
                assert.strictEqual(typeof router["redirect"] === "function", true);
                router.redirect("/source", "/destination", 302);
                app.use(router.routes());
                assert.strictEqual(router.stack["length"], 1);
                assert.strictEqual(router.stack[0]["path"], "/source");
                done();
            });
            it("redirects using route names", done => {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                router.get("home", "/", () => {});
                router.get("sign-up-form", "/sign-up-form", () => {});
                router.redirect("home", "sign-up-form");
                request(http.createServer(app.callback())).post("/").expect(301).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(res.header["location"], "/sign-up-form");
                    done();
                });
            });
            it("redirects using symbols as route names", done => {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                const homeSymbol = Symbol("home");
                const signUpFormSymbol = Symbol("sign-up-form");
                router.get(homeSymbol, "/", () => {});
                router.get(signUpFormSymbol, "/sign-up-form", () => {});
                router.redirect(homeSymbol, signUpFormSymbol);
                request(http.createServer(app.callback())).post("/").expect(301).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(res.header["location"], "/sign-up-form");
                    done();
                });
            });
            it("redirects to external sites", done => {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                router.redirect("/", "https://www.example.com");
                request(http.createServer(app.callback())).post("/").expect(301).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(res.header["location"], "https://www.example.com");
                    done();
                });
            });
            it("redirects to any external protocol", function (done) {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                router.redirect("/", "my-custom-app-protocol://www.example.com/foo");
                request(http.createServer(app.callback())).post("/").expect(301).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(res.header["location"], "my-custom-app-protocol://www.example.com/foo");
                    done();
                });
            });
        });
        describe("Router#route()", () => {
            it("inherits routes from nested router", () => {
                const subrouter = express.router().get("child", "/hello", ctx => ctx.body = { hello: "world" });
                const router = express.router().use(subrouter.routes());
                assert.strictEqual(router.route("child")["name"], "child");
            });
            it("supports symbols as names", () => {
                const childSymbol = Symbol("child");
                const subrouter = express.router().get(childSymbol, "/hello", ctx => ctx.body = { hello: "world" });
                const router = express.router().use(subrouter.routes());
                assert.strictEqual(router.route(childSymbol)["name"], childSymbol);
            });
            it("returns false if no name matches", () => {
                const router = express.router();
                router.get("books", "/books", ctx => ctx.status = 204);
                router.get(Symbol("Picard"), "/enterprise", ctx => ctx.status = 204);
                assert.strictEqual(router.route("Picard"), false);
                assert.strictEqual(router.route(Symbol("books")), false);
            });
        });
        describe("Router#url()", () => {
            it("generates URL for given route name", done => {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                router.get("books", "/:category/:title", ctx => ctx.status = 204);
                let url = router.url("books", { category: "programming", title: "how to node" }, { encode: encodeURIComponent });
                assert.strictEqual(url, "/programming/how%20to%20node");
                url = router.url("books", "programming", "how to node", { encode: encodeURIComponent });
                assert.strictEqual(url, "/programming/how%20to%20node");
                done();
            });
            it("generates URL for given route name within embedded routers", done => {
                const app = new express();
                const router = express.router({ prefix: "/books" });
                const embeddedRouter = express.router({ prefix: "/chapters" });
                embeddedRouter.get("chapters", "/:chapterName/:pageNumber", ctx => ctx.status = 204);
                router.use(embeddedRouter.routes());
                app.use(router.routes());
                let url = router.url("chapters", { chapterName: "Learning ECMA6", pageNumber: 123 }, { encode: encodeURIComponent });
                assert.strictEqual(url, "/books/chapters/Learning%20ECMA6/123");
                url = router.url("chapters", "Learning ECMA6", 123, { encode: encodeURIComponent });
                assert.strictEqual(url, "/books/chapters/Learning%20ECMA6/123");
                done();
            });
            it("generates URL for given route name within two embedded routers", done => {
                const app = new express();
                const router = express.router({ prefix: "/books" });
                const embeddedRouter = express.router({ prefix: "/chapters" });
                const embeddedRouter2 = express.router({ prefix: "/:chapterName/pages" });
                embeddedRouter2.get("chapters", "/:pageNumber", ctx => ctx.status = 204);
                embeddedRouter.use(embeddedRouter2.routes());
                router.use(embeddedRouter.routes());
                app.use(router.routes());
                const url = router.url("chapters", { chapterName: "Learning ECMA6", pageNumber: 123 }, { encode: encodeURIComponent });
                assert.strictEqual(url, "/books/chapters/Learning%20ECMA6/pages/123");
                done();
            });
            it("generates URL for given route name with params and query params", done => {
                const router = express.router();
                const query = { page: 3, limit: 10 };
                router.get("books", "/books/:category/:id", ctx => ctx.status = 204);
                let url = router.url("books", "programming", 4, { query });
                assert.strictEqual(url, "/books/programming/4?page=3&limit=10");
                url = router.url("books", { category: "programming", id: 4 }, { query });
                assert.strictEqual(url, "/books/programming/4?page=3&limit=10");
                url = router.url("books", { category: "programming", id: 4 }, { query: "page=3&limit=10" });
                assert.strictEqual(url, "/books/programming/4?page=3&limit=10");
                done();
            });
            it("generates URL for given route name without params and query params", done => {
                const router = express.router();
                router.get("books", "/books", ctx => ctx.status = 204);
                let url = router.url("books");
                assert.strictEqual(url, "/books");
                url = router.url("books");
                assert.strictEqual(url, "/books");
                url = router.url("books");
                assert.strictEqual(url, "/books");
                url = router.url("books", {}, { query: { page: 3, limit: 10 } });
                assert.strictEqual(url, "/books?page=3&limit=10");
                url = router.url("books", {}, { query: "page=3&limit=10" });
                assert.strictEqual(url, "/books?page=3&limit=10");
                done();
            });
            it("generates URL for given route name without params and query params", done => {
                const router = express.router();
                router.get("category", "/category", ctx => ctx.status = 204);
                const url = router.url("category", { query: { page: 3, limit: 10 } });
                assert.strictEqual(url, "/category?page=3&limit=10");
                done();
            });
            it("returns an Error if no route is found for name", () => {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                router.get("books", "/books", ctx => ctx.status = 204);
                router.get(Symbol("Picard"), "/enterprise", ctx => ctx.status = 204);
                assert.strictEqual(router.url("Picard") instanceof Error, true);
                assert.strictEqual(router.url(Symbol("books")) instanceof Error, true);
            });
        });
        describe("Router#param()", () => {
            it("runs parameter middleware", done => {
                const app = new express();
                const router = express.router();
                app.use(router.routes());
                router.param("user", (id, ctx, next) => {
                    ctx.user = { name: "alex" };
                    if (!id) return (ctx.status = 404);
                    return next();
                }).get("/users/:user", ctx => ctx.body = ctx.user);
                request(http.createServer(app.callback())).get("/users/3").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual("body" in res, true);
                    assert.strictEqual(res.body["name"], "alex")
                    done();
                });
            });
            it("runs parameter middleware in order of URL appearance", done => {
                const app = new express();
                const router = express.router();
                router.param("user", (id, ctx, next) => {
                    ctx.user = { name: "alex" };
                    if (ctx.ranFirst) ctx.user.ordered = "parameters";
                    if (!id) return (ctx.status = 404);
                    return next();
                }).param("first", (id, ctx, next) => {
                    ctx.ranFirst = !ctx.user;
                    if (!id) return (ctx.status = 404);
                    return next();
                }).get("/:first/users/:user", ctx => ctx.body = ctx.user);
                request(http.createServer(app.use(router.routes()).callback())).get("/first/users/3").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual("body" in res, true);
                    assert.strictEqual(res.body["name"], "alex");
                    assert.strictEqual(res.body["ordered"], "parameters");
                    done();
                });
            });
            it("runs parameter middleware in order of URL appearance even when added in random order", done => {
                const app = new express();
                const router = express.router();
                router.param("a", (id, ctx, next) => {
                    ctx.state.loaded = [id];
                    return next();
                }).param("d", (id, ctx, next) => {
                    ctx.state.loaded.push(id);
                    return next();
                }).param("c", (id, ctx, next) => {
                    ctx.state.loaded.push(id);
                    return next();
                }).param("b", (id, ctx, next) => {
                    ctx.state.loaded.push(id);
                    return next();
                }).get("/:a/:b/:c/:d", (ctx, next) => {
                    ctx.body = ctx.state.loaded;
                });
                request(http.createServer(app.use(router.routes()).callback())).get("/1/2/3/4").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual("body" in res, true);
                    assert.deepStrictEqual(res.body, ["1", "2", "3", "4"]);
                    done();
                });
            });
            it("runs parent parameter middleware for subrouter", done => {
                const app = new express();
                const router = express.router();
                const subrouter = express.router();
                subrouter.get("/:cid", ctx => ctx.body = {
                    id: ctx.params.id,
                    cid: ctx.params.cid
                });
                router.param("id", (id, ctx, next) => {
                    ctx.params.id = "ran";
                    if (!id) return (ctx.status = 404);
                    return next();
                }).use("/:id/children", subrouter.routes());
                request(http.createServer(app.use(router.routes()).callback())).get("/did-not-run/children/2").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual("body" in res, true);
                    assert.strictEqual(res.body["id"], "ran");
                    assert.strictEqual(res.body["cid"], "2");
                    done();
                });
            });
        });
        describe("Router#opts", () => {
            it("responds with 200", done => {
                const app = new express();
                const router = express.router({ strict: true });
                router.get("/info", ctx => ctx.body = "hello");
                request(http.createServer(app.use(router.routes()).callback())).get("/info").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(res.text, "hello");
                    done();
                });
            });
            it("should allow setting a prefix", done => {
                const app = new express();
                const routes = express.router({ prefix: "/things/:thing_id" });
                routes.get("/list", ctx => ctx.body = ctx.params);
                app.use(routes.routes());
                request(http.createServer(app.callback())).get("/things/1/list").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(res.body["thing_id"], "1");
                    done();
                });
            });
            it("responds with 404 when has a trailing slash", done => {
                const app = new express();
                const router = express.router({ strict: true });
                router.get("/info", ctx => ctx.body = "hello");
                request(http.createServer(app.use(router.routes()).callback())).get("/info/").expect(404).end(err => {
                    if (err) return done(err);
                    done();
                });
            });
        });
        describe("use middleware with opts", () => {
            it("responds with 200", done => {
                const app = new express();
                const router = express.router({ strict: true });
                router.get("/info", ctx => ctx.body = "hello");
                request(http.createServer(app.use(router.routes()).callback())).get("/info").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(res.text, "hello");
                    done();
                });
            });
            it("responds with 404 when has a trailing slash", done => {
                const app = new express();
                const router = express.router({ strict: true });
                router.get("/info", ctx => ctx.body = "hello");
                request(http.createServer(app.use(router.routes()).callback())).get("/info/").expect(404).end((err, res) => {
                    if (err) return done(err);
                    done();
                });
            });
        });
        describe("router.routes()", () => {
            it("should return composed middleware", done => {
                const app = new express();
                const router = express.router();
                let middlewareCount = 0;
                const middlewareA = (ctx, next) => {
                    middlewareCount++;
                    return next();
                };
                const middlewareB = (ctx, next) => {
                    middlewareCount++;
                    return next();
                };
                router.use(middlewareA, middlewareB);
                router.get("/users/:id", ctx => {
                    assert.strictEqual("id" in ctx.params, true);
                    ctx.body = { hello: "world" };
                });
                const routerMiddleware = router.routes();
                assert.strictEqual(typeof routerMiddleware, "function");
                request(http.createServer(app.use(routerMiddleware).callback())).get("/users/1").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.strictEqual(typeof res.body, "object");
                    assert.strictEqual(res.body["hello"], "world");
                    assert.strictEqual(middlewareCount, 2);
                    done();
                });
            });
            it("places a `_matchedRoute` value on context", done => {
                const app = new express();
                const router = express.router();
                const middleware = (ctx, next) => {
                    next();
                    assert.strictEqual(ctx._matchedRoute, "/users/:id");
                };
                router.use(middleware);
                router.get("/users/:id", ctx => {
                    assert.strictEqual(ctx._matchedRoute, "/users/:id");
                    assert.strictEqual("id" in ctx.params, true);
                    ctx.body = { hello: "world" };
                });
                const routerMiddleware = router.routes();
                request(http.createServer(app.use(routerMiddleware).callback())).get("/users/1").expect(200).end(err => {
                    if (err) return done(err);
                    done();
                });
            });
            it("places a `_matchedRouteName` value on the context for a named route", done => {
                const app = new express();
                const router = express.router();
                router.get("users#show", "/users/:id", ctx => {
                    assert.strictEqual(ctx._matchedRouteName, "users#show");
                    ctx.status = 200;
                });
                request(http.createServer(app.use(router.routes()).callback())).get("/users/1").expect(200).end(err => {
                    if (err) return done(err);
                    done();
                });
            });
            it("does not place a `_matchedRouteName` value on the context for unnamed routes", done => {
                const app = new express();
                const router = express.router();
                router.get("/users/:id", ctx => {
                    assert.strictEqual("_matchedRouteName" in ctx, false);
                    ctx.status = 200;
                });
                request(http.createServer(app.use(router.routes()).callback())).get("/users/1").expect(200).end(err => {
                    if (err) return done(err);
                    done();
                });
            });
            it("places a `routerPath` value on the context for current route", done => {
                const app = new express();
                const router = express.router();
                router.get("/users/:id", ctx => {
                    assert.strictEqual(ctx.routerPath, "/users/:id");
                    ctx.status = 200;
                });
                request(http.createServer(app.use(router.routes()).callback())).get("/users/1").expect(200).end(err => {
                    if (err) return done(err);
                    done();
                });
            });
            it("places a `_matchedRoute` value on the context for current route", function (done) {
                const app = new express();
                const router = express.router();
                router.get("/users/list", ctx => {
                    assert.strictEqual(ctx._matchedRoute, "/users/list");
                    ctx.status = 200;
                });
                router.get("/users/:id", ctx => {
                    assert.strictEqual(ctx._matchedRoute, "/users/:id");
                    ctx.status = 200;
                });
                request(http.createServer(app.use(router.routes()).callback())).get("/users/list").expect(200).end(err => {
                    if (err) return done(err);
                    done();
                });
            });
        });
        describe("If no HEAD method, default to GET", () => {
            it("should default to GET", done => {
                const app = new express();
                const router = express.router();
                router.get("/users/:id", ctx => {
                    assert.strictEqual("id" in ctx.params, true);
                    ctx.body = "hello";
                });
                request(http.createServer(app.use(router.routes()).callback())).head("/users/1").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.deepStrictEqual(res.body, {});
                    done();
                });
            });
            it("should work with middleware", done => {
                const app = new express();
                const router = express.router();
                router.get("/users/:id", ctx => {
                    assert.strictEqual("id" in ctx.params, true);
                    ctx.body = "hello";
                });
                request(http.createServer(app.use(router.routes()).callback())).head("/users/1").expect(200).end((err, res) => {
                    if (err) return done(err);
                    assert.deepStrictEqual(res.body, {});
                    done();
                });
            });
        });
        describe("Router#prefix", () => {
            it("should set opts.prefix", () => {
                const router = express.router();
                assert.strictEqual("prefix" in router.opts, false);
                router.prefix("/things/:thing_id");
                assert.strictEqual(router.opts.prefix, "/things/:thing_id");
            });
            it("should prefix existing routes", () => {
                const router = express.router();
                router.get("/users/:id", ctx => ctx.body = "test");
                router.prefix("/things/:thing_id");
                const route = router.stack[0];
                assert.strictEqual(route.path, "/things/:thing_id/users/:id");
                assert.strictEqual(route.paramNames["length"], 2);
                assert.strictEqual(route.paramNames[0]["name"], "thing_id");
                assert.strictEqual(route.paramNames[1]["name"], "id");
            });
            it("populates ctx.params correctly for router prefix (including use)", done => {
                const app = new express();
                const router = express.router({ prefix: "/:category" });
                app.use(router.routes());
                router.use((ctx, next) => {
                    assert.strictEqual("params" in ctx, true);
                    assert.strictEqual(typeof ctx.params, "object");
                    assert.strictEqual(ctx.params["category"], "cats");
                    return next();
                }).get("/suffixHere", ctx => {
                    assert.strictEqual("params" in ctx, true);
                    assert.strictEqual(typeof ctx.params, "object");
                    assert.strictEqual(ctx.params["category"], "cats");
                    ctx.status = 204;
                });
                request(http.createServer(app.callback())).get("/cats/suffixHere").expect(204).end(err => {
                    if (err) return done(err);
                    done();
                });
            });
            it("populates ctx.params correctly for more complex router prefix (including use)", done => {
                const app = new express();
                const router = express.router({ prefix: "/:category/:color" });
                app.use(router.routes());
                router.use((ctx, next) => {
                    assert.strictEqual("params" in ctx, true);
                    assert.strictEqual(typeof ctx.params, "object");
                    assert.strictEqual(ctx.params["category"], "cats");
                    assert.strictEqual(ctx.params["color"], "gray");
                    return next();
                }).get("/:active/suffixHere", ctx => {
                    assert.strictEqual("params" in ctx, true);
                    assert.strictEqual(typeof ctx.params, "object");
                    assert.strictEqual(ctx.params["category"], "cats");
                    assert.strictEqual(ctx.params["color"], "gray");
                    assert.strictEqual(ctx.params["active"], "true");
                    ctx.status = 204;
                });
                request(http.createServer(app.callback())).get("/cats/gray/true/suffixHere").expect(204).end((err, res) => {
                    if (err) return done(err);
                    done();
                });
            });
            it("populates ctx.params correctly for dynamic and static prefix (including async use)", done => {
                const app = new express();
                const router = express.router({ prefix: "/:ping/pong" });
                app.use(router.routes());
                router.use(async (ctx, next) => {
                    assert.strictEqual("params" in ctx, true);
                    assert.strictEqual(typeof ctx.params, "object");
                    assert.strictEqual(ctx.params["ping"], "pingKey");
                    await next();
                }).get("/", ctx => {
                    assert.strictEqual("params" in ctx, true);
                    assert.strictEqual(typeof ctx.params, "object");
                    assert.strictEqual(ctx.params["ping"], "pingKey");
                    ctx.body = ctx.params;
                });
                request(http.createServer(app.callback())).get("/pingKey/pong").expect(200, /{"ping":"pingKey"}/).end(err => {
                    if (err) return done(err);
                    done();
                });
            });
            it("populates ctx.params correctly for static prefix", done => {
                const app = new express();
                const router = express.router({ prefix: "/all" });
                app.use(router.routes());
                router.use((ctx, next) => {
                    assert.strictEqual("params" in ctx, true);
                    assert.strictEqual(typeof ctx.params, "object");
                    assert.deepStrictEqual(ctx.params, {});
                    return next();
                }).get("/:active/suffixHere", ctx => {
                    assert.strictEqual("params" in ctx, true);
                    assert.strictEqual(typeof ctx.params, "object");
                    assert.strictEqual(ctx.params["active"], "true");
                    ctx.status = 204;
                });
                request(http.createServer(app.callback())).get("/all/true/suffixHere").expect(204).end(err => {
                    if (err) return done(err);
                    done();
                });
            });
            describe("when used with .use(fn)", () => {
                it("does not set params.0 to the matched path", done => {
                    const app = new express();
                    const router = express.router();
                    router.use((ctx, next) => next());
                    router.get("/foo/:id", ctx => ctx.body = ctx.params);
                    router.prefix("/things");
                    app.use(router.routes());
                    request(http.createServer(app.callback())).get("/things/foo/108").expect(200).end((err, res) => {
                        if (err) return done(err);
                        assert.strictEqual(res.body["id"], "108");
                        assert.strictEqual("0" in res.body, false);
                        done();
                    });
                });
            });
            describe("with trailing slash", testPrefix("/admin/"));
            describe("without trailing slash", testPrefix("/admin"));
            function testPrefix(prefix) {
                return function () {
                    let server, middlewareCount = 0;
                    before(() => {
                        const app = new express();
                        const router = express.router();
                        router.use((ctx, next) => {
                            middlewareCount++;
                            ctx.thing = "worked";
                            return next();
                        });
                        router.get("/", ctx => {
                            middlewareCount++;
                            ctx.body = { name: ctx.thing };
                        });
                        router.prefix(prefix);
                        server = http.createServer(app.use(router.routes()).callback());
                    });
                    after(() => server.close());
                    beforeEach(() => middlewareCount = 0);
                    it("should support root level router middleware", done => {
                        request(server).get(prefix).expect(200).end((err, res) => {
                            if (err) return done(err);
                            assert.strictEqual(middlewareCount, 2)
                            assert.strictEqual(typeof res.body, "object");
                            assert.strictEqual(res.body["name"], "worked");
                            done();
                        });
                    });
                    it("should support requests with a trailing path slash", done => {
                        request(server).get("/admin/").expect(200).end((err, res) => {
                            if (err) return done(err);
                            assert.strictEqual(middlewareCount, 2)
                            assert.strictEqual(typeof res.body, "object");
                            assert.strictEqual(res.body["name"], "worked");
                            done();
                        });
                    });
                    it("should support requests without a trailing path slash", done => {
                        request(server).get("/admin").expect(200).end((err, res) => {
                            if (err) return done(err);
                            assert.strictEqual(middlewareCount, 2)
                            assert.strictEqual(typeof res.body, "object");
                            assert.strictEqual(res.body["name"], "worked");
                            done();
                        });
                    });
                };
            }
            it("prefix and '/' route behavior", done => {
                const app = new express();
                const router = express.router({ strict: false, prefix: "/foo" });
                const strictRouter = express.router({ strict: true, prefix: "/bar" });
                router.get("/", ctx => ctx.body = '');
                strictRouter.get("/", ctx => ctx.body = '');
                app.use(router.routes());
                app.use(strictRouter.routes());
                const server = http.createServer(app.callback());
                request(server).get("/foo").expect(200).end(err => {
                    if (err) return done(err);
                    request(server).get("/foo/").expect(200).end(err => {
                        if (err) return done(err);
                        request(server).get("/bar").expect(404).end(err => {
                            if (err) return done(err);
                            request(server).get("/bar/").expect(200).end(err => {
                                if (err) return done(err);
                                done();
                            });
                        });
                    });
                });
            });
        });
        describe("Support host", () => {
            it("should support host match", done => {
                const app = new express();
                const router = express.router({ host: "test.domain" });
                router.get("/", ctx => ctx.body = { url: "/" });
                app.use(router.routes());
                const server = http.createServer(app.callback());
                request(server).get("/").set("Host", "test.domain").expect(200).end((err, res) => {
                    if (err) return done(err);
                    request(server).get("/").set("Host", "a.domain").expect(404).end((err, res) => {
                        if (err) return done(err);
                        done();
                    });
                });
            });
            it("should support host match regexp", done => {
                const app = new express();
                const router = express.router({ host: /^(.*\.)?test\.domain/ });
                router.get("/", (ctx) => ctx.body = { url: "/" });
                app.use(router.routes());
                const server = http.createServer(app.callback());
                request(server).get("/").set("Host", "test.domain").expect(200).end((err, res) => {
                    if (err) return done(err);
                    request(server).get("/").set("Host", "www.test.domain").expect(200).end((err, res) => {
                        if (err) return done(err);
                        request(server).get("/").set("Host", "any.sub.test.domain").expect(200).end((err, res) => {
                            if (err) return done(err);
                            request(server).get("/").set("Host", "sub.anytest.domain").expect(404).end((err, res) => {
                                if (err) return done(err);
                                done();
                            });
                        });
                    });
                });
            });
        });
    });
    describe("app compression test", () => {
        // https://github.com/koajs/compress/commit/4457745
        const buffer = crypto.randomBytes(1024), string = buffer.toString("hex");
        function sendString(ctx, next) {
            ctx.body = string;
        }
        function sendBuffer(ctx, next) {
            ctx.compress = true;
            ctx.body = buffer;
        }
        let server
        afterEach(() => server && server.close());
        it("should compress strings", async() => {
            const app = new express();
            app.use(express.compression());
            app.use(sendString);
            server = app.listen();
            const res = await request(server).get("/").expect(200);
            assert.strictEqual(res.headers["transfer-encoding"], "chunked");
            assert.strictEqual(res.headers.vary, "Accept-Encoding");
            assert.strictEqual("content-length" in res.headers, false);
            assert.strictEqual(res.text, string);
        });
        it("should not compress strings below threshold", async () => {
            const app = new express();
            app.use(express.compression({ threshold: "1mb" }));
            app.use(sendString);
            server = app.listen();
            const res = await request(server).get("/").expect(200);
            assert.strictEqual(res.headers["content-length"], "2048");
            assert.strictEqual(res.headers.vary, "Accept-Encoding");
            assert.strictEqual("content-encoding" in res.headers, false);
            assert.strictEqual("transfer-encoding" in res.headers, false);
            assert.strictEqual(res.text, string);
        });
        it("should compress JSON body", async () => {
            const app = new express();
            const jsonBody = { status: 200, message: "ok", data: string };
            app.use(express.compression());
            app.use((ctx, next) => ctx.body = jsonBody);
            server = app.listen();
            const res = await request(server).get("/").expect(200);
            assert.strictEqual(res.headers["transfer-encoding"], "chunked");
            assert.strictEqual(res.headers.vary, "Accept-Encoding");
            assert.strictEqual("content-length" in res.headers, false);
            assert.strictEqual(res.text, JSON.stringify(jsonBody));
        });
        it("should not compress JSON body below threshold", async () => {
            const app = new express();
            const jsonBody = { status: 200, message: "ok" }
            app.use(express.compression());
            app.use((ctx, next) => ctx.body = jsonBody);
            server = app.listen();
            const res = await request(server).get("/").expect(200);
            assert.strictEqual(res.headers.vary, "Accept-Encoding");
            assert.strictEqual("content-encoding" in res.headers, false);
            assert.strictEqual("transfer-encoding" in res.headers, false);
            assert.strictEqual(res.text, JSON.stringify(jsonBody));
        });
        it("should compress buffers", async () => {
            const app = new express();
            app.use(express.compression());
            app.use(sendBuffer);
            server = app.listen();
            const res = await request(server).get("/").expect(200);
            assert.strictEqual(res.headers["transfer-encoding"], "chunked");
            assert.strictEqual(res.headers.vary, "Accept-Encoding");
            assert.strictEqual("content-length" in res.headers, false);
        });
        it("should compress streams", async () => {
            const app = new express();
            app.use(express.compression());
            app.use((ctx, next) => {
                ctx.type = "application/javascript";
                ctx.body = fs.createReadStream(path.resolve(__filename));
            });
            server = app.listen();
            const res = await request(server).get("/").expect(200);
            assert.strictEqual(res.headers["transfer-encoding"], "chunked");
            assert.strictEqual(res.headers.vary, "Accept-Encoding");
            assert.strictEqual("content-length" in res.headers, false);
        });
        it("should compress when ctx.compress === true", async () => {
            const app = new express();
            app.use(express.compression());
            app.use(sendBuffer);
            server = app.listen();
            const res = await request(server).get("/").expect(200);
            assert.strictEqual(res.headers["transfer-encoding"], "chunked");
            assert.strictEqual(res.headers.vary, "Accept-Encoding");
            assert.strictEqual("content-length" in res.headers, false);
        });
        it("should not compress when ctx.compress === false", async () => {
            const app = new express();
            app.use(express.compression());
            app.use((ctx, next) => {
                ctx.compress = false;
                ctx.body = buffer;
            });
            server = app.listen();
            const res = await request(server).get("/").expect(200);
            assert.strictEqual(res.headers["content-length"], "1024");
            assert.strictEqual(res.headers.vary, "Accept-Encoding");
            assert.strictEqual("content-encoding" in res.headers, false);
            assert.strictEqual("transfer-encoding" in res.headers, false);
        });
        it("should not compress HEAD requests", async () => {
            const app = new express();
            app.use(express.compression());
            app.use(sendString);
            server = app.listen();
            const res = await request(server).head("/");
            assert.strictEqual("content-encoding" in res.headers, false);
        });
        it("should not crash even if accept-encoding: sdch", () => {
            const app = new express();
            app.use(express.compression());
            app.use(sendBuffer);
            server = app.listen();
            return request(server).get("/").set("Accept-Encoding", "sdch, gzip, deflate").expect(200);
        });
        it("should not compress if no accept-encoding is sent (with the default)", async () => {
            const app = new express()
            app.use(express.compression({ threshold: 0 }));
            app.use((ctx) => {
                ctx.type = "text";
                ctx.body = buffer;
            });
            server = app.listen();
            const res = await request(server).get("/").set("Accept-Encoding", '');
            assert.strictEqual("content-encoding" in res.headers, false);
            assert.strictEqual("transfer-encoding" in res.headers, false);
            assert.strictEqual(res.headers["content-length"], "1024");
            assert.strictEqual(res.headers.vary, "Accept-Encoding");
        });
        it("should be gzip if no accept-encoding is sent (with the standard default)", async () => {
            const app = new express();
            app.use(express.compression({ threshold: 0, defaultEncoding: "*" }));
            app.use((ctx) => {
                ctx.type = "text";
                ctx.body = buffer;
            });
            server = app.listen();
            const res = await request(server).get("/").set("Accept-Encoding", '');
            assert.strictEqual(res.headers["content-encoding"], "gzip");
            assert.strictEqual(res.headers.vary, "Accept-Encoding");
        });
        it("should not crash if a type does not pass the filter", () => {
            const app = new express();
            app.use(express.compression())
            app.use((ctx) => {
                ctx.type = "image/png";
                ctx.body = Buffer.alloc(2048);
            });
            server = app.listen();
            return request(server).get("/").expect(200);
        });
        it("should not compress when transfer-encoding is already set", () => {
            const app = new express();
            app.use(express.compression({ threshold: 0 }));
            app.use((ctx) => {
                ctx.set("Content-Encoding", "identity");
                ctx.type = "text";
                ctx.body = "asdf";
            });
            server = app.listen();
            return request(server).get("/").expect("asdf");
        });
        describe("cache-control test", () => {
            ["no-transform", "public, no-transform", "no-transform, private", "no-transform , max-age=1000", "max-age=1000 , no-transform"].forEach(headerValue => {
                it(`should skip Cache-Control: ${headerValue}`, async () => {
                    const app = new express();
                    app.use(express.compression());
                    app.use((ctx, next) => {
                        ctx.set("Cache-Control", headerValue);
                        next();
                    });
                    app.use(sendString);
                    server = app.listen();
                    const res = await request(server).get("/").expect(200);
                    assert.strictEqual(res.headers["content-length"], "2048");
                    assert.strictEqual(res.headers.vary, "Accept-Encoding");
                    assert.strictEqual("content-encoding" in res.headers, false);
                    assert.strictEqual("transfer-encoding" in res.headers, false);
                    assert.strictEqual(res.text, string);
                });
            });
            ["not-no-transform", "public", "no-transform-thingy"].forEach(headerValue => {
                it(`should not skip Cache-Control: ${headerValue}`, async () => {
                    const app = new express();
                    app.use(express.compression());
                    app.use((ctx, next) => {
                        ctx.set("Cache-Control", headerValue);
                        next();
                    });
                    app.use(sendString);
                    server = app.listen();
                    const res = await request(server).get("/").expect(200);
                    assert.strictEqual(res.headers["transfer-encoding"], "chunked");
                    assert.strictEqual(res.headers.vary, "Accept-Encoding");
                    assert.strictEqual("content-length" in res.headers, false);
                    assert.strictEqual(res.text, string);
                });
            });
        });
        it("accept-encoding: deflate", async () => {
            const app = new express();
            app.use(express.compression());
            app.use(sendBuffer);
            server = app.listen();
            const res = await request(server).get("/").set("Accept-Encoding", "deflate").expect(200);
            assert.strictEqual(res.headers.vary, "Accept-Encoding");
            assert.strictEqual(res.headers["content-encoding"], "deflate");
        });
        it("accept-encoding: gzip", async () => {
            const app = new express();
            app.use(express.compression());
            app.use(sendBuffer);
            server = app.listen();
            const res = await request(server).get("/").set("Accept-Encoding", "gzip, deflate").expect(200);
            assert.strictEqual(res.headers.vary, "Accept-Encoding");
            assert.strictEqual(res.headers["content-encoding"], "gzip");
        });
        if (process.versions.brotli) {
            it("accept-encoding: br", async () => {
                const app = new express();
                app.use(express.compression());
                app.use(sendBuffer);
                server = app.listen();
                const res = await request(server).get("/").set("Accept-Encoding", "br").expect(200);
                assert.strictEqual(res.headers.vary, "Accept-Encoding");
                assert.strictEqual(res.headers["content-encoding"], "br");
            });
        }
        it("accept-encoding: br (banned, should be gzip)", async () => {
            const app = new express();
            app.use(express.compression({ br: false }));
            app.use(sendBuffer);
            server = app.listen();
            const res = await request(server).get("/").set("Accept-Encoding", "gzip, deflate, br").expect(200);
            assert.strictEqual(res.headers.vary, "Accept-Encoding");
            assert.strictEqual(res.headers["content-encoding"], "gzip");
        });
        describe("accept-encodings test", () => {
            const fixtures = [
                { acceptEncoding: "gzip", preferredEncoding: "gzip" },
                { acceptEncoding: "gzip, identity", preferredEncoding: "gzip" },
                { acceptEncoding: "br, gzip", preferredEncoding: "br" },
                { acceptEncoding: "identity", preferredEncoding: undefined }
            ];
            fixtures.forEach(({ acceptEncoding, preferredEncoding }) => {
                it(`should return ${preferredEncoding} with ${acceptEncoding}`, async () => {
                    const app = new express();
                    app.use(express.compression());
                    app.use(async (ctx) => ctx.body = await crypto.randomBytes(2048).toString("base64"));
                    server = app.listen();
                    const res = await request(server).get("/").set("Accept-Encoding", acceptEncoding).expect(200);
                    assert.strictEqual(res.headers["content-encoding"], preferredEncoding);
                });
            });
        });
        describe("subsequent requests test", () => {
            it("accept-encoding: 'gzip, deflate, br', then 'gzip'", async () => {
                const app = new express();
                app.use(express.compression());
                app.use(async (ctx) => ctx.body = await crypto.randomBytes(2048).toString("base64"));
                server = app.listen();
                const res1 = await request(server).get("/").set("Accept-Encoding", "gzip, deflate, br").expect(200);
                assert.strictEqual(res1.headers["content-encoding"], "br");
                const res2 = await request(server).get("/").set("Accept-Encoding", "gzip").expect(200);
                assert.strictEqual(res2.headers["content-encoding"], "gzip");
            });
        });
    });
    describe("app send test", () => {
        const { send } = require("../plugins/express/serve.js");
        describe("with no .root", () => {
            describe("when the path is absolute", () => {
                it("should 404", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, path.join(__dirname, "/fixtures/hello.txt"));
                    })
                    request(app.callback()).get("/").expect(404, done);
                });
                it("should throw 404 error", done => {
                    const app = new express();
                    let error;
                    app.use(async (ctx) => {
                        try {
                            await send(ctx, path.join(__dirname, "/fixtures/hello.txt"))
                        } catch (err) {
                            error = err
                        }
                    });
                    request(app.callback()).get("/").expect(404, () => {
                        assert.equal(error.status, 404)
                        done()
                    });
                });
            });
            describe("when the path is relative", () => {
                it("should 200", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "test/fixtures/hello.txt");
                    });
                    request(app.callback()).get("/").expect(200).expect("world", done);
                });
            });
            describe("when the path contains ..", () => {
                it("should 403", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "/../fixtures/hello.txt");
                    });
                    request(app.callback()).get("/").expect(403, done);
                });
            });
        });
        describe("with .root", () => {
            describe("when the path is absolute", () => {
                it("should 404", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        const opts = { root: "test/fixtures" };
                        await send(ctx, path.join(__dirname, "/fixtures/hello.txt"), opts);
                    });
                    request(app.callback()).get("/").expect(404, done);
                });
            });
            describe("when the path is relative and exists", () => {
                it("should serve the file", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        const opts = { root: "test/fixtures" };
                        await send(ctx, "hello.txt", opts);
                    });
                    request(app.callback()).get("/").expect(200).expect("world", done);
                });
            });
            describe("when the path is relative and does not exist", () => {
                it("should 404", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        const opts = { root: "test/fixtures" };
                        await send(ctx, "something", opts);
                    });
                    request(app.callback()).get("/").expect(404, done);
                });
            });
            describe("when the path resolves above the root", () => {
                it("should 403", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        const opts = { root: "test/fixtures" };
                        await send(ctx, "../../package.json", opts);
                    });
                    request(app.callback()).get("/").expect(403, done);
                });
            });
            describe("when the path resolves within root", () => {
                it("should 403", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        const opts = { root: "test/fixtures" };
                        await send(ctx, "../../test/fixtures/world/index.html", opts);
                    });
                    request(app.callback()).get("/").expect(403, done);
                });
            });
        });
        describe("with .index", () => {
            describe("when the index file is present", () => {
                it("should serve it", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        const opts = { root: "test", index: "index.html" };
                        await send(ctx, "fixtures/world/", opts);
                    });
                    request(app.callback()).get("/").expect(200).expect("html index", done);
                });
                it("should serve it", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        const opts = { root: "test/fixtures/world", index: "index.html" };
                        await send(ctx, ctx.path, opts);
                    });
                    request(app.callback()).get("/").expect(200).expect("html index", done);
                });
            });
        });
        describe("when path is not a file", () => {
            it("should 404", done => {
                const app = new express();
                app.use(async (ctx) => {
                    await send(ctx, "/test");
                });
                request(app.callback()).get("/").expect(404, done);
            });
            it("should return undefined if format is set to false", done => {
                const app = new express();
                app.use(async (ctx) => {
                    const sent = await send(ctx, "/test", { format: false });
                    assert.equal(sent, undefined);
                });
                request(app.callback()).get("/").expect(404, done);
            });
        });
        describe("when path is a directory", () => {
            it("should 404", done => {
                const app = new express();
                app.use(async (ctx) => {
                    await send(ctx, "/test/fixtures");
                });
                request(app.callback()).get("/").expect(404, done);
            });
        });
        describe("when path does not finish with slash and format is disabled", () => {
            it("should 404", done => {
                const app = new express();
                app.use(async (ctx) => {
                    const opts = { root: "test", index: "index.html", format: false };
                    await send(ctx, "fixtures/world", opts);
                });
                request(app.callback()).get("/world").expect(404, done);
            });
            it("should 404", function (done) {
                const app = new express();
                app.use(async (ctx) => {
                    const opts = { root: "test", index: "index.html", format: false };
                    await send(ctx, "fixtures/world", opts);
                });
                request(app.callback()).get("/world").expect(404, done);
            });
        });
        describe("when path does not finish with slash and format is enabled", () => {
            it("should 200", done => {
                const app = new express();
                app.use(async (ctx) => {
                    const opts = { root: "test", index: "index.html" };
                    await send(ctx, "fixtures/world", opts);
                });
                request(app.callback()).get("/").expect("content-type", "text/html; charset=utf-8").
                    expect("content-length", "10").expect(200, done);
            });
            it("should 404 if no index", done => {
                const app = new express();
                app.use(async (ctx) => {
                    const opts = { root: "test" };
                    await send(ctx, "fixtures/world", opts);
                });
                request(app.callback()).get("/").expect(404, done);
            });
        });
        describe("when path is malformed", () => {
            it("should 400", done => {
                const app = new express();
                app.use(async (ctx) => {
                    await send(ctx, "/%");
                });
                request(app.callback()).get("/").expect(400, done);
            });
        });
        describe("when path is a file", () => {
            it("should return the path", done => {
                const app = new express();
                app.use(async (ctx) => {
                    const p = "/test/fixtures/user.json";
                    const sent = await send(ctx, p);
                    assert.equal(sent, path.join(__dirname, "/fixtures/user.json"));
                });
                request(app.callback()).get("/").expect(200, done);
            });
            describe("or .gz version when requested and if possible", () => {
                it("should return path", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "/test/fixtures/gzip.json");
                    });
                    request(app.callback()).get("/").set("Accept-Encoding", "deflate, identity").
                        expect("Content-Length", "18").expect('{ "name": "tobi" }').expect(200, done);
                });
                it("should return .gz path (gzip option defaults to true)", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "/test/fixtures/gzip.json");
                    });
                    request(app.callback()).get("/").set("Accept-Encoding", "gzip, deflate, identity").
                        expect("Content-Length", "48").expect('{ "name": "tobi" }').expect(200, done);
                });
                it("should return .gz path when gzip option is turned on", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "/test/fixtures/gzip.json", { gzip: true });
                    });
                    request(app.callback()).get("/").set("Accept-Encoding", "gzip, deflate, identity").
                        expect("Content-Length", "48").expect('{ "name": "tobi" }').expect(200, done);
                });
                it("should not return .gz path when gzip option is false", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "/test/fixtures/gzip.json", { gzip: false });
                    });
                    request(app.callback()).get("/").set("Accept-Encoding", "gzip, deflate, identity").
                        expect("Content-Length", "18").expect('{ "name": "tobi" }').expect(200, done);
                });
            });
            describe("or .br version when requested and if possible", () => {
                function parser(res, cb) {
                    const chunks = []
                    res.on("data", chunk => chunks.push(chunk))
                    res.on("end", () => {
                        zlib.brotliDecompress(Buffer.concat(chunks), (err, data) => {
                            cb(err, data?.toString());
                        });
                    });
                }
                it("should return path", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "/test/fixtures/gzip.json");
                    });
                    request(app.callback()).get("/").set("Accept-Encoding", "deflate, identity")
                        .expect("Content-Length", "18").expect('{ "name": "tobi" }').expect(200, done);
                });
                it("should return .br path (brotli option defaults to true)", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "/test/fixtures/gzip.json");
                    });
                    request(app.callback()).get("/").parse(parser).set("Accept-Encoding", "br, deflate, identity").
                        expect("Content-Length", "22").expect(200).then(({ body }) => {
                            assert.deepStrictEqual(body, '{ "name": "tobi" }');
                            done();
                        });
                });
                it("should return .br path when brotli option is turned on", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "/test/fixtures/gzip.json", { brotli: true });
                    });
                    request(app.callback()).get("/").parse(parser).set("Accept-Encoding", "br, deflate, identity").
                        expect("Content-Length", "22").expect(200).then(({ body }) => {
                            assert.deepStrictEqual(body, '{ "name": "tobi" }');
                            done();
                        });
                });
                it("should not return .br path when brotli option is false", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "/test/fixtures/gzip.json", { brotli: false });
                    });
                    request(app.callback()).get("/").set("Accept-Encoding", "br, deflate, identity").
                        expect("Content-Length", "18").expect('{ "name": "tobi" }').expect(200, done);
                });
                it("should return .gz path when brotli option is turned off", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "/test/fixtures/gzip.json", { brotli: false });
                    });
                    request(app.callback()).get("/").set("Accept-Encoding", "br, gzip, deflate, identity").
                        expect("Content-Length", "48").expect('{ "name": "tobi" }').expect(200, done);
                });
            });
            describe("and max age is specified", () => {
                it("should set max-age in seconds", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        const p = "/test/fixtures/user.json";
                        const sent = await send(ctx, p, { maxAge: 5000 });
                        assert.strictEqual(sent, path.join(__dirname, "/fixtures/user.json"));
                    });
                    request(app.callback()).get("/").expect("Cache-Control", "max-age=5").expect(200, done);
                });
                it("should truncate fractional values for max-age", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        const p = "/test/fixtures/user.json";
                        const sent = await send(ctx, p, { maxAge: 1234 });
                        assert.strictEqual(sent, path.join(__dirname, "/fixtures/user.json"));
                    });
                    request(app.callback()).get("/").expect("Cache-Control", "max-age=1").expect(200, done);
                });
            });
            describe("and immutable is specified", () => {
                it("should set the immutable directive", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        const p = "/test/fixtures/user.json";
                        const sent = await send(ctx, p, { immutable: true, maxAge: 31536000000 });
                        assert.strictEqual(sent, path.join(__dirname, "/fixtures/user.json"));
                    });
                    request(app.callback()).get("/").expect("Cache-Control", "max-age=31536000,immutable").expect(200, done);
                });
            });
        });
        describe(".immutable option", () => {
            describe("when trying to get a non-existent file", () => {
                it("should not set the Cache-Control header", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "test/fixtures/does-not-exist.json", { immutable: true });
                    });
                    request(app.callback()).get("/").expect((res) => {
                        assert.strictEqual("cache-control" in res.header, false);
                    }).expect(404, done);
                });
            });
        });
        describe(".hidden option", () => {
            describe("when trying to get a hidden file", () => {
                it("should 404", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "test/fixtures/.hidden");
                    });
                    request(app.callback()).get("/").expect(404, done);
                });
            });
            describe("when trying to get a file from a hidden directory", () => {
                it("should 404", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "test/fixtures/.private/id_rsa.txt");
                    });
                    request(app.callback()).get("/").expect(404, done);
                });
            });
            describe("when trying to get a hidden file and .hidden check is turned off", () => {
                it("should 200", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "test/fixtures/.hidden", { hidden: true });
                    });
                    request(app.callback()).get("/").expect(200, done);
                })
            })
        })
        describe(".extensions option", () => {
            describe("when trying to get a file without extension with no .extensions sufficed", () => {
                it("should 404", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "test/fixtures/hello");
                    });
                    request(app.callback()).get("/").expect(404, done);
                });
            });
            describe("when trying to get a file without extension with no matching .extensions", () => {
                it("should 404", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "test/fixtures/hello", { extensions: ["json", "htm", "html"] });
                    });
                    request(app.callback()).get("/").expect(404, done);
                });
            });
            describe("when trying to get a file without extension with non array .extensions", () => {
                it("should 404", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "test/fixtures/hello", { extensions: {} });
                    });
                    request(app.callback()).get("/").expect(404, done);
                });
            });
            describe("when trying to get a file without extension with non string array .extensions", () => {
                it("throws if extensions is not array of strings", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "test/fixtures/hello", { extensions: [2, {}, []] });
                    });
                    request(app.callback()).get("/").expect(500).end(done);
                });
            });
            describe("when trying to get a file without extension with matching .extensions sufficed first matched should be sent", () => {
                it("should 200 and application/json", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "test/fixtures/user", { extensions: ["html", "json", "txt"] });
                    });
                    request(app.callback()).get("/").expect(200).expect("Content-Type", /application\/json/).end(done);
                });
            });
            describe("when trying to get a file without extension with matching .extensions sufficed", () => {
                it("should 200", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "test/fixtures/hello", { extensions: ["txt"] });
                    });
                    request(app.callback()).get("/").expect(200, done);
                });
            });
            describe("when trying to get a file without extension with matching doted .extensions sufficed", () => {
                it("should 200", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "test/fixtures/hello", { extensions: [".txt"] });
                    });
                    request(app.callback()).get("/").expect(200, done);
                });
            });
            describe("when trying to get a file without extension with matching .extensions sufficed with other dots in path", () => {
                it("should 200", done => {
                    const app = new express();
                    app.use(async (ctx) => {
                        await send(ctx, "test/fixtures/some.path/index", { extensions: ["json"] });
                    });
                    request(app.callback()).get("/").expect(200, done);
                });
            });
        });
        it("should set the Content-Type", done => {
            const app = new express();
            app.use(async (ctx) => {
                await send(ctx, "/test/fixtures/user.json");
            });
            request(app.callback()).get("/").expect("Content-Type", /application\/json/).end(done);
        });
        it("should set the Content-Length", done => {
            const app = new express();
            app.use(async (ctx) => {
                await send(ctx, "/test/fixtures/user.json");
            });
            request(app.callback()).get("/").expect("Content-Length", "18").end(done);
        });
        it("should set the Content-Type", done => {
            const app = new express();
            const testFilePath = path.normalize("/test/fixtures/world/index.html");
            app.use(async (ctx) => {
                ctx.type = "text/plain";
                await send(ctx, testFilePath);
            });
            request(app.callback()).get("/").expect("Content-Type", /text\/plain/).end(done);
        });
        it("should set Last-Modified", done => {
            const app = new express();
            app.use(async (ctx) => {
                await send(ctx, "/test/fixtures/user.json");
            });
            request(app.callback()).get("/").expect("Last-Modified", /GMT/).end(done);
        });
        describe("with setHeaders", () => {
            it("throws if setHeaders is not a function", done => {
                const app = new express();
                app.use(async (ctx) => {
                    await send(ctx, "/test/fixtures/user.json", { setHeaders: "foo" });
                });
                request(app.callback()).get("/").expect(500).end(done);
            });
            it("should not edit already set headers", done => {
                const app = new express();
                const testFilePath = "/test/fixtures/user.json";
                const normalizedTestFilePath = path.normalize(testFilePath);
                app.use(async (ctx) => {
                    await send(ctx, testFilePath, {
                        setHeaders: function (res, path, stats) {
                            assert.equal(path.slice(-normalizedTestFilePath.length), normalizedTestFilePath);
                            assert.equal(stats.size, 18);
                            assert(res);

                            // these can be set
                            res.setHeader("Cache-Control", "max-age=0,must-revalidate");
                            res.setHeader("Last-Modified", "foo");
                            // this one can not
                            res.setHeader("Content-Length", 9000);
                        }
                    });
                });
                request(app.callback()).get("/").expect(200).
                    expect("Cache-Control", "max-age=0,must-revalidate").expect("Last-Modified", "foo").expect("Content-Length", "18").end(done)
            });
            it("should correctly pass through regarding usual headers", done => {
                const app = new express();
                app.use(async (ctx) => {
                    await send(ctx, "/test/fixtures/user.json", { setHeaders: () => {} });
                });
                request(app.callback()).get("/").expect(200).
                    expect("Cache-Control", "max-age=0").expect("Content-Length", "18").expect("Last-Modified", /GMT/).end(done);
            });
        });
        it("should cleanup on socket error", done => {
            done();
            //const app = new express();
            //let stream;
            //app.use(async (ctx) => {
            //    await send(ctx, "/test/fixtures/user.json");
            //    stream = ctx.body;
            //    ctx.socket.emit("error", new Error("boom"));
            //})
            //request(app.callback()).get("/").expect(500, err => {
            //    assert.ok(err);
            //    assert.ok(stream.destroyed);
            //    done();
            //});
        });
    });
    describe("app static test", () => {
        describe("when defer: false", () => {
            describe("when root = '.'", () => {
                it("should serve from cwd", done => {
                    const app = new express();
                    app.use(express.static("."));
                    request(app.callback()).get("/package.json").expect(200, done)
                });
            });
            describe("when path is not a file", () => {
                it("should 404", done => {
                    const app = new express();
                    app.use(express.static("test/fixtures"));
                    request(app.callback()).get("/something").expect(404, done);
                });
                it("should not throw 404 error", done => {
                    const app = new express();
                    let error = null;
                    app.use(async (ctx, next) => {
                        try {
                            await next();
                        } catch (err) { error = err; }
                    });
                    app.use(express.static("test/fixtures"));
                    app.use(async ctx => ctx.body = "ok");
                    request(app.callback()).get("/something").expect(200).end((err, res) => {
                        assert.equal(res.text, "ok");
                        assert.equal(error, null);
                        done();
                    });
                });
            });
            describe("when upstream middleware responds", () => {
                it("should respond", done => {
                    const app = new express();
                    app.use(express.static("test/fixtures"));
                    app.use((ctx, next) => next().then(() => ctx.body = "hey"));
                    request(app.callback()).get("/hello.txt").expect(200).expect("world", done);
                });
            });
            describe("the path is valid", () => {
                it("should serve the file", done => {
                    const app = new express();
                    app.use(express.static("test/fixtures"));
                    request(app.callback()).get("/hello.txt").expect(200).expect("world", done);
                });
            });
            describe(".index", () => {
                describe("when present", () => {
                    it("should alter the index file supported", done => {
                        const app = new express();
                        app.use(express.static("test/fixtures", { index: "index.txt" }));
                        request(app.callback()).get("/").expect(200).expect("Content-Type", "text/plain; charset=utf-8").expect("text index", done);
                    });
                });
                describe("when omitted", () => {
                    it("should use index.html", done => {
                        const app = new express();
                        app.use(express.static("test/fixtures"));
                        request(app.callback()).get("/world/").expect(200).expect("Content-Type", "text/html; charset=utf-8").expect("html index", done);
                    });
                });
                describe("when disabled", () => {
                    it("should not use index.html", done => {
                        const app = new express();
                        app.use(express.static("test/fixtures", { index: false }));
                        request(app.callback()).get("/world/").expect(404, done);
                    });
                    it("should pass to downstream if 404", function (done) {
                        const app = new express();
                        app.use(express.static("test/fixtures", { index: false }));
                        app.use(async ctx => ctx.body = "oh no");
                        request(app.callback()).get("/world/").expect("oh no", done);
                    });
                });
            });
            describe("when method is not `GET` or `HEAD`", () => {
                it("should 404", done => {
                    const app = new express();
                    app.use(express.static("test/fixtures"));
                    request(app.callback()).post("/hello.txt").expect(404, done);
                });
            });
        });
        describe("when defer: true", () => {
            describe("when upstream middleware responds", () => {
                it("should do nothing", done => {
                    const app = new express();
                    app.use(express.static("test/fixtures", { defer: true }));
                    app.use((ctx, next) => next().then(() => ctx.body = "hey"));
                    request(app.callback()).get("/hello.txt").expect(200).expect("hey", done);
                });
            });
            describe("the path is valid", () => {
                it("should serve the file", done => {
                    const app = new express();
                    app.use(express.static("test/fixtures", { defer: true }));
                    request(app.callback()).get("/hello.txt").expect(200).expect("world", done);
                });
            });
            describe(".index", () => {
                describe("when present", () => {
                    it("should alter the index file supported", done => {
                        const app = new express();
                        app.use(express.static("test/fixtures", { defer: true, index: "index.txt" }));
                        request(app.callback()).get("/").expect(200).expect("Content-Type", "text/plain; charset=utf-8").expect("text index", done);
                    });
                });
                describe("when omitted", () => {
                    it("should use index.html", done => {
                        const app = new express();
                        app.use(express.static("test/fixtures", { defer: true }));
                        request(app.callback()).get("/world/").expect(200).expect("Content-Type", "text/html; charset=utf-8").expect("html index", done);
                    });
                });
            });
            describe("when path is not a file", () => {
                it("should 404", done => {
                    const app = new express();
                    app.use(express.static("test/fixtures", { defer: true }));
                    request(app.callback()).get("/something").expect(404, done);
                });
                it("should not throw 404 error", done => {
                    const app = new express();
                    let error = null;
                    app.use(async (ctx, next) => {
                        try {
                            await next();
                        } catch(err) { error = err }
                    });
                    app.use(express.static("test/fixtures", { defer: true }));
                    request(app.callback()).get("/something").expect(200).end((err, res) => {
                        assert.equal(error, null);
                        done();
                    });
                });
            });
            describe("it should not handle the request", () => {
                it("when status=204", done => {
                    const app = new express();
                    app.use(express.static("test/fixtures", { defer: true }));
                    app.use(ctx => ctx.status = 204);
                    request(app.callback()).get("/something%%%/").expect(204, done);
                });
                it("when body=''", done => {
                    const app = new express();
                    app.use(express.static("test/fixtures", { defer: true }));
                    app.use(ctx => ctx.body = '');
                    request(app.callback()).get("/something%%%/").expect(200, done);
                });
            });
            describe("when method is not `GET` or `HEAD`", () => {
                it("should 404", done => {
                    const app = new express();
                    app.use(express.static("test/fixtures", { defer: true }));
                    request(app.callback()).post("/hello.txt").expect(404, done);
                });
            });
        });
        describe("option - format", () => {
            describe("when format: false", () => {
                it("should 404", done => {
                    const app = new express();
                    app.use(express.static("test/fixtures", {
                        index: "index.html",
                        format: false
                    }));
                    request(app.callback()).get("/world").expect(404, done);
                });
                it("should 200", done => {
                    const app = new express();
                    app.use(express.static("test/fixtures", {
                        index: "index.html",
                        format: false
                    }));
                    request(app.callback()).get("/world/").expect(200, done);
                });
            });
            describe("when format: true", () => {
                it("should 200", done => {
                    const app = new express();
                    app.use(express.static("test/fixtures", {
                        index: "index.html",
                        format: true
                    }));
                    request(app.callback()).get("/world").expect(200, done);
                });
                it("should 200", function (done) {
                    const app = new express();
                    app.use(express.static("test/fixtures", {
                        index: "index.html",
                        format: true
                    }));
                    request(app.callback()).get("/world/").expect(200, done);
                })
            });
        });
    });
    describe("app render test", () => {
        it("have a render method by app.context", done => {
            const app = new express();
            const render = express.views();
            app.context.render = render;
            app.response.render = render;
            app.use(ctx => {
                assert.ok(!!ctx.render);
                assert.ok(typeof ctx.render === "function");
                assert.strictEqual(ctx.response.render, ctx.render);
            });
            request(app.callback()).get("/").expect(404, done);
        });
        it("should get error with unknown engine", done => {
            const app = new express();
            app.use(express.views(__dirname, { extension: "txt" }));
            app.use(ctx => ctx.render("./fixtures/hello"));
            request(app.callback()).get("/").expect(500, done);
        });
        it("render a html", done => {
            const app = new express();
            app.use(express.views(__dirname));
            app.use(ctx => ctx.render("./fixtures/basic"));
            request(app.callback()).get("/").expect("Content-Type", /html/).expect(/basic:html/).expect(200, done);
        });
    });
});
