
Because http-proxy maintainer no longer fix issues.

Issues:

- fix a memory leak when client closes connection prematurely

web.in.js
```diff
- (options.buffer || req).pipe(forwardReq);
+ pipeline(options.buffer || req, forwardReq, () => {});
- proxyRes.pipe(res);
+ pipeline(proxyRes, res, () => {});
```

- fix a memory leak when close stream type req

web.in.js
```diff
- req.on("aborted", function() {
-   proxyReq.abort();
- });
+ req.on("close", function() {
+   if (!res.writableFinished)
+     proxyReq.destroy();
+ });

```

- Fix websocket socket close before response

ws.in.js
```diff
- if (!res.upgrade) {
+ if (!res.upgrade && socket.readyState !== "closed") {
    socket.write(createHttpHeader('HTTP/' + res.httpVersion + ' ' + res.statusCode + ' ' + res.statusMessage, res.headers));
    res.pipe(socket);
  }
```
