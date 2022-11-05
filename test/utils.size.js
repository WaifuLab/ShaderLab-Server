const { formatSize, toNumber, toSize } = require("../utils/size.js");
const assert = require("node:assert");

describe("Size test", () => {
    describe("import target module test", () => {
        it("should use default export", () => {
            const defaultExport = require("../utils/size.js");
            assert.strictEqual(typeof defaultExport, "function");
        });
        it("should use named export", () => {
            assert.strictEqual(typeof formatSize, "function");
        });
    });
    describe("format size test", () => {
        const pb = Math.pow(1024, 5);
        const tb = (1 << 30) * 1024, gb = 1 << 30, mb = 1 << 20, kb = 1 << 10;
        it("should return null if input is invalid", () => {
            [undefined, null, true, false, NaN, () => {}, {}, "foobar"].forEach(type => {
                assert.strictEqual(formatSize(type), null);
            });
        });
        describe("format size string to number", () => {
            it("should return null if input is invalid", () => {
                [undefined, null, true, false, NaN, () => {}, {}, "foobar"].forEach(type => {
                    assert.strictEqual(toNumber(type), null);
                });
            });
            it("should parse raw number", () => {
                assert.strictEqual(toNumber(0), 0);
                assert.strictEqual(toNumber(-1), -1);
                assert.strictEqual(toNumber(1), 1);
                assert.strictEqual(toNumber(10.5), 10.5);
            });
            it("should parse KB", () => {
                assert.strictEqual(toNumber("1kb"), Math.pow(1024, 1));
                assert.strictEqual(toNumber("1KB"), Math.pow(1024, 1));
                assert.strictEqual(toNumber("1Kb"), Math.pow(1024, 1));
                assert.strictEqual(toNumber("1kB"), Math.pow(1024, 1));
                assert.strictEqual(toNumber("0.5kb"), 0.5 * Math.pow(1024, 1));
                assert.strictEqual(toNumber("0.5KB"), 0.5 * Math.pow(1024, 1));
                assert.strictEqual(toNumber("0.5Kb"), 0.5 * Math.pow(1024, 1));
                assert.strictEqual(toNumber("0.5kB"), 0.5 * Math.pow(1024, 1));
                assert.strictEqual(toNumber("1.5kb"), 1.5 * Math.pow(1024, 1));
                assert.strictEqual(toNumber("1.5KB"), 1.5 * Math.pow(1024, 1));
                assert.strictEqual(toNumber("1.5Kb"), 1.5 * Math.pow(1024, 1));
                assert.strictEqual(toNumber("1.5kB"), 1.5 * Math.pow(1024, 1));
            });
            it("should parse MB", () => {
                assert.strictEqual(toNumber("1mb"), Math.pow(1024, 2));
                assert.strictEqual(toNumber("1MB"), Math.pow(1024, 2));
                assert.strictEqual(toNumber("1Mb"), Math.pow(1024, 2));
                assert.strictEqual(toNumber("1mB"), Math.pow(1024, 2));
            });
            it("should parse GB", () => {
                assert.strictEqual(toNumber("1gb"), Math.pow(1024, 3));
                assert.strictEqual(toNumber("1GB"), Math.pow(1024, 3));
                assert.strictEqual(toNumber("1Gb"), Math.pow(1024, 3));
                assert.strictEqual(toNumber("1gB"), Math.pow(1024, 3));
            });
            it("should parse TB", () => {
                assert.strictEqual(toNumber("1tb"), Math.pow(1024, 4));
                assert.strictEqual(toNumber("1TB"), Math.pow(1024, 4));
                assert.strictEqual(toNumber("1Tb"), Math.pow(1024, 4));
                assert.strictEqual(toNumber("1tB"), Math.pow(1024, 4));
                assert.strictEqual(toNumber("0.5tb"), 0.5 * Math.pow(1024, 4));
                assert.strictEqual(toNumber("0.5TB"), 0.5 * Math.pow(1024, 4));
                assert.strictEqual(toNumber("0.5Tb"), 0.5 * Math.pow(1024, 4));
                assert.strictEqual(toNumber("0.5tB"), 0.5 * Math.pow(1024, 4));
                assert.strictEqual(toNumber("1.5tb"), 1.5 * Math.pow(1024, 4));
                assert.strictEqual(toNumber("1.5TB"), 1.5 * Math.pow(1024, 4));
                assert.strictEqual(toNumber("1.5Tb"), 1.5 * Math.pow(1024, 4));
                assert.strictEqual(toNumber("1.5tB"), 1.5 * Math.pow(1024, 4));
            });
            it("should parse PB", () => {
                assert.strictEqual(toNumber("1pb"), Math.pow(1024, 5));
                assert.strictEqual(toNumber("1PB"), Math.pow(1024, 5));
                assert.strictEqual(toNumber("1Pb"), Math.pow(1024, 5));
                assert.strictEqual(toNumber("1pB"), Math.pow(1024, 5));
                assert.strictEqual(toNumber("0.5pb"), 0.5 * Math.pow(1024, 5));
                assert.strictEqual(toNumber("0.5PB"), 0.5 * Math.pow(1024, 5));
                assert.strictEqual(toNumber("0.5Pb"), 0.5 * Math.pow(1024, 5));
                assert.strictEqual(toNumber("0.5pB"), 0.5 * Math.pow(1024, 5));
                assert.strictEqual(toNumber("1.5pb"), 1.5 * Math.pow(1024, 5));
                assert.strictEqual(toNumber("1.5PB"), 1.5 * Math.pow(1024, 5));
                assert.strictEqual(toNumber("1.5Pb"), 1.5 * Math.pow(1024, 5));
                assert.strictEqual(toNumber("1.5pB"), 1.5 * Math.pow(1024, 5));
            });
            it("should assume bytes when no units", () => {
                assert.strictEqual(toNumber("0"), 0);
                assert.strictEqual(toNumber("-1"), -1);
                assert.strictEqual(toNumber("1024"), 1024);
                assert.strictEqual(toNumber("0x11"), 0);
            });
            it("should accept negative values", () => {
                assert.strictEqual(toNumber("-1"), -1);
                assert.strictEqual(toNumber("-1024"), -1024);
                assert.strictEqual(toNumber("-1.5TB"), -1.5 * Math.pow(1024, 4));
            });
            it("should drop partial bytes", () => {
                assert.strictEqual(toNumber("1.1b"), 1);
                assert.strictEqual(toNumber("1.0001kb"), 1024);
            });
            it("should allow whitespace", () => {
                assert.strictEqual(toNumber("1 TB"), Math.pow(1024, 4));
            });
        });
        describe("format size number to string", () => {
            it("should return null if input is invalid", () => {
                [undefined, null, true, false, NaN, Infinity, '', "string", () => {}, {}].forEach(type => {
                    assert.strictEqual(toSize(type), null);
                });
            });
            it("should convert numbers < 1024 to bytes string", () => {
                assert.strictEqual(toSize(0).toLowerCase(), "0b");
                assert.strictEqual(toSize(100).toLowerCase(), "100b");
                assert.strictEqual(toSize(-100).toLowerCase(), "-100b");
            });
            it("should convert numbers >= 1 024 to kb string", () => {
                assert.strictEqual(toSize(kb).toLowerCase(), "1kb");
                assert.strictEqual(toSize(-kb).toLowerCase(), "-1kb");
                assert.strictEqual(toSize(2 * kb).toLowerCase(), "2kb");
            });
            it("should convert numbers >= 1 048 576 to mb string", () => {
                assert.strictEqual(toSize(mb).toLowerCase(), "1mb");
                assert.strictEqual(toSize(-mb).toLowerCase(), "-1mb");
                assert.strictEqual(toSize(2 * mb).toLowerCase(), "2mb");
            });
            it("should convert numbers >= (1 << 30) to gb string", () => {
                assert.strictEqual(toSize(gb).toLowerCase(), "1gb");
                assert.strictEqual(toSize(-gb).toLowerCase(), "-1gb");
                assert.strictEqual(toSize(2 * gb).toLowerCase(), "2gb");
            });
            it("should convert numbers >= ((1 << 30) * 1024) to tb string", () => {
                assert.strictEqual(toSize(tb).toLowerCase(), "1tb");
                assert.strictEqual(toSize(-tb).toLowerCase(), "-1tb");
                assert.strictEqual(toSize(2 * tb).toLowerCase(), "2tb");
            });
            it("should convert numbers >= 1 125 899 906 842 624 to pb string", () => {
                assert.strictEqual(toSize(pb).toLowerCase(), "1pb");
                assert.strictEqual(toSize(-pb).toLowerCase(), "-1pb");
                assert.strictEqual(toSize(2 * pb).toLowerCase(), "2pb");
            });
            it("should return standard case", () => {
                assert.strictEqual(toSize(10), "10B");
                assert.strictEqual(toSize(kb), "1KB");
                assert.strictEqual(toSize(mb), "1MB");
                assert.strictEqual(toSize(gb), "1GB");
                assert.strictEqual(toSize(tb), "1TB");
                assert.strictEqual(toSize(pb), "1PB");
            });
        });
        describe("format size options", () => {
            it("should support custom thousands separator", () => {
                assert.strictEqual(formatSize(1000).toLowerCase(), "1000b");
                assert.strictEqual(formatSize(1000, { thousandsSeparator: '' }).toLowerCase(), "1000b");
                assert.strictEqual(formatSize(1000, { thousandsSeparator: null }).toLowerCase(), "1000b");
                assert.strictEqual(formatSize(1000, { thousandsSeparator: "." }).toLowerCase(), "1.000b");
                assert.strictEqual(formatSize(1000, { thousandsSeparator: "," }).toLowerCase(), "1,000b");
                assert.strictEqual(formatSize(1000, { thousandsSeparator: " " }).toLowerCase(), "1 000b");
                assert.strictEqual(formatSize(1005.1005 * kb, { decimalPlaces: 4, thousandsSeparator: "_" }).toLowerCase(), "1_005.1005kb");
            });
            it("should support custom unit separator", () => {
                assert.strictEqual(formatSize(1024), "1KB");
                assert.strictEqual(formatSize(1024, { unitSeparator: '' }), "1KB");
                assert.strictEqual(formatSize(1024, { unitSeparator: " " }), "1 KB");
                assert.strictEqual(formatSize(1024, { unitSeparator: "\t" }), "1\tKB");
            });
            it("should support custom number of decimal places", () => {
                assert.strictEqual(formatSize(kb - 1, { decimalPlaces: 0 }).toLowerCase(), "1023b");
                assert.strictEqual(formatSize(kb, { decimalPlaces: 0 }).toLowerCase(), "1kb");
                assert.strictEqual(formatSize(1.4 * kb, { decimalPlaces: 0 }).toLowerCase(), "1kb");
                assert.strictEqual(formatSize(1.5 * kb, { decimalPlaces: 0 }).toLowerCase(), "2kb");
                assert.strictEqual(formatSize(kb - 1, { decimalPlaces: 1 }).toLowerCase(), "1023b");
                assert.strictEqual(formatSize(kb, { decimalPlaces: 1 }).toLowerCase(), "1kb");
                assert.strictEqual(formatSize(1.04 * kb, { decimalPlaces: 1 }).toLowerCase(), "1kb");
                assert.strictEqual(formatSize(1.05 * kb, { decimalPlaces: 1 }).toLowerCase(), "1.1kb");
                assert.strictEqual(formatSize(1.1005 * kb, { decimalPlaces: 4 }).toLowerCase(), "1.1005kb");
            });
            it("should support fixed decimal places", () => {
                assert.strictEqual(formatSize(kb, { decimalPlaces: 3, fixedDecimals: true }).toLowerCase(), "1.000kb");
            });
            it("should support floats", () => {
                assert.strictEqual(formatSize(1.2 * mb).toLowerCase(), "1.2mb");
                assert.strictEqual(formatSize(-1.2 * mb).toLowerCase(), "-1.2mb");
                assert.strictEqual(formatSize(1.2 * kb).toLowerCase(), "1.2kb");
            });
            it("should support custom unit", () => {
                assert.strictEqual(formatSize(12 * mb, { unit: "b" }).toLowerCase(), "12582912b");
                assert.strictEqual(formatSize(12 * mb, { unit: "kb" }).toLowerCase(), "12288kb");
                assert.strictEqual(formatSize(12 * gb, { unit: "mb" }).toLowerCase(), "12288mb");
                assert.strictEqual(formatSize(12 * tb, { unit: "gb" }).toLowerCase(), "12288gb");
                assert.strictEqual(formatSize(12 * mb, { unit: '' }).toLowerCase(), "12mb");
                assert.strictEqual(formatSize(12 * mb, { unit: "bb" }).toLowerCase(), "12mb");
            });
        });
    });
});
