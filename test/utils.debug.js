const { debug } = require("../utils/debug.js");
const { styles, colors } = require("../utils/style.js")
const assert = require("node:assert");
const { captureStream } = require("../utils/capture.js");
const { stdout } = require("node:process");

describe("Debug test", () => {
    describe("import target module test", () => {
        it("should use default export", () => {
            const defaultExport = require("../utils/debug.js");
            assert.strictEqual(typeof defaultExport, "object");
        });
        it("should use named export", () => {
            assert.strictEqual(typeof debug, "object");
        });
    });
    describe("debug log test", () => {
        describe("log test", () => {
            let hook;
            beforeEach(() => hook = captureStream(stdout));
            afterEach(() => hook.unhook());
            it("should log a message", () => {
                debug.log("message");
                const capture = hook.captured();
                assert(capture.includes("message"));
            });
            it("should log multi message", () => {
                debug.log("messageA", "messageB");
                const capture = hook.captured();
                assert(capture.includes("messageA"));
                assert(capture.includes("messageB"));
            });
            it("should log multi message with object", () => {
                debug.log("messageA", "messageB", { subA: "messageSubA", subB: "messageSubB" });
                const capture = hook.captured();
                assert(capture.includes("messageA"));
                assert(capture.includes("messageB"));
                assert(capture.includes("messageSubA"));
                assert(capture.includes("messageSubB"));
            });
        });
        describe("styled log test", () => {
            Object.keys(styles).forEach(style => {
                it(`should log ${style} message`, () => {
                    debug.log[style]("message");
                });
                it(`should log multi ${style} message`, () => {
                    debug.log[style]("messageA", "messageB");
                });
                it(`should log multi ${style} message with object`, () => {
                    debug.log[style]("messageA", "messageB", { subA: "messageSubA", subB: "messageSubB" });
                });
            });
        });
        describe("colored log test", () => {
            Object.keys(colors).forEach(color => {
                it(`should log ${color} message`, () => {
                    debug.log[color]("message");
                });
                it(`should log multi ${color} message`, () => {
                    debug.log[color]("messageA", "messageB");
                });
                it(`should log multi ${color} message with object`, () => {
                    debug.log[color]("messageA", "messageB", { subA: "messageSubA", subB: "messageSubB" });
                });
            });
        });
        describe("styled and colored log test", () => {
            Object.keys(styles).forEach(style => {
                Object.keys(colors).forEach(color => {
                    it(`should log ${style} ${color} message`, () => {
                        debug.log[style][color]("message");
                    });
                    it(`should log multi ${style} ${color} message`, () => {
                        debug.log[style][color]("messageA", "messageB");
                    });
                    it(`should log multi ${style} ${color} message with object`, () => {
                        debug.log[style][color]("messageA", "messageB", { subA: "messageSubA", subB: "messageSubB" });
                    });
                    it(`should log multi ${style} ${color} message with anonymous function`, () => {
                        debug.log[style][color]("messageA", "messageB", function () { });
                    });
                    it(`should log multi ${style} ${color} message with function with name test`, () => {
                        debug.log[style][color]("messageA", "messageB", function test () { });
                    });
                });
            });
        });
        describe("debug level test", () => {
            ["log", "info", "warn", "noLog"].forEach(msg => {
                it(`should debug with ${msg} and level`, () => {
                    debug.level = debug.levels[msg];
                    debug.log(`level${debug.levels[msg]}, get debug level ${debug.levels[debug.level]}`);
                    debug.info(`level${debug.levels[msg]}, get debug level ${debug.levels[debug.level]}`);
                    debug.warn(`level${debug.levels[msg]}, get debug level ${debug.levels[debug.level]}`);
                });
            });
        });
    });
});
