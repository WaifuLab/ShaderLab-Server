const { stdout } = require("node:process");
const { captureStream } = require("../utils/capture.js");
const assert = require("node:assert");

describe("Capture test", () => {
    describe("import target module test", () => {
        it("should use default export", () => {
            const defaultExport = require("../utils/capture.js");
            assert.strictEqual(typeof defaultExport, "function");
        });
        it("should use named export", () => {
            assert.strictEqual(typeof captureStream, "function");
        });
    });
    describe("capture stream test", () => {
        let hook;
        beforeEach(() => hook = captureStream(stdout));
        afterEach(() => hook.unhook());
        it("should get stream from console", () => {
            console.log("foobar");
            const capture = hook.captured();
            assert(capture.includes("foobar"));
        });
        it("should get complex stream from console", () => {
            console.log("   hello world,\n  \n, foo bar   ");
            const capture = hook.captured();
            assert(capture.includes("hello world"));
            assert(capture.includes("foo bar"));
        });
    });
});
