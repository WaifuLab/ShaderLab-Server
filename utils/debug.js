const { styles, colors } = require("./style.js");

/**
 * The levels of logs.
 * @type {{log: number, info: number, warn: number, noLog: number}|{}}
 */
var levels = (levels => {
    levels[levels["log"] = 3] = "log";
    levels[levels["info"] = 2] = "info";
    levels[levels["warn"] = 1] = "warn";
    levels[levels["noLog"] = 0] = "noLog";
    return levels;
})(levels || (levels = {}));

let levelCache = levels[process.env["DEBUG_LEVEL"]] ??
                 process.env["NODE_ENV"] !== "production" ? levels.log : levels.info;

/**
 * leveled log.
 * @param {number} logLevel
 * @param {string[]|string} msg
 */
function leveled(logLevel, ...msg) {
    if (logLevel > levelCache) return;
    console.log(...msg);
}

/**
 * leveled the message and log.
 * @param {number} logLevel
 * @param {function} callback
 * @param {string[]|string} messages
 */
function leveledMsg(logLevel, callback, ...messages) {
    if (messages.length > 1) {
        for (let i = 0; i < messages.length; i++) {
            switch (typeof messages[i]) {
                case "object":
                    messages[i] = callback(JSON.stringify(messages[i]));
                    break;
                case "function":
                    messages[i] = callback(messages[i].name ? `[Function ${messages[i].name}]` : "[Anonymous Function]");
                    break;
                default:
                    messages[i] = callback(messages[i]);
                    break;
            }
        }
        leveled(logLevel, ...messages);
    } else {
        leveled(logLevel, callback(messages));
    }
}

const debug = {
    levels,

    /**
     * Get the log level.
     * @return {number}
     */
    get level() {
        return levelCache;
    },

    /**
     * Set the level to use.
     * @param {number} logLevel
     */
    set level(logLevel) {
        levelCache = logLevel;
    },

    /**
     * Log common messages.
     * @param {string|string[]} msg
     */
    log(...msg) {
        leveled(levels.log, ...msg);
    },

    /**
     * Log info messages.
     * @param {string|string[]} msg
     */
    info(...msg) {
        leveled(levels.info, styles.bold(colors.yellow("[Info]")), ...msg);
    },

    /**
     * Log warn messages.
     * @param {string|string[]} msg
     */
    warn(...msg) {
        leveled(levels.warn, styles.bold(colors.red("[Warn]")), ...msg);
    },

    highlight: require("./query.js")
};

Object.entries(styles).forEach(([style, callback]) => {
    debug.log[style] = (...msg) => leveledMsg(levels.log, callback, ...msg);
    Object.entries(colors).forEach(([color, callback]) =>
        debug.log[style][color] = (...msg) => leveledMsg(levels.log, msg => styles[style](callback(msg)), ...msg));
});
Object.entries(colors).forEach(([color, callback]) =>
    debug.log[color] = (...msg) => leveledMsg(levels.log, callback, ...msg));

module.exports = debug;
module.exports.debug = debug;
