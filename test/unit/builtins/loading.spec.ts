import * as tstl from "../../../src";
import { unsupportedProperty } from "../../../src/transformation/utils/diagnostics";
import * as util from "../../util";

describe("luaLibImport", () => {
    test("inline", () => {
        util.testExpression`[0].indexOf(1)`
            .setOptions({ luaLibImport: tstl.LuaLibImportKind.Inline })
            .tap(builder => expect(builder.getMainLuaCodeChunk()).not.toContain('require("lualib_bundle")'))
            .expectToMatchJsResult();
    });

    test("require", () => {
        util.testExpression`[0].indexOf(1)`
            .setOptions({ luaLibImport: tstl.LuaLibImportKind.Require })
            .tap(builder => expect(builder.getMainLuaCodeChunk()).toContain('require("lualib_bundle")'))
            .expectToMatchJsResult();
    });

    test("always", () => {
        util.testModule``
            .setOptions({ luaLibImport: tstl.LuaLibImportKind.Always })
            .tap(builder => expect(builder.getMainLuaCodeChunk()).toContain('require("lualib_bundle")'))
            .expectToEqual(undefined);
    });
});

test.each([tstl.LuaLibImportKind.Inline, tstl.LuaLibImportKind.None, tstl.LuaLibImportKind.Require])(
    "should not include lualib without code (%p)",
    luaLibImport => {
        util.testModule``.setOptions({ luaLibImport }).tap(builder => expect(builder.getMainLuaCodeChunk()).toBe(""));
    }
);

test("lualib should not include tstl header", () => {
    util.testExpression`[0].push(1)`.tap(builder =>
        expect(builder.getMainLuaCodeChunk()).not.toContain("Generated with")
    );
});

describe("Unknown builtin property", () => {
    test("access", () => {
        util.testExpression`Math.unknownProperty`
            .disableSemanticCheck()
            .expectDiagnosticsToMatchSnapshot([unsupportedProperty.code]);
    });
});
