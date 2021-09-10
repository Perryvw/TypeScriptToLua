import * as path from "path";
import * as tstl from "../../src";
import { BuildMode, transpileProject } from "../../src";
import * as util from "../util";
import * as ts from "typescript";

describe("basic module resolution", () => {
    const projectPath = path.resolve(__dirname, "module-resolution", "project-with-node-modules");

    const projectWithNodeModules = util
        .testProject(path.join(projectPath, "tsconfig.json"))
        .setMainFileName(path.join(projectPath, "main.ts"));

    test("can resolve global dependencies with declarations", () => {
        // Declarations in the node_modules directory
        expect(projectWithNodeModules.getLuaExecutionResult().globalWithDeclarationsResults).toEqual({
            foo: "foo from lua global with decls",
            bar: "bar from lua global with decls: global with declarations!",
            baz: "baz from lua global with decls",
        });
    });

    test("can resolve global dependencies with hand-written declarations", () => {
        // No declarations in the node_modules directory, but written by hand in project dir
        expect(projectWithNodeModules.getLuaExecutionResult().globalWithoutDeclarationsResults).toEqual({
            foo: "foo from lua global without decls",
            bar: "bar from lua global without decls: global without declarations!",
            baz: "baz from lua global without decls",
        });
    });

    test("can resolve module dependencies with declarations", () => {
        // Declarations in the node_modules directory
        expect(projectWithNodeModules.getLuaExecutionResult().moduleWithDeclarationsResults).toEqual({
            foo: "foo from lua module with decls",
            bar: "bar from lua module with decls: module with declarations!",
            baz: "baz from lua module with decls",
        });
    });

    test("can resolve module dependencies with hand-written declarations", () => {
        // Declarations in the node_modules directory
        expect(projectWithNodeModules.getLuaExecutionResult().moduleWithoutDeclarationsResults).toEqual({
            foo: "foo from lua module without decls",
            bar: "bar from lua module without decls: module without declarations!",
            baz: "baz from lua module without decls",
        });
    });

    test("can resolve package depencency with a dependency on another package", () => {
        // Declarations in the node_modules directory
        expect(projectWithNodeModules.getLuaExecutionResult().moduleWithDependencyResult).toEqual(
            "Calling dependency: foo from lua module with decls"
        );
    });

    test("resolved package dependency included in bundle", () => {
        const mainFile = path.join(projectPath, "main.ts");
        util.testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(mainFile)
            .setOptions({ luaBundle: "bundle.lua", luaBundleEntry: mainFile })
            .expectToEqual({
                globalWithDeclarationsResults: {
                    foo: "foo from lua global with decls",
                    bar: "bar from lua global with decls: global with declarations!",
                    baz: "baz from lua global with decls",
                },
                globalWithoutDeclarationsResults: {
                    foo: "foo from lua global without decls",
                    bar: "bar from lua global without decls: global without declarations!",
                    baz: "baz from lua global without decls",
                },
                moduleWithDeclarationsResults: {
                    foo: "foo from lua module with decls",
                    bar: "bar from lua module with decls: module with declarations!",
                    baz: "baz from lua module with decls",
                },
                moduleWithDependencyResult: "Calling dependency: foo from lua module with decls",
                moduleWithoutDeclarationsResults: {
                    foo: "foo from lua module without decls",
                    bar: "bar from lua module without decls: module without declarations!",
                    baz: "baz from lua module without decls",
                },
            });
    });
});

describe("module resolution with chained dependencies", () => {
    const projectPath = path.resolve(__dirname, "module-resolution", "project-with-dependency-chain");
    const expectedResult = { result: "dependency3", result2: "someFunc from otherfile.lua" };

    test("can resolve dependencies in chain", () => {
        util.testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(path.join(projectPath, "main.ts"))
            .expectToEqual(expectedResult);
    });

    test("resolved package dependency included in bundle", () => {
        const mainFile = path.join(projectPath, "main.ts");
        util.testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(mainFile)
            .setOptions({ luaBundle: "bundle.lua", luaBundleEntry: mainFile })
            .expectToEqual(expectedResult);
    });

    test("works with different module setting", () => {
        util.testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(path.join(projectPath, "main.ts"))
            .setOptions({ module: ts.ModuleKind.ESNext })
            .expectToEqual(expectedResult);
    });
});

