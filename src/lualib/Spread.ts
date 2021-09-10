function __TS__Spread<T>(this: void, iterable: string | Iterable<T>): LuaMultiReturn<T[]> {
    const arr = [];
    if (typeof iterable === "string") {
        // eslint-disable-next-line @typescript-eslint/prefer-for-of
        for (const i of $range(0, iterable.length - 1)) {
            arr[i] = iterable[i];
        }
    } else {
        let len = 0;
        for (const item of iterable) {
            len++;
            arr[len - 1] = item;
        }
    }
    return $multi(...arr);
}
