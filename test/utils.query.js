const { highlight } = require("../utils/query.js");
const assert = require("node:assert");

describe("Query test", () => {
    describe("import target module test", () => {
        it("should use default export", () => {
            const defaultExport = require("../utils/query.js");
            assert.strictEqual(typeof defaultExport, "function");
        });
        it("should use named export", () => {
            assert.strictEqual(typeof highlight, "function");
        });
    });
    describe("highlight query test", () => {
        it("should return not format unknown words", () => {
            assert.strictEqual(
                highlight("select * from invalid_?_operation"),
                "\x1B[35mselect\x1B[0m \x1B[33m*\x1B[0m \x1B[35mfrom\x1B[0m invalid_?_operation"
            );
        });
        it("should return colored uppercase", () => {
            assert.strictEqual(
                highlight("SELECT `users`.* FROM `users`"),
                "\x1B[35mSELECT\x1B[0m \x1B[32m`users`\x1B[0m.\x1B[33m*\x1B[0m \x1B[35mFROM\x1B[0m \x1B[32m`users`\x1B[0m"
            );
        });
        it("should return colored lowercase", () => {
            assert.strictEqual(
                highlight("select `users`.* from `users`"),
                "\x1B[35mselect\x1B[0m \x1B[32m`users`\x1B[0m.\x1B[33m*\x1B[0m \x1B[35mfrom\x1B[0m \x1B[32m`users`\x1B[0m"
            );
        });
        it("should return colored complex", () => {
            assert.strictEqual(
                highlight("SELECT COUNT(id), COUNT(id), `id`, `username` FROM `users` WHERE `email` = 'test@example.com' AND `something` = 'oke' AND 1=1"),
                "\x1B[35mSELECT\x1B[0m \x1B[31mCOUNT\x1B[0m\x1B[33m(\x1B[0mid\x1B[33m)\x1B[0m\x1B[33m,\x1B[0m \x1B[31mCOUNT\x1B[0m\x1B[33m(\x1B[0mid\x1B[33m)\x1B[0m\x1B[33m,\x1B[0m \x1B[32m`id`\x1B[0m\x1B[33m,\x1B[0m \x1B[32m`username`\x1B[0m \x1B[35mFROM\x1B[0m \x1B[32m`users`\x1B[0m \x1B[35mWHERE\x1B[0m \x1B[32m`email`\x1B[0m \x1B[33m=\x1B[0m \x1B[32m'test@example.com'\x1B[0m \x1B[35mAND\x1B[0m \x1B[32m`something`\x1B[0m \x1B[33m=\x1B[0m \x1B[32m'oke'\x1B[0m \x1B[35mAND\x1B[0m \x1B[32m1\x1B[0m\x1B[33m=\x1B[0m\x1B[32m1\x1B[0m"
            );
        });
        it("should return colored special", () => {
            assert.strictEqual(
                highlight("SELECT id FROM users WHERE status = 'not available'"),
                "\x1B[35mSELECT\x1B[0m id \x1B[35mFROM\x1B[0m users \x1B[35mWHERE\x1B[0m status \x1B[33m=\x1B[0m \x1B[32m'not available'\x1B[0m"
            );
        });
    });
});
