import * as ts from "typescript";
import * as tstl from "../../src";
import { TSTLErrors } from "../../src/TSTLErrors";
import * as util from "../util";

describe("module import/export elision", () => {
    const moduleDeclaration = `
        declare module "module" {
            export type Type = string;
            export declare const value: string;
        }
    `;

    const expectToElideImport: util.TapCallback = builder => {
        builder.addExtraFile("module.d.ts", moduleDeclaration).options({ module: ts.ModuleKind.CommonJS });
        expect(builder.getLuaExecutionResult()).not.toBeInstanceOf(util.ExecutionError);
    };

    test("should elide named type imports", () => {
        util.testModule`
            import { Type } from "module";
            const foo: Type = "bar";
        `.tap(expectToElideImport);
    });

    test("should elide named value imports used only as a type", () => {
        util.testModule`
            import { value } from "module";
            const foo: typeof value = "bar";
        `.tap(expectToElideImport);
    });

    test("should elide namespace imports with unused values", () => {
        util.testModule`
            import * as module from "module";
            const foo: module.Type = "bar";
        `.tap(expectToElideImport);
    });

    test("should elide `import =` declarations", () => {
        util.testModule`
            import module = require("module");
            const foo: module.Type = "bar";
        `.tap(expectToElideImport);
    });

    test("should elide type exports", () => {
        util.testModule`
            declare const _G: any;
            _G.foo = true;
            type foo = boolean;
            export { foo };
        `.expectToEqual([]);
    });
});

test.each([
    "export { default } from '...'",
    "export { x as default } from '...';",
    "export { default as x } from '...';",
])("Export default keyword disallowed (%p)", exportStatement => {
    util.testFunction(exportStatement)
        .disableSemanticCheck()
        .expectToHaveDiagnosticOfError(TSTLErrors.UnsupportedDefaultExport(util.nodeStub));
});

test("defaultImport", () => {
    util.testModule`
        import Test from "test";
    `
        .disableSemanticCheck()
        .expectToHaveDiagnosticOfError(TSTLErrors.DefaultImportsNotSupported(util.nodeStub));
});

test.each(["ke-bab", "dollar$", "singlequote'", "hash#", "s p a c e", "ɥɣɎɌͼƛಠ", "_̀ः٠‿"])(
    "Import module names with invalid lua identifier characters (%p)",
    name => {
        util.testModule`
            import { foo } from "./${name}";
            export { foo };
        `
            .disableSemanticCheck()
            .luaHeader(`setmetatable(package.loaded, { __index = function() return { foo = "bar" } end })`)
            .export("foo")
            .expectToEqual("bar");
    }
);

test("lualibRequire", () => {
    util.testExpression`b instanceof c`
        .options({ luaLibImport: tstl.LuaLibImportKind.Require, luaTarget: tstl.LuaTarget.LuaJIT })
        .disableSemanticCheck()
        .tap(builder => expect(builder.getMainLuaCodeChunk()).toContain(`require("lualib_bundle")`));
});

test("lualibRequireAlways", () => {
    util.testModule``
        .options({ luaLibImport: tstl.LuaLibImportKind.Always, luaTarget: tstl.LuaTarget.LuaJIT })
        .tap(builder => expect(builder.getMainLuaCodeChunk()).toContain(`require("lualib_bundle")`));
});

test.each([tstl.LuaLibImportKind.Inline, tstl.LuaLibImportKind.None, tstl.LuaLibImportKind.Require])(
    "LuaLib no uses? No code (%p)",
    luaLibImport => {
        util.testModule``.options({ luaLibImport }).tap(builder => expect(builder.getMainLuaCodeChunk()).toBe(""));
    }
);

test("Non-exported module", () => {
    const result = util.transpileAndExecute(
        "return g.test();",
        undefined,
        undefined,
        "module g { export function test() { return 3; } }"
    );

    expect(result).toBe(3);
});

test("Nested module with dot in name", () => {
    const code = `module a.b {
            export const foo = "foo";
        }`;
    expect(util.transpileAndExecute("return a.b.foo;", undefined, undefined, code)).toBe("foo");
});

test("Access this in module", () => {
    const header = `
        module M {
            export const foo = "foo";
            export function bar() { return this.foo + "bar"; }
        }
    `;
    const code = `return M.bar();`;
    expect(util.transpileAndExecute(code, undefined, undefined, header)).toBe("foobar");
});

test("Module merged with interface", () => {
    const header = `
        interface Foo {}
        module Foo {
            export function bar() { return "foobar"; }
        }`;
    const code = `return Foo.bar();`;
    expect(util.transpileAndExecute(code, undefined, undefined, header)).toBe("foobar");
});
