function __TS__ArrayJoin(this: void, arr: any[], separator = ",") {
    const parts: string[] = [];
    for (const i of $range(1, arr.length)) {
        parts[i - 1] = arr[i - 1].toString();
    }
    return table.concat(parts, separator);
}
