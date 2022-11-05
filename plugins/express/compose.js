/**
 * Default compose function.
 * @param {function[]} middleware
 * @return {function}
 */
function compose(middleware) {
    if (!Array.isArray(middleware))
        throw new TypeError("Middleware stack must be an array!");
    for (const func of middleware) {
        if (typeof func !== "function")
            throw new TypeError("Middleware must be composed of functions!");
    }
    return function(context, next) {
        // last called middleware #
        let index = -1;
        function dispatch (i) {
            if (i <= index) return Promise.reject(new Error("next() called multiple times"));
            index = i;
            let func = middleware[i];
            if (i === middleware.length) func = next;
            if (!func) return Promise.resolve();
            try {
                return Promise.resolve(func(context, dispatch.bind(null, i + 1)));
            } catch (err) {
                return Promise.reject(err);
            }
        }
        return dispatch(0);
    }
}

module.exports = compose;
