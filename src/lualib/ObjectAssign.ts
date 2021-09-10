// https://tc39.github.io/ecma262/#sec-object.assign
// eslint-disable-next-line @typescript-eslint/ban-types
function __TS__ObjectAssign<T extends object>(this: void, sources: object[]): T {
    const to = sources[0] as T;
    if (to === undefined) {
        return;
    }

    for (const i of $range(2, sources.length)) {
        const source = sources[i - 1];
        for (const key in source) {
            to[key] = source[key];
        }
    }

    return to;
}
