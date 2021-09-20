import { SourceMapConsumer } from "source-map";
import * as tstl from "../../../src";
import { couldNotResolveRequire } from "../../../src/transpilation/diagnostics";
import * as util from "../../util";
import { lineAndColumnOf } from "./utils";

test.each([
    {
        code: `
            const abc = "foo";
            const def = "bar";

            const xyz = "baz";
        `,

        assertPatterns: [
            { luaPattern: "abc", typeScriptPattern: "abc" },
            { luaPattern: "def", typeScriptPattern: "def" },
            { luaPattern: "xyz", typeScriptPattern: "xyz" },
            { luaPattern: '"foo"', typeScriptPattern: '"foo"' },
            { luaPattern: '"bar"', typeScriptPattern: '"bar"' },
            { luaPattern: '"baz"', typeScriptPattern: '"baz"' },
        ],
    },
    {
        code: `
            function abc() {
                return def();
            }

            function def() {
                return "foo";
            }
        `,

        assertPatterns: [
            { luaPattern: "function abc(", typeScriptPattern: "function abc() {" },
            { luaPattern: "function def(", typeScriptPattern: "function def() {" },
            { luaPattern: "return def(", typeScriptPattern: "return def(" },
            { luaPattern: "end", typeScriptPattern: "function def() {" },
        ],
    },
    {
        code: `
            const enum abc { foo = 2, bar = 4 };
            const xyz = abc.foo;
        `,

        assertPatterns: [
            { luaPattern: "xyz", typeScriptPattern: "xyz" },
            { luaPattern: "2", typeScriptPattern: "abc.foo" },
        ],
    },
    {
        code: `
            // @ts-ignore
            import { Foo } from "foo";
            Foo;
        `,

        assertPatterns: [
            { luaPattern: 'require("foo")', typeScriptPattern: '"foo"' },
            { luaPattern: "Foo", typeScriptPattern: "Foo" },
        ],
    },
    {
        code: `
            // @ts-ignore
            import * as Foo from "foo";
            Foo;
        `,

        assertPatterns: [
            { luaPattern: 'require("foo")', typeScriptPattern: '"foo"' },
            { luaPattern: "Foo", typeScriptPattern: "Foo" },
        ],
    },
    {
        code: `
            // @ts-ignore
            class Bar extends Foo {
                constructor() {
                    super();
                }
            }
        `,

        assertPatterns: [
            { luaPattern: "Bar = __TS__Class()", typeScriptPattern: "class Bar" },
            { luaPattern: "Bar.name =", typeScriptPattern: "class Bar" },
            { luaPattern: "__TS__ClassExtends", typeScriptPattern: "extends" },
            { luaPattern: "Foo", typeScriptPattern: "Foo" },
            { luaPattern: "function Bar.prototype.____constructor", typeScriptPattern: "constructor" },
        ],
    },
    {
        code: `
            class Foo {
            }
        `,

        assertPatterns: [{ luaPattern: "function Foo.prototype.____constructor", typeScriptPattern: "class Foo" }],
    },
    {
        code: `
            class Foo {
                bar = "baz";
            }
        `,

        assertPatterns: [{ luaPattern: "function Foo.prototype.____constructor", typeScriptPattern: "class Foo" }],
    },
    {
        code: `
            declare const arr: string[];
            for (const element of arr) {}
        `,

        assertPatterns: [
            { luaPattern: "arr", typeScriptPattern: "arr)" },
            { luaPattern: "element", typeScriptPattern: "element" },
        ],
    },
    {
        code: `
            declare function getArr(this: void): string[];
            for (const element of getArr()) {}
        `,

        assertPatterns: [
            { luaPattern: "for", typeScriptPattern: "for" },
            { luaPattern: "getArr()", typeScriptPattern: "getArr()" },
            { luaPattern: "element", typeScriptPattern: "element" },
        ],
    },
    {
        code: `
            declare const arr: string[]
            for (let i = 0; i < arr.length; ++i) {}
        `,

        assertPatterns: [
            { luaPattern: "i = 0", typeScriptPattern: "i = 0" },
            { luaPattern: "i < #arr", typeScriptPattern: "i < arr.length" },
            { luaPattern: "i + 1", typeScriptPattern: "++i" },
        ],
    },
])("Source map has correct mapping (%p)", async ({ code, assertPatterns }) => {
    const file = util
        .testModule(code)
        .ignoreDiagnostics([couldNotResolveRequire.code])
        .expectToHaveNoDiagnostics()
        .getMainLuaFileResult();

    const consumer = await new SourceMapConsumer(file.luaSourceMap);
    for (const { luaPattern, typeScriptPattern } of assertPatterns) {
        const luaPosition = lineAndColumnOf(file.lua, luaPattern);
        const mappedPosition = consumer.originalPositionFor(luaPosition);
        const typescriptPosition = lineAndColumnOf(code, typeScriptPattern);

        expect(mappedPosition).toMatchObject(typescriptPosition);
    }
});

