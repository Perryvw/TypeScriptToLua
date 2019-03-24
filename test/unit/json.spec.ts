import { transpileString } from "../../src/Compiler";
import { TranspileError } from "../../src/TranspileError";
import * as util from "../util";

test.each(["0", '""', "[]", '[1, "2", []]', '{ "a": "b" }', '{ "a": { "b": "c" } }'])(
    "JSON (%p)",
    json => {
        const lua = transpileString(
            json,
            { resolveJsonModule: true, noHeader: true },
            false,
            "file.json",
        ).replace(/^return ([\s\S]+);$/, "return JSONStringify($1);");

        const result = util.executeLua(lua);
        expect(JSON.parse(result)).toEqual(JSON.parse(json));
    },
);

test("Empty JSON", () => {
    expect(() =>
        transpileString("", { resolveJsonModule: true, noHeader: true }, false, "file.json"),
    ).toThrowWithMessage(TranspileError, "Invalid JSON file content");
});