describe("module resolution with outDir", () => {
    const projectPath = path.resolve(__dirname, "module-resolution", "project-with-dependency-chain");
    const expectedResult = { result: "dependency3", result2: "someFunc from otherfile.lua" };

    test("emits files in outDir", () => {
        const builder = util
            .testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(path.join(projectPath, "main.ts"))
            .setOptions({ outDir: "tstl-out" })
            .expectToEqual(expectedResult);

        // Get the output paths relative to the project path
        const outPaths = builder.getLuaResult().transpiledFiles.map(f => path.relative(projectPath, f.outPath));
        expect(outPaths).toHaveLength(5);
        expect(outPaths).toContain(path.join("tstl-out", "main.lua"));
        // Note: outputs to lua_modules
        expect(outPaths).toContain(path.join("tstl-out", "lua_modules", "dependency1", "index.lua"));
        expect(outPaths).toContain(path.join("tstl-out", "lua_modules", "dependency1", "otherfile.lua"));
        expect(outPaths).toContain(path.join("tstl-out", "lua_modules", "dependency2", "index.lua"));
        expect(outPaths).toContain(path.join("tstl-out", "lua_modules", "dependency3", "index.lua"));
    });

    test("emits bundle in outDir", () => {
        const mainFile = path.join(projectPath, "main.ts");
        const builder = util
            .testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(mainFile)
            .setOptions({ outDir: "tstl-out", luaBundle: "bundle.lua", luaBundleEntry: mainFile })
            .expectToEqual(expectedResult);

        // Get the output paths relative to the project path
        const outPaths = builder.getLuaResult().transpiledFiles.map(f => path.relative(projectPath, f.outPath));
        expect(outPaths).toHaveLength(1);
        expect(outPaths).toContain(path.join("tstl-out", "bundle.lua"));
    });
});

describe("module resolution with sourceDir", () => {
    const projectPath = path.resolve(__dirname, "module-resolution", "project-with-sourceDir");
    const expectedResult = {
        result: "dependency3",
        functionInSubDir: "non-node_modules import",
        functionReExportedFromSubDir: "nested func result",
        nestedFunctionInSubDirOfSubDir: "nested func result",
        nestedFunctionUsingFunctionFromParentDir: "nested func: non-node_modules import 2",
    };

    test("can resolve dependencies with sourceDir", () => {
        util.testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(path.join(projectPath, "src", "main.ts"))
            .setOptions({ outDir: "tstl-out" })
            .expectToEqual(expectedResult);
    });

    test("can resolve dependencies and bundle files with sourceDir", () => {
        const mainFile = path.join(projectPath, "src", "main.ts");
        util.testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(mainFile)
            .setOptions({ luaBundle: "bundle.lua", luaBundleEntry: mainFile })
            .expectToEqual(expectedResult);
    });
});

describe("module resolution project with lua sources", () => {
    const projectPath = path.resolve(__dirname, "module-resolution", "project-with-lua-sources");
    const expectedResult = {
        funcFromLuaFile: "lua file in subdir",
        funcFromSubDirLuaFile: "lua file in subdir",
    };

    test("can resolve lua dependencies", () => {
        util.testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(path.join(projectPath, "main.ts"))
            .setOptions({ outDir: "tstl-out" })
            .expectToEqual(expectedResult);
    });

    test("can resolve dependencies and bundle files with sourceDir", () => {
        const mainFile = path.join(projectPath, "main.ts");
        util.testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(mainFile)
            .setOptions({ luaBundle: "bundle.lua", luaBundleEntry: mainFile })
            .expectToEqual(expectedResult);
    });
});

