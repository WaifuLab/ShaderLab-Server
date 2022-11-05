const config = require("../config/sql.js");

/**
 * Highlight query string.
 * @param {string} sql
 * @return {string}
 */
function highlight(sql) {
    const matches = [];

    for (const rule of config.rules) {
        let match;
        while (match = rule.regex.exec(sql)) {
            let text = match[0], boringLength = 0;

            // If a specific group is requested, use that group instead, and make sure we offset the index by the length of the preceding groups
            if (rule.group) {
                text = match[rule.group + 1]
                for (let i = 1; i <= rule.group; i++) {
                    boringLength += match[i].length;
                }
            }

            matches.push({
                name: rule.name,
                start: match.index + boringLength,
                length: (rule.trimEnd ? text.slice(0, -rule.trimEnd) : text).length,
                style: rule.style
            });
        }
    }

    const sortedMatches = matches.slice().sort((a, b) => a.start - b.start)

    // filter/exclude nested matches (matches within the last match)
    const filteredMatches = [];
    let upperBound = 0, highlighted = '';
    for (let i = 0; i < sortedMatches.length; i++) {
        if (sortedMatches[i].start >= upperBound) {
            filteredMatches.push(sortedMatches[i]);
            upperBound = sortedMatches[i].start + sortedMatches[i].length;
        }
    }

    for (let i = 0; i < filteredMatches.length; i++) {
        const match = filteredMatches[i], nextMatch = filteredMatches[i + 1];
        const stringMatch = sql.substring(match.start, match.start + match.length);

        highlighted += match.style(stringMatch);

        if (!!nextMatch) {
            highlighted += sql.substring(match.start + match.length, nextMatch.start)
        } else if (sql.length > (match.start + match.length)) {
            highlighted += sql.substring(match.start + match.length)
        }
    }

    return highlighted;
}

module.exports = highlight;
module.exports.highlight = highlight;