test.each([
    {
        fileName: "/proj/foo.ts",
        config: {},
        expectedSourceMapSourcePath: "foo.ts", // Project root inferred as common source directory
    },
    {
        fileName: "/proj/src/foo.ts",
        config: { outDir: "/proj/dst" },
        expectedSourceMapSourcePath: "foo.ts", // Project root inferred as common source directory
    },
    {
        fileName: "/proj/src/foo.ts",
        config: { rootDir: "/proj", outDir: "/proj/dst" },
        expectedSourceMapSourcePath: "src/foo.ts", // rootDir set
    },
    {
        fileName: "/proj/src/sub/foo.ts",
        config: { rootDir: "/proj/src", outDir: "/proj/dst" },
        expectedSourceMapSourcePath: "sub/foo.ts", // rootDir set
    },
    {
        fileName: "/proj/src/sub/main.ts",
        config: { rootDir: "/proj/src", outDir: "/proj/dst", sourceRoot: "bin" },
        fullSource: "bin/sub/main.ts",
        expectedSourceMapSourcePath: "sub/main.ts", // rootDir set
    },
])("Source map has correct sources (%p)", async ({ fileName, config, fullSource, expectedSourceMapSourcePath }) => {
    const file = util.testModule`
        const foo = "foo"
    `
        .setOptions(config)
        .setMainFileName(fileName)
        .getMainLuaFileResult();

    const sourceMap = JSON.parse(file.luaSourceMap);
    expect(sourceMap.sources).toHaveLength(1);
    expect(sourceMap.sources[0]).toBe(expectedSourceMapSourcePath);

    const consumer = await new SourceMapConsumer(file.luaSourceMap);
    expect(consumer.sources).toHaveLength(1);
    expect(consumer.sources[0]).toBe(fullSource ?? expectedSourceMapSourcePath);
});

test.each([
    { configSourceRoot: undefined, mapSourceRoot: "" },
    { configSourceRoot: "src", mapSourceRoot: "src/" },
    { configSourceRoot: "src/", mapSourceRoot: "src/" },
    { configSourceRoot: "src\\", mapSourceRoot: "src/" },
])("Source map has correct source root (%p)", ({ configSourceRoot, mapSourceRoot }) => {
    const file = util.testModule`
        const foo = "foo"
    `
        .setOptions({ sourceMap: true, sourceRoot: configSourceRoot })
        .expectToHaveNoDiagnostics()
        .getMainLuaFileResult();

    const sourceMap = JSON.parse(file.luaSourceMap);
    expect(sourceMap.sourceRoot).toBe(mapSourceRoot);
});

test.each([
    { code: 'const type = "foobar";', name: "type" },
    { code: 'const and = "foobar";', name: "and" },
    { code: 'const $$$ = "foobar";', name: "$$$" },
    { code: "const foo = { bar() { this; } };", name: "this" },
    { code: "function foo($$$: unknown) {}", name: "$$$" },
    { code: "class $$$ {}", name: "$$$" },
    { code: 'namespace $$$ { const foo = "bar"; }', name: "$$$" },
])("Source map has correct name mappings (%p)", async ({ code, name }) => {
    const file = util.testModule(code).expectToHaveNoDiagnostics().getMainLuaFileResult();

    const consumer = await new SourceMapConsumer(file.luaSourceMap);
    const typescriptPosition = lineAndColumnOf(code, name);
    let mappedName: string | undefined;
    consumer.eachMapping(mapping => {
        if (mapping.originalLine === typescriptPosition.line && mapping.originalColumn === typescriptPosition.column) {
            mappedName = mapping.name;
        }
    });

    expect(mappedName).toBe(name);
});

test("sourceMapTraceback saves sourcemap in _G", () => {
    const code = `
        function abc() {
            return "foo";
        }

        return (globalThis as any).__TS__sourcemap;
    `;

    const builder = util
        .testFunction(code)
        .setOptions({ sourceMapTraceback: true, luaLibImport: tstl.LuaLibImportKind.Inline });

    const sourceMap = builder.getLuaExecutionResult();
    const transpiledLua = builder.getMainLuaCodeChunk();

    expect(sourceMap).toEqual(expect.any(Object));
    const sourceMapFiles = Object.keys(sourceMap);
    expect(sourceMapFiles).toHaveLength(1);
    const mainSourceMap = sourceMap[sourceMapFiles[0]];

    const assertPatterns = [
        { luaPattern: "function abc(", typeScriptPattern: "function abc() {" },
        { luaPattern: 'return "foo"', typeScriptPattern: 'return "foo"' },
    ];

    for (const { luaPattern, typeScriptPattern } of assertPatterns) {
        const luaPosition = lineAndColumnOf(transpiledLua, luaPattern);
        const mappedLine = mainSourceMap[luaPosition.line.toString()];

        const typescriptPosition = lineAndColumnOf(code, typeScriptPattern);
        expect(mappedLine).toEqual(typescriptPosition.line);
    }
});

test("sourceMapTraceback gives traceback", () => {
    const builder = util.testFunction`
        return (debug.traceback as (this: void)=>string)();
    `.setOptions({ sourceMapTraceback: true, luaLibImport: tstl.LuaLibImportKind.Inline });

    const traceback = builder.getLuaExecutionResult();
    expect(traceback).toEqual(expect.any(String));
});

test("Inline sourcemaps", () => {
    const code = `
        function abc() {
            return def();
        }

        function def() {
            return "foo";
        }

        return abc();
    `;

    const file = util
        .testFunction(code)
        .setOptions({ inlineSourceMap: true }) // We can't disable 'sourceMap' option because it's used for comparison
        .disableSemanticCheck() // TS5053: Option 'sourceMap' cannot be specified with option 'inlineSourceMap'.
        .expectToMatchJsResult()
        .getMainLuaFileResult();

    const [, inlineSourceMapMatch] =
        file.lua.match(/--# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)/) ?? [];
    const inlineSourceMap = Buffer.from(inlineSourceMapMatch, "base64").toString();
    expect(inlineSourceMap).toBe(file.luaSourceMap);
});
