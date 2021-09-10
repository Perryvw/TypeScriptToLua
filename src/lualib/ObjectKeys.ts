function __TS__ObjectKeys(this: void, obj: any): Array<string | number> {
    const result = [];
    let len = 0;
    for (const key in obj) {
        len++;
        result[len - 1] = key;
    }
    return result;
}
