const httpProxy = require("../plugins/proxy");
const ws = require("ws");
const assert = require("node:assert");
const https = require("node:https");
const http = require("node:http");
const path = require("node:path");
const url = require("node:url");
const fs = require("node:fs");

describe("Proxy test", () => {
    describe("http proxy module test", () => {
        let initialPort = 1024, gen = {};
        Object.defineProperty(gen, "port", { get: () => initialPort++ });
        describe("create proxy server test", () => {
            it("should throw without options", () => {
                assert.throws(() => new httpProxy(), Error);
            });
            it("should return an object with options", () => {
                let obj = httpProxy({ target: "http://www.google.com:80" });

                assert.strictEqual(typeof obj.web, "function");
                assert.strictEqual(typeof obj.ws, "function");
                assert.strictEqual(typeof obj.listen, "function");
            });
            describe("with forward options and using web-incoming passes", () => {
                it("should pipe the request using web-incoming stream method", done => {
                    const ports = { source: gen.port, proxy: gen.port };
                    const proxy = httpProxy({ forward: `http://127.0.0.1:${ports.source}` }).listen(ports.proxy);

                    const source = http.createServer((req, res) => {
                        assert.strictEqual(req.method, "GET");
                        assert.equal(req.headers.host.split(":")[1], ports.proxy);
                        source.close();
                        proxy.close();
                        done();
                    }).listen(ports.source);

                    http.request("http://127.0.0.1:" + ports.proxy, () => {}).end();
                });
            });
            describe("using the web-incoming passes", () => {
                //it("should proxy sse", done => {
                //    const ports = { source: gen.port, proxy: gen.port };
                //    let proxy = httpProxy({ target: `http://localhost:${ports.source}` }).listen(ports.proxy);
                //    const source = http.createServer();
                //});
                it("should make the request on pipe and finish it", done => {
                    const ports = { source: gen.port, proxy: gen.port };
                    let proxy = httpProxy({ target: `http://localhost:${ports.source}` }).listen(ports.proxy);
                    const source = http.createServer((req, res) => {
                        assert.strictEqual(req.method, "POST");
                        assert.strictEqual(req.headers["x-forwarded-for"], "127.0.0.1");
                        assert.equal(req.headers.host.split(":")[1], ports.proxy);
                        source.close();
                        proxy.close();
                        done();
                    }).listen(ports.source);
                    http.request({
                        hostname: "127.0.0.1",
                        port: ports.proxy,
                        method: "POST",
                        headers: { "x-forwarded-for": "127.0.0.1" }
                    }, () => {}).end();
                });
            });
            describe("with error response", () => {
                it("should make the request and emit the error event", done => {
                    const ports = { source: gen.port, proxy: gen.port };
                    const proxy = httpProxy({ target: `http://127.0.0.1:${ports.source}` });
                    proxy.on("error", err => {
                        assert.ok(err instanceof Error);
                        assert.strictEqual(err.code, "ECONNREFUSED");
                        proxy.close();
                        done();
                    });
                    proxy.listen(ports.proxy);
                    http.request({
                        hostname: "127.0.0.1",
                        port: ports.proxy,
                        method: "GET",
                    }, () => {}).end();
                });
            });
            describe("using the ws-incoming passes", () => {
                it("should proxy the websockets stream", done => {
                    const ports = {source: gen.port, proxy: gen.port};
                    const proxy = httpProxy({
                        target: `ws://127.0.0.1:${ports.source}`,
                        ws: true
                    }).listen(ports.proxy);
                    const destiny = new ws.Server({port: ports.source}, () => {
                        const client = new ws(`ws://127.0.0.1:${ports.proxy}`);
                        client.on("open", () => {
                            client.send("hello there");
                        });
                        client.on("message", msg => {
                            assert.strictEqual(msg.toString(), "Hello over websockets");
                            client.close();
                            proxy.close();
                            destiny.close();
                            done();
                        });
                    });
                    destiny.on("connection", socket => {
                        socket.on("message", msg => {
                            assert.strictEqual(msg.toString(), "hello there");
                            socket.send("Hello over websockets");
                        });
                    });
                });
                it("should emit error on proxy error", done => {
                    const ports = { source: gen.port, proxy: gen.port };
                    const proxy = httpProxy({
                        // note: we don't ever listen on this port
                        target: `ws://127.0.0.1:${ports.source}`,
                        ws: true
                    }).listen(ports.proxy);

                    const client = new ws(`ws://127.0.0.1:${ports.proxy}`);

                    client.on("open", () => {
                        client.send("hello there");
                    });

                    let count = 0;

                    function maybe_done () {
                        count += 1;
                        if (count === 2) done();
                    }

                    client.on("error", err => {
                        assert.strictEqual(err instanceof Error, true);
                        assert.strictEqual(err.code, "ECONNRESET");
                        maybe_done();
                    });

                    proxy.on("error", err => {
                        assert.strictEqual(err instanceof Error, true);
                        assert.strictEqual(err.code, "ECONNREFUSED");
                        proxy.close();
                        maybe_done();
                    });
                });
                it("should close client socket if upstream is closed before upgrade", done => {
                    const ports = { source: gen.port, proxy: gen.port };
                    const server = http.createServer();
                    server.on("upgrade", (req, socket, head) => {
                        const response = ["HTTP/1.1 404 Not Found", "Content-type: text/html", '', ''];
                        socket.write(response.join("\r\n"));
                        socket.end();
                    });
                    server.listen(ports.source);

                    const proxy = httpProxy({
                        // note: we don't ever listen on this port
                        target: `ws://127.0.0.1:${ports.source}`,
                        ws: true
                    }).listen(ports.proxy);
                    const client = new ws(`ws://127.0.0.1:${ports.proxy}`);

                    client.on("open", function () {
                        client.send("hello there");
                    });

                    client.on("error", function (err) {
                        assert.strictEqual(err instanceof Error, true);
                        proxy.close();
                        done();
                    });
                });
                it("should proxy a socket.io stream", () => {
                });
                it("should emit open and close events when socket.io client connects and disconnects", () => {
                });
                it("should pass all set-cookie headers to client", () => {
                });
                it("should detect a proxyReq event and modify headers", function (done) {
                    const ports = { source: gen.port, proxy: gen.port };

                    const proxy = httpProxy({
                        target: `ws://127.0.0.1:${ports.source}`,
                        ws: true
                    });
                    proxy.on("proxyReqWs", (proxyReq, req, socket, options, head) => {
                        proxyReq.setHeader("X-Special-Proxy-Header", "foobar");
                    });
                    const proxyServer = proxy.listen(ports.proxy);

                    const destiny = new ws.Server({ port: ports.source }, () => {
                        const client = new ws(`ws://127.0.0.1:${ports.proxy}`);

                        client.on("open", () => {
                            client.send("hello there");
                        });

                        client.on("message", msg => {
                            assert.strictEqual(msg.toString(), "Hello over websockets");
                            client.close();
                            proxyServer.close();
                            destiny.close();
                            done();
                        });
                    });

                    destiny.on("connection", (socket, upgradeReq) => {
                        assert.strictEqual(upgradeReq.headers["x-special-proxy-header"], "foobar");

                        socket.on("message", msg => {
                            assert.strictEqual(msg.toString(), "hello there");
                            socket.send("Hello over websockets");
                        });
                    });
                });
                it("should forward frames with single frame payload", done => {
                    const payload = Array(65529).join("0");
                    const ports = { source: gen.port, proxy: gen.port };
                    const proxy = httpProxy({
                        target: `ws://127.0.0.1:${ports.source}`,
                        ws: true
                    }).listen(ports.proxy);
                    const destiny = new ws.Server({port: ports.source}, () => {
                        const client = new ws(`ws://127.0.0.1:${ports.proxy}`);

                        client.on("open", () => {
                            client.send(payload);
                        });

                        client.on("message", msg => {
                            assert.strictEqual(msg.toString(), "Hello over websockets");
                            client.close();
                            proxy.close();
                            destiny.close();
                            done();
                        });
                    });

                    destiny.on("connection", socket => {
                        socket.on("message", msg => {
                            assert.strictEqual(msg.toString(), payload);
                            socket.send("Hello over websockets");
                        });
                    });
                });
            });
        });
    });
    describe("https proxy module test", () => {
        let initialPort = 1024, gen = {};
        Object.defineProperty(gen, "port", { get: () => initialPort++ });
        describe("HTTPS to HTTP", function () {
            it("should proxy the request en send back the response", function (done) {
                const ports = { source: gen.port, proxy: gen.port };
                const source = http.createServer(function(req, res) {
                    assert.strictEqual(req.method, "GET");
                    assert.equal(req.headers.host.split(":")[1], ports.proxy);
                    res.writeHead(200, { "Content-Type": "text/plain" });
                    res.end("Hello from " + ports.source);
                }).listen(ports.source);

                const proxy = httpProxy({
                    target: `http://127.0.0.1:${ports.source}`,
                    ssl: {
                        key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
                        cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
                        ciphers: "AES128-GCM-SHA256",
                    }
                }).listen(ports.proxy);

                https.request({
                    host: "localhost",
                    port: ports.proxy,
                    path: "/",
                    method: "GET",
                    rejectUnauthorized: false
                }, res => {
                    assert.strictEqual(res.statusCode, 200);

                    res.on("data", data => {
                        assert.strictEqual(data.toString(), "Hello from " + ports.source);
                    });

                    res.on("end", () => {
                        source.close();
                        proxy.close();
                        done();
                    })
                }).end();
            })
        });
        describe("HTTPS to HTTPS", () => {
            it("should proxy the request en send back the response", done => {
                const ports = { source: gen.port, proxy: gen.port };
                const source = https.createServer({
                    key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
                    cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
                    ciphers: "AES128-GCM-SHA256",
                }, (req, res) => {
                    assert.strictEqual(req.method, "GET");
                    assert.equal(req.headers.host.split(":")[1], ports.proxy);
                    res.writeHead(200, { "Content-Type": "text/plain" });
                    res.end("Hello from " + ports.source);
                }).listen(ports.source);

                const proxy = httpProxy({
                    target: `https://127.0.0.1:${ports.source}`,
                    ssl: {
                        key: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-key.pem")),
                        cert: fs.readFileSync(path.join(__dirname, "fixtures", "agent2-cert.pem")),
                        ciphers: "AES128-GCM-SHA256",
                    },
                    secure: false
                }).listen(ports.proxy);

                https.request({
                    host: "localhost",
                    port: ports.proxy,
                    path: "/",
                    method: "GET",
                    rejectUnauthorized: false
                }, res => {
                    assert.strictEqual(res.statusCode, 200);

                    res.on("data", data => {
                        assert.strictEqual(data.toString(), "Hello from " + ports.source);
                    });

                    res.on("end", () => {
                        source.close();
                        proxy.close();
                        done();
                    })
                }).end();
            });
        });
    });
    describe("web incoming module test", () => {
        const webPasses = require("../plugins/proxy/web.in.js");
        describe("delete length test", () => {
            it("should change `content-length` for DELETE requests", () => {
                const stubRequest = { method: "DELETE", headers: {} };
                webPasses.deleteLength(stubRequest, {}, {});
                assert.equal(stubRequest.headers["content-length"], "0");
            });
            it("should change `content-length` for OPTIONS requests", () => {
                const stubRequest = { method: "OPTIONS", headers: {} };
                webPasses.deleteLength(stubRequest, {}, {});
                assert.equal(stubRequest.headers["content-length"], "0");
            });
            it("should remove `transfer-encoding` from empty DELETE requests", () => {
                const stubRequest = { method: "DELETE", headers: { "transfer-encoding": "chunked" }};
                webPasses.deleteLength(stubRequest, {}, {});
                assert.equal(stubRequest.headers["content-length"], "0");
                assert.strictEqual("transfer-encoding" in stubRequest.headers, false);
            });
        });
        describe("timeout test", () => {
            it("should set timeout on the socket", () => {
                let done = false, stubRequest = {
                    socket: { setTimeout: value => done = value }
                };
                webPasses.timeout(stubRequest, {}, { timeout: 5000});
                assert.strictEqual(done, 5000);
            });
        });
        describe("XHeaders test", () => {
            const stubRequest = {
                connection: {
                    remoteAddress: "192.168.1.2",
                    remotePort: "8080"
                },
                headers: {
                    host: "192.168.1.2:8080"
                }
            }
            it("set the correct x-forwarded-* headers", () => {
                webPasses.XHeaders(stubRequest, {}, { xfwd: true });
                assert.strictEqual(stubRequest.headers["x-forwarded-for"], "192.168.1.2");
                assert.strictEqual(stubRequest.headers["x-forwarded-port"], "8080");
                assert.strictEqual(stubRequest.headers["x-forwarded-proto"], "http");
            });
        });
        describe("using own http server", () => {
            it("", () => {})
        });
    });
    describe("web outgoing module test", () => {
        const webPasses = require("../plugins/proxy/web.out.js");
        describe("set redirect host rewrite test", () => {
            beforeEach(() => {
                this.req = {
                    headers: {
                        host: "ext-auto.com"
                    }
                };
                this.proxyRes = {
                    statusCode: 301,
                    headers: {
                        location: "http://backend.com/"
                    }
                };
                this.options = {
                    target: "http://backend.com"
                };
            });
            context("rewrites location host with hostRewrite", () => {
                beforeEach(() => {
                    this.options.hostRewrite = "ext-manual.com";
                });
                [201, 301, 302, 307, 308].forEach(code => {
                    it("on " + code, () => {
                        this.proxyRes.statusCode = code;
                        webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                        assert.strictEqual(this.proxyRes.headers.location, "http://ext-manual.com/");
                    });
                });
                it("not on 200", () => {
                    this.proxyRes.statusCode = 200;
                    webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                    assert.strictEqual(this.proxyRes.headers.location, "http://backend.com/");
                });
                it("not when hostRewrite is unset", () => {
                    delete this.options.hostRewrite;
                    webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                    assert.strictEqual(this.proxyRes.headers.location, "http://backend.com/");
                });
                it("takes precedence over autoRewrite", () => {
                    this.options.autoRewrite = true;
                    webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                    assert.strictEqual(this.proxyRes.headers.location, "http://ext-manual.com/");
                });
                it("not when the redirected location does not match target host", () => {
                    this.proxyRes.statusCode = 302;
                    this.proxyRes.headers.location = "http://some-other/";
                    webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                    assert.strictEqual(this.proxyRes.headers.location, "http://some-other/");
                });
                it("not when the redirected location does not match target port", () => {
                    this.proxyRes.statusCode = 302;
                    this.proxyRes.headers.location = "http://backend.com:8080/";
                    webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                    assert.strictEqual(this.proxyRes.headers.location, "http://backend.com:8080/");
                });
            });
            context("rewrites location host with autoRewrite", () => {
                beforeEach(() => {
                    this.options.autoRewrite = true;
                });
                [201, 301, 302, 307, 308].forEach(code => {
                    it("on " + code, () => {
                        this.proxyRes.statusCode = code;
                        webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                        assert.strictEqual(this.proxyRes.headers.location, "http://ext-auto.com/");
                    });
                });
                it("not on 200", () => {
                    this.proxyRes.statusCode = 200;
                    webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                    assert.strictEqual(this.proxyRes.headers.location, "http://backend.com/");
                });
                it("not when autoRewrite is unset", () => {
                    delete this.options.autoRewrite;
                    webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                    assert.strictEqual(this.proxyRes.headers.location, "http://backend.com/");
                });
                it("not when the redirected location does not match target host", () => {
                    this.proxyRes.statusCode = 302;
                    this.proxyRes.headers.location = "http://some-other/";
                    webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                    assert.strictEqual(this.proxyRes.headers.location, "http://some-other/");
                });
                it("not when the redirected location does not match target port", () => {
                    this.proxyRes.statusCode = 302;
                    this.proxyRes.headers.location = "http://backend.com:8080/";
                    webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                    assert.strictEqual(this.proxyRes.headers.location, "http://backend.com:8080/");
                });
            });
            context("rewrites location protocol with protocolRewrite", () => {
                beforeEach(() => {
                    this.options.protocolRewrite = "https";
                });
                [201, 301, 302, 307, 308].forEach(code => {
                    it("on " + code, () => {
                        this.proxyRes.statusCode = code;
                        webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                        assert.strictEqual(this.proxyRes.headers.location, "https://backend.com/");
                    });
                });
                it("not on 200", () => {
                    this.proxyRes.statusCode = 200;
                    webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                    assert.strictEqual(this.proxyRes.headers.location, "http://backend.com/");
                });
                it("not when protocolRewrite is unset", () => {
                    delete this.options.protocolRewrite;
                    webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                    assert.strictEqual(this.proxyRes.headers.location, "http://backend.com/");
                });
                it("works together with hostRewrite", () => {
                    this.options.hostRewrite = "ext-manual.com";
                    webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                    assert.strictEqual(this.proxyRes.headers.location, "https://ext-manual.com/");
                });
                it("works together with autoRewrite", () => {
                    this.options.autoRewrite = true;
                    webPasses.setRedirectHostRewrite(this.req, {}, this.proxyRes, this.options);
                    assert.strictEqual(this.proxyRes.headers.location, "https://ext-auto.com/");
                });
            });
        });
        describe("set connection test", () => {
            it("set the right connection with 1.0 - `close`", () => {
                let proxyRes = { headers: {} };
                webPasses.setConnection({
                    httpVersion: "1.0",
                    headers: {
                        connection: null
                    }
                }, {}, proxyRes);

                assert.strictEqual(proxyRes.headers.connection, "close");
            });
            it("set the right connection with 1.0 - req.connection", () => {
                let proxyRes = { headers: {} };
                webPasses.setConnection({
                    httpVersion: "1.0",
                    headers: {
                        connection: "hey"
                    }
                }, {}, proxyRes);

                assert.strictEqual(proxyRes.headers.connection, "hey");
            });
            it("set the right connection - req.connection", () => {
                let proxyRes = { headers: {} };
                webPasses.setConnection({
                    httpVersion: null,
                    headers: {
                        connection: "hola"
                    }
                }, {}, proxyRes);

                assert.strictEqual(proxyRes.headers.connection, "hola");
            });
            it("set the right connection - `keep-alive`", () => {
                let proxyRes = { headers: {} };
                webPasses.setConnection({
                    httpVersion: null,
                    headers: {
                        connection: null
                    }
                }, {}, proxyRes);

                assert.strictEqual(proxyRes.headers.connection, "keep-alive");
            });
            it("don`t set connection with 2.0 if exist", () => {
                let proxyRes = { headers: {} };
                webPasses.setConnection({
                    httpVersion: "2.0",
                    headers: {
                        connection: "namstey"
                    }
                }, {}, proxyRes);

                assert.strictEqual(proxyRes.headers.connection, undefined);
            });
            it("don`t set connection with 2.0 if doesn`t exist", () => {
                let proxyRes = { headers: {} };
                webPasses.setConnection({
                    httpVersion: "2.0",
                    headers: {}
                }, {}, proxyRes);

                assert.strictEqual(proxyRes.headers.connection, undefined);
            })
        });
        describe("write status code test", () => {
            it("should write status code", function() {
                let res = {
                    writeHead: function(n) {
                        assert.strictEqual(n, 200);
                    }
                };

                webPasses.writeStatusCode({}, res, { statusCode: 200 });
            });
        });
        describe("write headers test", () => {
            beforeEach(() => {
                this.proxyRes = {
                    headers: {
                        hey: "hello",
                        how: "are you?",
                        "set-cookie": [
                            "hello; domain=my.domain; path=/",
                            "there; domain=my.domain; path=/"
                        ]
                    }
                };
                this.rawProxyRes = {
                    headers: {
                        hey: "hello",
                        how: "are you?",
                        "set-cookie": [
                            "hello; domain=my.domain; path=/",
                            "there; domain=my.domain; path=/"
                        ]
                    },
                    rawHeaders: [
                        "Hey", "hello",
                        "How", "are you?",
                        "Set-Cookie", "hello; domain=my.domain; path=/",
                        "Set-Cookie", "there; domain=my.domain; path=/"
                    ]
                };
                this.res = {
                    setHeader: function(k, v) {
                        // https://nodejs.org/api/http.html#http_message_headers
                        // Header names are lower-cased
                        this.headers[k.toLowerCase()] = v;
                    },
                    headers: {}
                };
            });
            it("writes headers", () => {
                let options = {};
                webPasses.writeHeaders({}, this.res, this.proxyRes, options);

                assert.strictEqual(this.res.headers.hey, "hello");
                assert.strictEqual(this.res.headers.how, "are you?");

                assert.strictEqual("set-cookie" in this.res.headers, true);
                assert.strictEqual(this.res.headers["set-cookie"] instanceof Array, true);
                assert.strictEqual(this.res.headers["set-cookie"].length, 2);
            });
            it("writes raw headers", () => {
                let options = {};
                webPasses.writeHeaders({}, this.res, this.rawProxyRes, options);

                assert.strictEqual(this.res.headers.hey, "hello");
                assert.strictEqual(this.res.headers.how, "are you?");

                assert.strictEqual("set-cookie" in this.res.headers, true);
                assert.strictEqual(this.res.headers["set-cookie"] instanceof Array, true);
                assert.strictEqual(this.res.headers["set-cookie"].length, 2);
            });
            it("rewrites path", () => {
                let options = {
                    cookiePathRewrite: "/dummyPath"
                };

                webPasses.writeHeaders({}, this.res, this.proxyRes, options);

                assert.ok(this.res.headers["set-cookie"].includes("hello; domain=my.domain; path=/dummyPath"));
            });
            it("does not rewrite path", () => {
                let options = {};

                webPasses.writeHeaders({}, this.res, this.proxyRes, options);

                assert.ok(this.res.headers["set-cookie"].includes("hello; domain=my.domain; path=/"));
            });
            it("removes path", () => {
                let options = {
                    cookiePathRewrite: ''
                };

                webPasses.writeHeaders({}, this.res, this.proxyRes, options);

                assert.ok(this.res.headers["set-cookie"].includes("hello; domain=my.domain"));
            });
            it("rewrites domain", () => {
                let options = {
                    cookieDomainRewrite: "my.new.domain"
                };

                webPasses.writeHeaders({}, this.res, this.proxyRes, options);

                assert.ok(this.res.headers["set-cookie"].includes("hello; domain=my.new.domain; path=/"));
            });
            it("removes domain", () => {
                let options = {
                    cookieDomainRewrite: ''
                };

                webPasses.writeHeaders({}, this.res, this.proxyRes, options);

                assert.ok(this.res.headers["set-cookie"].includes("hello; path=/"));
            });
            it("rewrites headers with advanced configuration", () => {
                let options = {
                    cookieDomainRewrite: {
                        "*": '',
                        "my.old.domain": "my.new.domain",
                        "my.special.domain": "my.special.domain"
                    }
                };
                this.proxyRes.headers["set-cookie"] = [
                    "hello-on-my.domain; domain=my.domain; path=/",
                    "hello-on-my.old.domain; domain=my.old.domain; path=/",
                    "hello-on-my.special.domain; domain=my.special.domain; path=/"
                ];
                webPasses.writeHeaders({}, this.res, this.proxyRes, options);

                assert.ok(this.res.headers["set-cookie"].includes("hello-on-my.domain; path=/"));
                assert.ok(this.res.headers["set-cookie"].includes("hello-on-my.old.domain; domain=my.new.domain; path=/"));
                assert.ok(this.res.headers["set-cookie"].includes("hello-on-my.special.domain; domain=my.special.domain; path=/"));
            });
            it("rewrites raw headers with advanced configuration", () => {
                let options = {
                    cookieDomainRewrite: {
                        "*": '',
                        "my.old.domain": "my.new.domain",
                        "my.special.domain": "my.special.domain"
                    }
                };
                this.rawProxyRes.headers["set-cookie"] = [
                    "hello-on-my.domain; domain=my.domain; path=/",
                    "hello-on-my.old.domain; domain=my.old.domain; path=/",
                    "hello-on-my.special.domain; domain=my.special.domain; path=/"
                ];
                this.rawProxyRes.rawHeaders = this.rawProxyRes.rawHeaders.concat([
                    "Set-Cookie",
                    "hello-on-my.domain; domain=my.domain; path=/",
                    "Set-Cookie",
                    "hello-on-my.old.domain; domain=my.old.domain; path=/",
                    "Set-Cookie",
                    "hello-on-my.special.domain; domain=my.special.domain; path=/"
                ]);
                webPasses.writeHeaders({}, this.res, this.rawProxyRes, options);

                assert.ok(this.res.headers["set-cookie"].includes("hello-on-my.domain; path=/"));
                assert.ok(this.res.headers["set-cookie"].includes("hello-on-my.old.domain; domain=my.new.domain; path=/"));
                assert.ok(this.res.headers["set-cookie"].includes("hello-on-my.special.domain; domain=my.special.domain; path=/"));
            });
        });
        describe("remove chunked test", () => {
            it("should remove chunk", () => {
                let proxyRes = {
                    headers: {
                        "transfer-encoding": "hello"
                    }
                };

                webPasses.removeChunked({ httpVersion: "1.0" }, {}, proxyRes);

                assert.strictEqual("transfer-encoding" in proxyRes.headers, false);
            });
        });
    });
    describe("ws module test", () => {
        const wsPasses = require("../plugins/proxy/ws.in.js");
        describe("check method and header test", () => {
            it("should drop non-GET connections", () => {
                let destroyCalled = false,
                    stubRequest = {
                        method: "DELETE",
                        headers: {}
                    },
                    stubSocket = {
                        destroy: function () {
                            // Simulate Socket.destroy() method when call
                            destroyCalled = true;
                        }
                    };
                let returnValue = wsPasses.checkMethodAndHeader(stubRequest, stubSocket);
                assert.strictEqual(returnValue, true);
                assert.strictEqual(destroyCalled, true);
            });
            it("should drop connections when no upgrade header", () => {
                let destroyCalled = false,
                    stubRequest = {
                        method: "GET",
                        headers: {}
                    },
                    stubSocket = {
                        destroy: function () {
                            // Simulate Socket.destroy() method when call
                            destroyCalled = true;
                        }
                    }
                let returnValue = wsPasses.checkMethodAndHeader(stubRequest, stubSocket);
                assert.strictEqual(returnValue, true);
                assert.strictEqual(destroyCalled, true);
            });
            it("should drop connections when upgrade header is different of `websocket`", () => {
                let destroyCalled = false,
                    stubRequest = {
                        method: "GET",
                        headers: {
                            upgrade: "anotherprotocol"
                        }
                    },
                    stubSocket = {
                        destroy: function () {
                            // Simulate Socket.destroy() method when call
                            destroyCalled = true;
                        }
                    }
                let returnValue = wsPasses.checkMethodAndHeader(stubRequest, stubSocket);
                assert.strictEqual(returnValue, true);
                assert.strictEqual(destroyCalled, true);
            });
            it("should return nothing when all is ok", () => {
                let destroyCalled = false,
                    stubRequest = {
                        method: "GET",
                        headers: {
                            upgrade: "websocket"
                        }
                    },
                    stubSocket = {
                        destroy: function () {
                            // Simulate Socket.destroy() method when call
                            destroyCalled = true;
                        }
                    }
                let returnValue = wsPasses.checkMethodAndHeader(stubRequest, stubSocket);
                assert.strictEqual(returnValue, undefined);
                assert.strictEqual(destroyCalled, false);
            })
        });
        describe("XHeaders test", () => {
            it("return if no forward request", () => {
                let returnValue = wsPasses.XHeaders({}, {}, {});
                assert.strictEqual(returnValue, undefined);
            });
            it("set the correct x-forwarded-* headers from req.connection", () => {
                let stubRequest = {
                    connection: {
                        remoteAddress: "192.168.1.2",
                        remotePort: "8080"
                    },
                    headers: {
                        host: "192.168.1.2:8080"
                    }
                }
                wsPasses.XHeaders(stubRequest, {}, { xfwd: true });
                assert.strictEqual(stubRequest.headers["x-forwarded-for"], "192.168.1.2");
                assert.strictEqual(stubRequest.headers["x-forwarded-port"], "8080");
                assert.strictEqual(stubRequest.headers["x-forwarded-proto"], "ws");
            });
            it("set the correct x-forwarded-* headers from req.socket", () => {
                let stubRequest = {
                    socket: {
                        remoteAddress: "192.168.1.3",
                        remotePort: "8181"
                    },
                    connection: {
                        pair: true
                    },
                    headers: {
                        host: "192.168.1.3:8181"
                    }
                };
                wsPasses.XHeaders(stubRequest, {}, { xfwd: true });
                assert.strictEqual(stubRequest.headers["x-forwarded-for"], "192.168.1.3");
                assert.strictEqual(stubRequest.headers["x-forwarded-port"], "8181");
                assert.strictEqual(stubRequest.headers["x-forwarded-proto"], "wss");
            });
        });
    });
    describe("proxy shared module test", () => {
        const shared = require("../plugins/proxy/shared.js");
        it("set up outgoing", () => {
            let outgoing = {};
            shared.setupOutgoing(outgoing,
                {
                    agent     : "?",
                    target: {
                        host      : "hey",
                        hostname  : "how",
                        socketPath: "are",
                        port      : "you",
                    },
                    headers: { "fizz": "bang", "overwritten": true },
                    localAddress: "local.address",
                    auth:"username:pass"
                },
                {
                    method    : "i",
                    url       : "am",
                    headers   : { "pro": "xy", "overwritten": false }
                });
            assert.strictEqual(outgoing.host, "hey");
            assert.strictEqual(outgoing.hostname, "how");
            assert.strictEqual(outgoing.socketPath, "are");
            assert.strictEqual(outgoing.port, "you");
            assert.strictEqual(outgoing.agent, "?");

            assert.strictEqual(outgoing.method, "i");
            assert.strictEqual(outgoing.path, "am");

            assert.strictEqual(outgoing.headers.pro, "xy");
            assert.strictEqual(outgoing.headers.fizz, "bang");
            assert.strictEqual(outgoing.headers.overwritten, true);
            assert.strictEqual(outgoing.localAddress, "local.address");
            assert.strictEqual(outgoing.auth, "username:pass");
        });
        it("should not override agentless upgrade header", () => {
            let outgoing = {};
            shared.setupOutgoing(outgoing,
                {
                    agent: undefined,
                    target: {
                        host      : "hey",
                        hostname  : "how",
                        socketPath: "are",
                        port      : "you",
                    },
                    headers: { "connection": "upgrade" },
                },
                {
                    method    : "i",
                    url       : "am",
                    headers   : { "pro":"xy", "overwritten": false }
                });
            assert.strictEqual(outgoing.headers.connection, "upgrade");
        });
        it("should not override agentless connection: contains upgrade", () => {
            let outgoing = {};
            shared.setupOutgoing(outgoing,
                {
                    agent: undefined,
                    target: {
                        host      : "hey",
                        hostname  : "how",
                        socketPath: "are",
                        port      : "you",
                    },
                    headers: { "connection": "keep-alive, upgrade" }, // this is what Firefox sets
                },
                {
                    method    : "i",
                    url       : "am",
                    headers   : { "pro":"xy","overwritten": false }
                });
            assert.strictEqual(outgoing.headers.connection, "keep-alive, upgrade");
        });
        it("should override agentless connection: contains improper upgrade", () => {
            // sanity check on upgrade regex
            let outgoing = {};
            shared.setupOutgoing(outgoing,
                {
                    agent: undefined,
                    target: {
                        host      : "hey",
                        hostname  : "how",
                        socketPath: "are",
                        port      : "you",
                    },
                    headers: { "connection": "keep-alive, not upgrade" },
                },
                {
                    method    : "i",
                    url       : "am",
                    headers   : { "pro": "xy", "overwritten": false }
                });
            assert.strictEqual(outgoing.headers.connection, "close");
        });
        it("should override agentless non-upgrade header to close", () => {
            let outgoing = {};
            shared.setupOutgoing(outgoing,
                {
                    agent: undefined,
                    target: {
                        host      : "hey",
                        hostname  : "how",
                        socketPath: "are",
                        port      : "you",
                    },
                    headers: { "connection": "xyz" },
                },
                {
                    method    : "i",
                    url       : "am",
                    headers   : { "pro": "xy", "overwritten": false }
                });
            assert.strictEqual(outgoing.headers.connection, "close");
        });
        it("should set the agent to false if none is given", () => {
            let outgoing = {};
            shared.setupOutgoing(outgoing, {target: "http://localhost" }, { url: "/" });
            assert.strictEqual(outgoing.agent, false);
        });
        it("set the port according to the protocol", () => {
            let outgoing = {};
            shared.setupOutgoing(outgoing,
                {
                    agent     : "?",
                    target: {
                        host      : "how",
                        hostname  : "are",
                        socketPath: "you",
                        protocol  : "https:"
                    }
                },
                {
                    method    : "i",
                    url       : "am",
                    headers   : { pro: "xy" }
                });

            assert.strictEqual(outgoing.host, "how");
            assert.strictEqual(outgoing.hostname, "are");
            assert.strictEqual(outgoing.socketPath, "you");
            assert.strictEqual(outgoing.agent, "?");

            assert.strictEqual(outgoing.method, "i");
            assert.strictEqual(outgoing.path, "am");
            assert.strictEqual(outgoing.headers.pro, "xy");

            assert.strictEqual(outgoing.port, 443);
        });
        it("should keep the original target path in the outgoing path", () => {
            let outgoing = {};
            shared.setupOutgoing(outgoing, { target: { path: "some-path" } }, { url : "am" });
            assert.strictEqual(outgoing.path, "some-path/am");
        });
        it("should keep the original forward path in the outgoing path", () => {
            let outgoing = {};
            shared.setupOutgoing(outgoing, { target: {}, forward: { path: "some-path" } }, { url : "am" }, "forward");
            assert.strictEqual(outgoing.path, "some-path/am");
        });
        it("should properly detect https/wss protocol without the colon", () => {
            let outgoing = {};
            shared.setupOutgoing(outgoing, { target: { protocol: "https", host: "whatever.com" } }, { url: "/" });
            assert.strictEqual(outgoing.port, 443);
        });
        it("should not prepend the target path to the outgoing path with prependPath = false", () => {
            let outgoing = {};
            shared.setupOutgoing(outgoing, { target: { path: "hellothere" }, prependPath: false }, { url: "hi" });
            assert.strictEqual(outgoing.path, "hi");
        });
        it("should properly join paths", () => {
            let outgoing = {};
            shared.setupOutgoing(outgoing, { target: { path: "/forward" } }, { url: "/static/path" });
            assert.strictEqual(outgoing.path, "/forward/static/path");
        });
        it("should not modify the query string", () => {
            let outgoing = {};
            shared.setupOutgoing(outgoing, { target: { path: "/forward" } }, { url: "/?foo=bar//&target=http://foobar.com/?a=1%26b=2&other=2" });
            assert.strictEqual(outgoing.path, "/forward/?foo=bar//&target=http://foobar.com/?a=1%26b=2&other=2");
        });
        it("should correctly format the toProxy URL", () => {
            let outgoing = {}, google = "https://google.com";
            shared.setupOutgoing(outgoing, { target: url.parse("http://sometarget.com:80"), toProxy: true }, { url: google });
            assert.strictEqual(outgoing.path, "/" + google);
        });
        it("should not replace :\ to :\\ when no https word before", () => {
            let outgoing = {}, google = "https://google.com:/join/join.js";
            shared.setupOutgoing(outgoing, { target: url.parse("http://sometarget.com:80"), toProxy: true }, { url: google });
            assert.strictEqual(outgoing.path, "/" + google);
        });
        it("should not replace :\ to :\\ when no http word before", () => {
            let outgoing = {}, google = "http://google.com:/join/join.js";
            shared.setupOutgoing(outgoing, { target: url.parse("http://sometarget.com:80"), toProxy: true }, { url: google });
            assert.strictEqual(outgoing.path, "/" + google);
        });
        describe("when using ignorePath", () => {
            it("should ignore the path of the `req.url` passed in but use the target path", () => {
                let outgoing = {}, myEndpoint = "https://whatever.com/some/crazy/path/whoooo";
                shared.setupOutgoing(outgoing, { target: url.parse(myEndpoint), ignorePath: true }, { url: "/more/crazy/pathness" });
                assert.strictEqual(outgoing.path, "/some/crazy/path/whoooo");
            });
            it("and prependPath: false, it should ignore path of target and incoming request", () => {
                let outgoing = {}, myEndpoint = "https://whatever.com/some/crazy/path/whoooo";
                shared.setupOutgoing(outgoing, { target: url.parse(myEndpoint), ignorePath: true, prependPath: false }, { url: "/more/crazy/pathness" });
                assert.strictEqual(outgoing.path, '');
            });
        });
        describe("when using changeOrigin", () => {
            it("should correctly set the port to the host when it is a non-standard port using url.parse", () => {
                let outgoing = {}, myEndpoint = "https://myCouch.com:6984";
                shared.setupOutgoing(outgoing, { target: url.parse(myEndpoint), changeOrigin: true }, { url: "/" });
                assert.strictEqual(outgoing.headers.host, "mycouch.com:6984");
            });
            it("should correctly set the port to the host when it is a non-standard port when setting host and port manually (which ignores port)", () => {
                let outgoing = {};
                shared.setupOutgoing(outgoing, { target: { protocol: "https:", host: "mycouch.com", port: 6984 }, changeOrigin: true }, { url: "/" });
                assert.strictEqual(outgoing.headers.host, "mycouch.com:6984");
            });
        });
        it("should pass through https client parameters", () => {
            let outgoing = {};
            shared.setupOutgoing(outgoing,
                {
                    agent     : "?",
                    target: {
                        host      : "how",
                        hostname  : "are",
                        socketPath: "you",
                        protocol  : "https:",
                        pfx       : "my-pfx",
                        key       : "my-key",
                        passphrase: "my-passphrase",
                        cert      : "my-cert",
                        ca        : "my-ca",
                        ciphers   : "my-ciphers",
                        secureProtocol: "my-secure-protocol"
                    }
                },
                {
                    method     : "i",
                    url        : "am"
                });

            assert.strictEqual(outgoing.pfx, "my-pfx");
            assert.strictEqual(outgoing.key, "my-key");
            assert.strictEqual(outgoing.passphrase, "my-passphrase");
            assert.strictEqual(outgoing.cert, "my-cert");
            assert.strictEqual(outgoing.ca, "my-ca");
            assert.strictEqual(outgoing.ciphers, "my-ciphers");
            assert.strictEqual(outgoing.secureProtocol, "my-secure-protocol");
        });
        it("should handle overriding the `method` of the http request", () => {
            let outgoing = {};
            shared.setupOutgoing(outgoing, {
                target: url.parse("https://whooooo.com"),
                method: "POST" ,
            }, { method: "GET", url: '' });
            assert.strictEqual(outgoing.method, "POST");
        });
        it("should not pass null as last arg to #urlJoin", () => {
            let outgoing = {};
            shared.setupOutgoing(outgoing, { target: { path: '' } }, { url : '' });
            assert.strictEqual(outgoing.path, '');
        });
        describe("set up socket", () => {
            it("should setup a socket", () => {
                let socketConfig = { timeout: null, nodelay: false, keepalive: false },
                    stubSocket = {
                        setTimeout: num => {
                            socketConfig.timeout = num;
                        },
                        setNoDelay: bol => {
                            socketConfig.nodelay = bol;
                        },
                        setKeepAlive: bol => {
                            socketConfig.keepalive = bol;
                        }
                    };
                returnValue = shared.setupSocket(stubSocket);

                assert.strictEqual(socketConfig.timeout, 0);
                assert.strictEqual(socketConfig.nodelay, true);
                assert.strictEqual(socketConfig.keepalive, true);
            });
        });
    });
});
