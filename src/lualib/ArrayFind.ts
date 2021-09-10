// https://www.ecma-international.org/ecma-262/10.0/index.html#sec-array.prototype.find
function __TS__ArrayFind<T>(
    this: void,
    arr: T[],
    predicate: (value: T, index: number, obj: T[]) => unknown,
    thisArg?: any
): T | undefined {
    for (const i of $range(1, arr.length)) {
        const elem = arr[i - 1];
        if (predicate.call(thisArg, elem, i - 1, arr)) {
            return elem;
        }
    }

    return undefined;
}
