const FORMAT_THOUSANDS_REGEXP = /\B(?=(\d{3})+(?!\d))/g;
const FORMAT_DECIMALS_REGEXP = /(?:\.0*|(\.[^0]+)0+)$/;
const PARSE_REGEXP = /^(([-+])?(\d+(?:\.\d+)?)) *(kb|mb|gb|tb|pb)$/i;

const units = {
    b:  1,
    kb: 1 << 10,
    mb: 1 << 20,
    gb: 1 << 30,
    tb: Math.pow(1024, 4),
    pb: Math.pow(1024, 5),
};

/**
 * Covert input to value fit unit.
 * @param {string|number} value
 * @param {object} options
 * @return {string|number|null}
 */
function formatSize(value, options) {
    if (typeof value === "string") return toNumber(value);
    if (typeof value === "number") return toSize(value, options);
    return null;
}

/**
 * Format the given value in bytes into a string. If the value is negative, it is kept as such. If it is a float, it is rounded.
 * @param {number} value
 * @param {number} decimalPlaces
 * @param {boolean} fixedDecimals
 * @param {string} thousandsSeparator
 * @param {string} unit
 * @param {string} unitSeparator
 * @return {string|null}
 */
function toSize(value, {
    decimalPlaces = 2,
    fixedDecimals = false,
    thousandsSeparator = '',
    unit = '',
    unitSeparator = '',
} = {}) {
    if (!Number.isFinite(value)) return null;

    const mag = Math.abs(value);
    if (!unit || !units[unit.toLowerCase()]) {
        if (mag >= units.pb)
            unit = "PB";
        else if (mag >= units.tb)
            unit = "TB";
        else if (mag >= units.gb)
            unit = "GB";
        else if (mag >= units.mb)
            unit = "MB";
        else if (mag >= units.kb)
            unit = "KB";
        else
            unit = "B";
    }

    let str = (value / units[unit.toLowerCase()]).toFixed(decimalPlaces);
    if (!fixedDecimals)
        str = str.replace(FORMAT_DECIMALS_REGEXP, "$1");
    if (thousandsSeparator)
        str = str.split(".").map((s, i) => i === 0 ? s.replace(FORMAT_THOUSANDS_REGEXP, thousandsSeparator) : s).join(".");

    return str + unitSeparator + unit;
}

/**
 * Parse the string value into an integer in bytes. If no unit is given, it is assumed the value is in bytes.
 * @param {number|string} value
 * @return {number|null}
 */
function toNumber(value) {
    if (typeof value === "number" && !isNaN(value)) return value;
    if (typeof value !== "string") return null;

    // test if the string passed is valid
    const results = PARSE_REGEXP.exec(value);
    let floatValue, unit;

    if (!results) {
        // Nothing could be extracted from the given string
        floatValue = parseInt(value, 10);
        unit = "b"
    } else {
        // Retrieve the value and the unit
        floatValue = parseFloat(results[1]);
        unit = results[4].toLowerCase();
    }

    return isNaN(floatValue) ? null : Math.floor(units[unit] * floatValue);
}

module.exports = formatSize;
module.exports.formatSize = formatSize;
module.exports.toSize = toSize;
module.exports.toNumber = toNumber;
