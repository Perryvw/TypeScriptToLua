function __TS__ObjectEntries(this: void, obj: any): Array<string | number> {
    const result = [];
    let len = 0;
    for (const key in obj) {
        len++;
        result[len - 1] = [key, obj[key]];
    }
    return result;
}
