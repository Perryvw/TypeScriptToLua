// https://www.ecma-international.org/ecma-262/9.0/index.html#sec-array.prototype.slice
function __TS__ArraySlice<T>(this: void, list: T[], first?: number, last?: number): T[] {
    const len = list.length;

    first = first ?? 0;
    if (first < 0) {
        first = len + first;
        if (first < 0) {
            first = 0;
        }
    } else {
        if (first > len) {
            first = len;
        }
    }

    last = last ?? len;
    if (last < 0) {
        last = len + last;
        if (last < 0) {
            last = 0;
        }
    } else {
        if (last > len) {
            last = len;
        }
    }

    const out = [];

    first++;
    last++;
    let n = 1;
    while (first < last) {
        out[n - 1] = list[first - 1];
        first++;
        n++;
    }
    return out;
}
