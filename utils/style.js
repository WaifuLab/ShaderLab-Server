const styles = {
    bold:       (msg, end = "[22m") => `\x1b[1m${msg}\x1b${end}`,
    italic:     (msg, end = "[23m") => `\x1b[3m${msg}\x1b${end}`,
    underline:  (msg, end = "[24m") => `\x1b[4m${msg}\x1b${end}`,
    inverse:    (msg, end = "[27m") => `\x1b[7m${msg}\x1b${end}`,
}

const colors = {
    white:      (msg, end = "[39m") => `\x1b[37m${msg}\x1b${end}`,
    grey:       (msg, end = "[39m") => `\x1b[90m${msg}\x1b${end}`,
    black:      (msg, end = "[39m") => `\x1b[30m${msg}\x1b${end}`,
    blue:       (msg, end = "[39m") => `\x1b[34m${msg}\x1b${end}`,
    cyan:       (msg, end = "[39m") => `\x1b[36m${msg}\x1b${end}`,
    green:      (msg, end = "[39m") => `\x1b[32m${msg}\x1b${end}`,
    magenta:    (msg, end = "[39m") => `\x1b[35m${msg}\x1b${end}`,
    red:        (msg, end = "[39m") => `\x1b[31m${msg}\x1b${end}`,
    yellow:     (msg, end = "[39m") => `\x1b[33m${msg}\x1b${end}`,
}

module.exports = {
    reset: '\x1b[0m',
    styles,
    colors
}
