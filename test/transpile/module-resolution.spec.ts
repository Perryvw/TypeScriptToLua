import * as path from "path";
import * as util from "../util";

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

    test("can resolve dependencies in chain", () => {
        util.testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(path.join(projectPath, "main.ts"))
            .expectToEqual({ result: "dependency3" });
    });

    test("resolved package dependency included in bundle", () => {
        const mainFile = path.join(projectPath, "main.ts");
        util.testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(mainFile)
            .setOptions({ luaBundle: "bundle.lua", luaBundleEntry: mainFile })
            .expectToEqual({ result: "dependency3" });
    });
});

describe("module resolution with outDir", () => {
    const projectPath = path.resolve(__dirname, "module-resolution", "project-with-dependency-chain");

    test("emits files in outDir", () => {
        const builder = util
            .testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(path.join(projectPath, "main.ts"))
            .setOptions({ outDir: "tstl-out" })
            .expectToEqual({ result: "dependency3" });

        // Get the output paths relative to the project path
        const outPaths = builder.getLuaResult().transpiledFiles.map(f => path.relative(projectPath, f.outPath));
        expect(outPaths).toHaveLength(4);
        expect(outPaths).toContain(path.join("tstl-out", "main.lua"));
        // Note: outputs to lua_modules
        expect(outPaths).toContain(path.join("tstl-out", "lua_modules", "dependency1", "index.lua"));
        expect(outPaths).toContain(path.join("tstl-out", "lua_modules", "dependency2", "index.lua"));
        expect(outPaths).toContain(path.join("tstl-out", "lua_modules", "dependency3", "index.lua"));
    });

    test("emits bundle in outDir", () => {
        const mainFile = path.join(projectPath, "main.ts");
        const builder = util
            .testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(mainFile)
            .setOptions({ outDir: "tstl-out", luaBundle: "bundle.lua", luaBundleEntry: mainFile })
            .expectToEqual({ result: "dependency3" });

        // Get the output paths relative to the project path
        const outPaths = builder.getLuaResult().transpiledFiles.map(f => path.relative(projectPath, f.outPath));
        expect(outPaths).toHaveLength(1);
        expect(outPaths).toContain(path.join("tstl-out", "bundle.lua"));
    });
});

describe("module resolution with sourceDir", () => {
    const projectPath = path.resolve(__dirname, "module-resolution", "project-with-sourceDir");

    test("can resolve dependencies with sourceDir", () => {
        util.testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(path.join(projectPath, "src", "main.ts"))
            .setOptions({ outDir: "tstl-out" })
            .expectToEqual({ result: "dependency3", result2: "non-node_modules import" });
    });

    test("can resolve dependencies and bundle files with sourceDir", () => {
        const mainFile = path.join(projectPath, "src", "main.ts");
        util.testProject(path.join(projectPath, "tsconfig.json"))
            .setMainFileName(mainFile)
            .setOptions({ luaBundle: "bundle.lua", luaBundleEntry: mainFile })
            .expectToEqual({ result: "dependency3", result2: "non-node_modules import" });
    });
});
