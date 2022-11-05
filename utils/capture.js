/**
 * Capture a part of stream.
 * @param {Stream} stream
 * @return {{captured: (function(): string), unhook: unhook}}
 */
function captureStream(stream) {
    let oldWrite = stream.write, buf = '';
    stream.write = function(chunk, encoding, callback) {
        buf += chunk.toString(); // chunk is a String or Buffer
        oldWrite.apply(stream, arguments);
    }
    return {
        unhook: function unhook() {
            stream.write = oldWrite;
        },
        captured: function() {
            return buf.trim();
        }
    };
}

module.exports = captureStream;
module.exports.captureStream = captureStream;
