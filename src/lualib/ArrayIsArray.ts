declare type NextEmptyCheck = (this: void, table: any, index?: undefined) => unknown | undefined;

function __TS__ArrayIsArray(this: void, value: any): value is any[] {
    // Workaround to determine if value is an array or not (fails in case of objects without keys)
    // See discussion in: https://github.com/TypeScriptToLua/TypeScriptToLua/pull/737
    return type(value) === "table" && (1 in value || (next as NextEmptyCheck)(value) === undefined);
}