describe("module resolution in library mode", () => {
    test("result does not contain resolved paths", () => {
        const projectPath = path.resolve(__dirname, "module-resolution", "project-with-dependency-chain");

        const { transpiledFiles } = util
            .testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(path.join(projectPath, "main.ts"))
            .setOptions({ buildMode: tstl.BuildMode.Library })
            .expectToHaveNoDiagnostics()
            .getLuaResult();

        for (const file of transpiledFiles) {
            expect(file.lua).not.toContain('require("lua_modules');
        }
    });

    test("project works in library mode because no external dependencies", () => {
        const projectPath = path.resolve(__dirname, "module-resolution", "project-with-lua-sources");

        const { transpiledFiles } = util
            .testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(path.join(projectPath, "main.ts"))
            .setOptions({ outDir: "tstl-out", buildMode: tstl.BuildMode.Library })
            .expectToEqual({
                funcFromLuaFile: "lua file in subdir",
                funcFromSubDirLuaFile: "lua file in subdir",
            })
            .getLuaResult();

        for (const file of transpiledFiles) {
            expect(file.lua).not.toContain('require("lua_modules');
        }
    });
});

describe("module resolution project with dependencies built by tstl library mode", () => {
    const projectPath = path.resolve(__dirname, "module-resolution", "project-with-tstl-library-modules");

    // First compile dependencies into node_modules. NOTE: Actually writing to disk, very slow
    transpileProject(path.join(projectPath, "dependency1-ts", "tsconfig.json"));
    transpileProject(path.join(projectPath, "dependency2-ts", "tsconfig.json"));

    const expectedResult = {
        dependency1IndexResult: "function in dependency 1 index: dependency1OtherFileFunc in dependency1/d1otherfile",
        dependency1OtherFileFuncResult: "dependency1OtherFileFunc in dependency1/d1otherfile",
        dependency2MainResult: "dependency 2 main",
        dependency2OtherFileResult: "Dependency 2 func: my string argument",
    };

    test("can resolve lua dependencies", () => {
        util.testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(path.join(projectPath, "main.ts"))
            .setOptions({ outDir: "tstl-out" })
            .expectToEqual(expectedResult);
    });

    test("can resolve dependencies and bundle", () => {
        const mainFile = path.join(projectPath, "main.ts");
        util.testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(mainFile)
            .setOptions({ luaBundle: "bundle.lua", luaBundleEntry: mainFile })
            .expectToEqual(expectedResult);
    });
});

// Test fix for https://github.com/TypeScriptToLua/TypeScriptToLua/issues/1037
describe("module resolution with tsx", () => {
    const projectPath = path.resolve(__dirname, "module-resolution", "project-with-tsx");

    test("project with tsx files", () => {
        util.testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(path.join(projectPath, "main.tsx"))
            .expectToEqual({
                result: "hello from other.tsx",
                indexResult: "hello from dir/index.tsx",
            });
    });
});

describe("dependency with complicated inner structure", () => {
    const projectPath = path.resolve(__dirname, "module-resolution", "project-with-complicated-dependency");
    const tsConfigPath = path.join(projectPath, "tsconfig.json");
    const mainFilePath = path.join(projectPath, "main.ts");

    const expectedResult = {
        otherFileResult: "someFunc from otherfile.lua",
        otherFileUtil: "util",
        subsubresult: "result from subsub dir",
        utilResult: "util",
        subdirwithInitResult: "a",
    };

    // Test fix for https://github.com/TypeScriptToLua/TypeScriptToLua/issues/1055
    test("bundle should not contain duplicate files", () => {
        const mainFile = path.join(projectPath, "main.ts");
        const { transpiledFiles } = util
            .testProject(tsConfigPath)
            .setMainFileName(mainFilePath)
            .setOptions({ luaBundle: "bundle.lua", luaBundleEntry: mainFile })
            .expectToEqual(expectedResult)
            .getLuaResult();

        expect(transpiledFiles).toHaveLength(1);
        const lua = transpiledFiles[0].lua!;
        // util is used in 2 places, but should only occur once in the bundle
        const utilModuleOccurrences = (lua.match(/\["lua_modules\.dependency1\.util"\]/g) ?? []).length;
        expect(utilModuleOccurrences).toBe(1);
    });

    // Test fix for https://github.com/TypeScriptToLua/TypeScriptToLua/issues/1054
    test("should be able to resolve dependency files in subdirectories", () => {
        util.testProject(tsConfigPath).setMainFileName(mainFilePath).expectToEqual(expectedResult);
    });
});

test("module resolution should not try to resolve @noResolution annotation", () => {
    util.testModule`
        import * as json from "json";
        const test = json.decode("{}");
    `
        .addExtraFile(
            "json.d.ts",
            `
                /** @noResolution */
                declare module "json" {
                    function encode(this: void, data: unknown): string;
                    function decode(this: void, data: string): unknown;
                }
            `
        )
        .expectToHaveNoDiagnostics();
});

// https://github.com/TypeScriptToLua/TypeScriptToLua/issues/1062
test("module resolution should not rewrite @NoResolution requires in library mode", () => {
    const { transpiledFiles } = util.testModule`
        import * as json from "json";
        const test = json.decode("{}");
    `
        .addExtraFile(
            "json.d.ts",
            `
                /** @noResolution */
                declare module "json" {
                    function encode(this: void, data: unknown): string;
                    function decode(this: void, data: string): unknown;
                }
            `
        )
        .setOptions({ buildMode: BuildMode.Library })
        .getLuaResult();

    expect(transpiledFiles).toHaveLength(1);
    expect(transpiledFiles[0].lua).toContain('require("@NoResolution:');
});

// https://github.com/TypeScriptToLua/TypeScriptToLua/issues/1050
test("module resolution should not try to resolve resolve-like functions", () => {
    util.testModule`
        function custom_require(this: void, value: string) {
            return value;
        }

        namespace ns {
            export function require(this: void, value: string) {
                return value;
            }
        }

        class MyClass {
            require(value: string) {
                return value;
            }
        }
        const inst = new MyClass();

        export const result = [
            custom_require("value 1"),
            ns.require("value 2"),
            inst.require("value 3")
        ];

    `
        .expectToHaveNoDiagnostics()
        .expectToEqual({
            result: ["value 1", "value 2", "value 3"],
        });
});

// https://github.com/TypeScriptToLua/TypeScriptToLua/issues/1050
test("module resolution uses baseURL to resolve imported files", () => {
    util.testModule`
        import { foo } from "dep1";
        import { bar } from "dep2";
        import { baz } from "luadep";

        export const fooResult = foo();
        export const barResult = bar();
        export const bazResult = baz();
    `
        .addExtraFile(
            "myproject/mydeps/dep1.ts",
            `
                export function foo() { return "foo"; }
            `
        )
        .addExtraFile(
            "myproject/mydeps/dep2.ts",
            `
                export function bar() { return "bar"; }
            `
        )
        .addExtraFile(
            "myproject/mydeps/luadep.d.ts",
            `
                export function baz(): string;
            `
        )
        .addExtraFile(
            "myproject/mydeps/luadep.lua",
            `
                return { baz = function() return "baz" end }
            `
        )
        .setOptions({ baseUrl: "./myproject/mydeps" })
        .expectToEqual({
            fooResult: "foo",
            barResult: "bar",
            bazResult: "baz",
        });
});

// https://github.com/TypeScriptToLua/TypeScriptToLua/issues/1071
test("includes lualib_bundle when external lua requests it", () => {
    util.testModule`
        export { foo } from "./lualibuser";
    `
        .addExtraFile(
            "lualibuser.d.ts",
            `
                export const foo: string[];
            `
        )
        .addExtraFile(
            "lualibuser.lua",
            `
                require("lualib_bundle")

                local result = {}
                __TS__ArrayPush(result, { "foo" })
                __TS__ArrayPush(result, { "bar" })

                return { foo = result }
            `
        )
        .expectToEqual({
            foo: ["foo", "bar"],
        });
});
