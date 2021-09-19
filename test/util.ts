/* eslint-disable jest/no-standalone-expect */
import * as nativeAssert from "assert";
import { LauxLib, Lua, LuaLib, LuaState, LUA_OK } from "lua-wasm-bindings/dist/lua";
import * as fs from "fs";
import { stringify } from "javascript-stringify";
import * as path from "path";
import * as prettyFormat from "pretty-format";
import * as ts from "typescript";
import * as vm from "vm";
import * as tstl from "../src";
import { createEmitOutputCollector } from "../src/transpilation/output-collector";
import { EmitHost, getEmitOutDir, transpileProject } from "../src";
import { formatPathToLuaPath, normalizeSlashes } from "../src/utils";

const jsonLib = fs.readFileSync(path.join(__dirname, "json.lua"), "utf8");
const luaLib = fs.readFileSync(path.resolve(__dirname, "../dist/lualib/lualib_bundle.lua"), "utf8");

// Using `test` directly makes eslint-plugin-jest consider this file as a test
const defineTest = test;

function getLuaBindingsForVersion(target: tstl.LuaTarget): { lauxlib: LauxLib; lua: Lua; lualib: LuaLib } {
    if (target === tstl.LuaTarget.Lua51) {
        const { lauxlib, lua, lualib } = require("lua-wasm-bindings/dist/lua.51");
        return { lauxlib, lua, lualib };
    }
    if (target === tstl.LuaTarget.Lua52) {
        const { lauxlib, lua, lualib } = require("lua-wasm-bindings/dist/lua.52");
        return { lauxlib, lua, lualib };
    }
    if (target === tstl.LuaTarget.Lua53) {
        const { lauxlib, lua, lualib } = require("lua-wasm-bindings/dist/lua.53");
        return { lauxlib, lua, lualib };
    }
    if (target === tstl.LuaTarget.LuaJIT) {
        throw Error("Can't use executeLua() or expectToMatchJsResult() wit LuaJIT as target!");
    }

    const { lauxlib, lua, lualib } = require("lua-wasm-bindings/dist/lua.54");
    return { lauxlib, lua, lualib };
}

export function assert(value: any, message?: string | Error): asserts value {
    nativeAssert(value, message);
}

export const formatCode = (...values: unknown[]) => values.map(e => stringify(e)).join(", ");

export function testEachVersion<T extends TestBuilder>(
    name: string | undefined,
    common: () => T,
    special?: Record<tstl.LuaTarget, ((builder: T) => void) | boolean>
): void {
    for (const version of Object.values(tstl.LuaTarget) as tstl.LuaTarget[]) {
        const specialBuilder = special?.[version];
        if (specialBuilder === false) return;

        const testName = name === undefined ? version : `${name} [${version}]`;
        defineTest(testName, () => {
            const builder = common();
            builder.setOptions({ luaTarget: version });
            if (typeof specialBuilder === "function") {
                specialBuilder(builder);
            }
        });
    }
}

export function expectEachVersionExceptJit<T>(expectation: (builder: T) => void): Record<tstl.LuaTarget, ((builder: T) => void) | boolean> {
    return {
        [tstl.LuaTarget.Universal]: expectation,
        [tstl.LuaTarget.Lua51]: expectation,
        [tstl.LuaTarget.Lua52]: expectation,
        [tstl.LuaTarget.Lua53]: expectation,
        [tstl.LuaTarget.Lua54]: expectation,
        [tstl.LuaTarget.LuaJIT]: false, // Exclude JIT
    }
}

const memoize: MethodDecorator = (_target, _propertyKey, descriptor) => {
    const originalFunction = descriptor.value as any;
    const memoized = new WeakMap();
    descriptor.value = function (this: any, ...args: any[]): any {
        if (!memoized.has(this)) {
            memoized.set(this, originalFunction.apply(this, args));
        }

        return memoized.get(this);
    } as any;
    return descriptor;
};

export class ExecutionError extends Error {
    public name = "ExecutionError";
    // https://github.com/typescript-eslint/typescript-eslint/issues/1131
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor(message: string) {
        super(message);
    }
}

export type ExecutableTranspiledFile = tstl.TranspiledFile & { lua: string; luaSourceMap: string };
export type TapCallback = (builder: TestBuilder) => void;
export abstract class TestBuilder {
    constructor(protected _tsCode: string) {}

    // Options

    // TODO: Use testModule in these cases?
    protected tsHeader = "";
    public setTsHeader(tsHeader: string): this {
        expect(this.hasProgram).toBe(false);
        this.tsHeader = tsHeader;
        return this;
    }

    private luaHeader = "";
    public setLuaHeader(luaHeader: string): this {
        expect(this.hasProgram).toBe(false);
        this.luaHeader += luaHeader;
        return this;
    }

    protected jsHeader = "";
    public setJsHeader(jsHeader: string): this {
        expect(this.hasProgram).toBe(false);
        this.jsHeader += jsHeader;
        return this;
    }

    protected abstract getLuaCodeWithWrapper(code: string): string;
    public setLuaFactory(luaFactory: (code: string) => string): this {
        expect(this.hasProgram).toBe(false);
        this.getLuaCodeWithWrapper = luaFactory;
        return this;
    }

    private semanticCheck = true;
    public disableSemanticCheck(): this {
        expect(this.hasProgram).toBe(false);
        this.semanticCheck = false;
        return this;
    }

    protected options: tstl.CompilerOptions = {
        luaTarget: tstl.LuaTarget.Lua54,
        noHeader: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2017,
        lib: ["lib.esnext.d.ts"],
        moduleResolution: ts.ModuleResolutionKind.NodeJs,
        resolveJsonModule: true,
        experimentalDecorators: true,
        sourceMap: true,
    };
    public setOptions(options: tstl.CompilerOptions = {}): this {
        expect(this.hasProgram).toBe(false);
        Object.assign(this.options, options);
        return this;
    }

    public withLanguageExtensions(): this {
        this.setOptions({ types: [path.resolve(__dirname, "..", "language-extensions")] });
        // Polyfill lualib for JS
        this.setJsHeader(`
            function $multi(...args) { return args; }
        `);
        return this;
    }

    protected mainFileName = "main.ts";
    public setMainFileName(mainFileName: string): this {
        expect(this.hasProgram).toBe(false);
        this.mainFileName = normalizeSlashes(mainFileName);
        return this;
    }

    protected extraFiles: Record<string, string> = {};
    public addExtraFile(fileName: string, code: string): this {
        expect(this.hasProgram).toBe(false);
        this.extraFiles[fileName] = code;
        return this;
    }

    private customTransformers?: ts.CustomTransformers;
    public setCustomTransformers(customTransformers?: ts.CustomTransformers): this {
        expect(this.hasProgram).toBe(false);
        this.customTransformers = customTransformers;
        return this;
    }

    // Transpilation and execution

    public getTsCode(): string {
        return `${this.tsHeader}${this._tsCode}`;
    }

    protected hasProgram = false;
    @memoize
    public getProgram(): ts.Program {
        this.hasProgram = true;

        // Exclude lua files from TS program, but keep them in extraFiles so module resolution can find them
        const nonLuaExtraFiles = Object.fromEntries(
            Object.entries(this.extraFiles).filter(([fileName]) => !fileName.endsWith(".lua"))
        );

        return tstl.createVirtualProgram(
            { ...nonLuaExtraFiles, [normalizeSlashes(this.mainFileName)]: this.getTsCode() },
            this.options
        );
    }

    private getEmitHost(): EmitHost {
        return {
            fileExists: (path: string) => normalizeSlashes(path) in this.extraFiles,
            directoryExists: (path: string) =>
                Object.keys(this.extraFiles).some(f => f.startsWith(normalizeSlashes(path))),
            getCurrentDirectory: () => ".",
            readFile: (path: string) => this.extraFiles[normalizeSlashes(path)] ?? ts.sys.readFile(path),
            writeFile() {},
        };
    }

    @memoize
    public getLuaResult(): tstl.TranspileVirtualProjectResult {
        const program = this.getProgram();
        const collector = createEmitOutputCollector();
        const { diagnostics: transpileDiagnostics } = new tstl.Transpiler({ emitHost: this.getEmitHost() }).emit({
            program,
            customTransformers: this.customTransformers,
            writeFile: collector.writeFile,
        });

        const diagnostics = ts.sortAndDeduplicateDiagnostics([
            ...ts.getPreEmitDiagnostics(program),
            ...transpileDiagnostics,
        ]);

        return { diagnostics: [...diagnostics], transpiledFiles: collector.files };
    }

    @memoize
    public getMainLuaFileResult(): ExecutableTranspiledFile {
        const { transpiledFiles } = this.getLuaResult();
        const mainFile = this.options.luaBundle
            ? transpiledFiles[0]
            : transpiledFiles.find(({ sourceFiles }) =>
                  sourceFiles.some(f => normalizeSlashes(f.fileName) === this.mainFileName)
              );

        expect(mainFile).toMatchObject({ lua: expect.any(String), luaSourceMap: expect.any(String) });
        return mainFile as ExecutableTranspiledFile;
    }

    @memoize
    public getMainLuaCodeChunk(): string {
        const header = this.luaHeader ? `${this.luaHeader.trimRight()}\n` : "";
        return header + this.getMainLuaFileResult().lua.trimRight();
    }

    @memoize
    public getLuaExecutionResult(): any {
        return this.executeLua();
    }

    @memoize
    public getJsResult(): tstl.TranspileVirtualProjectResult {
        const program = this.getProgram();
        program.getCompilerOptions().module = ts.ModuleKind.CommonJS;

        const collector = createEmitOutputCollector();
        const { diagnostics } = program.emit(undefined, collector.writeFile);
        return { transpiledFiles: collector.files, diagnostics: [...diagnostics] };
    }

    @memoize
    public getMainJsCodeChunk(): string {
        const { transpiledFiles } = this.getJsResult();
        const code = transpiledFiles.find(({ sourceFiles }) =>
            sourceFiles.some(f => f.fileName === this.mainFileName)
        )?.js;
        assert(code !== undefined);

        const header = this.jsHeader ? `${this.jsHeader.trimRight()}\n` : "";
        return header + code;
    }

    protected abstract getJsCodeWithWrapper(): string;

    @memoize
    public getJsExecutionResult(): any {
        return this.executeJs();
    }

    // Utilities

    private getLuaDiagnostics(): ts.Diagnostic[] {
        const { diagnostics } = this.getLuaResult();
        return diagnostics.filter(
            d => (this.semanticCheck || d.source === "typescript-to-lua") && !this.ignoredDiagnostics.includes(d.code)
        );
    }

    // Actions

    public debug(includeLualib = false): this {
        const transpiledFiles = this.getLuaResult().transpiledFiles;
        const luaCode = transpiledFiles
            .filter(f => includeLualib || f.outPath !== "lualib_bundle.lua")
            .map(f => `[${f.outPath}]:\n${f.lua?.replace(/^/gm, "  ")}`);
        const value = prettyFormat(this.getLuaExecutionResult()).replace(/^/gm, "  ");
        console.log(`Lua Code:\n${luaCode.join("\n")}\n\nValue:\n${value}`);
        return this;
    }

    private diagnosticsChecked = false;
    private ignoredDiagnostics: number[] = [];

    public ignoreDiagnostics(ignored: number[]): this {
        this.ignoredDiagnostics.push(...ignored);
        return this;
    }

    public expectToHaveDiagnostics(expected?: number[]): this {
        if (this.diagnosticsChecked) return this;
        this.diagnosticsChecked = true;

        expect(this.getLuaDiagnostics()).toHaveDiagnostics(expected);
        return this;
    }

    public expectToHaveNoDiagnostics(): this {
        if (this.diagnosticsChecked) return this;
        this.diagnosticsChecked = true;

        expect(this.getLuaDiagnostics()).not.toHaveDiagnostics();
        return this;
    }

    public expectNoExecutionError(): this {
        const luaResult = this.getLuaExecutionResult();
        if (luaResult instanceof ExecutionError) {
            throw luaResult;
        }

        return this;
    }

    private expectNoJsExecutionError(): this {
        const jsResult = this.getJsExecutionResult();
        if (jsResult instanceof ExecutionError) {
            throw jsResult;
        }

        return this;
    }

    public expectToMatchJsResult(allowErrors = false): this {
        this.expectToHaveNoDiagnostics();
        if (!allowErrors) this.expectNoExecutionError();
        if (!allowErrors) this.expectNoJsExecutionError();

        const luaResult = this.getLuaExecutionResult();
        const jsResult = this.getJsExecutionResult();
        expect(luaResult).toEqual(jsResult);

        return this;
    }

    public expectToEqual(expected: any): this {
        this.expectToHaveNoDiagnostics();
        const luaResult = this.getLuaExecutionResult();
        expect(luaResult).toEqual(expected);
        return this;
    }

    public expectLuaToMatchSnapshot(): this {
        this.expectToHaveNoDiagnostics();
        expect(this.getMainLuaCodeChunk()).toMatchSnapshot();
        return this;
    }

    public expectDiagnosticsToMatchSnapshot(expected?: number[], diagnosticsOnly = false): this {
        this.expectToHaveDiagnostics(expected);

        const diagnosticMessages = ts.formatDiagnostics(
            this.getLuaDiagnostics().map(tstl.prepareDiagnosticForFormatting),
            { getCurrentDirectory: () => "", getCanonicalFileName: fileName => fileName, getNewLine: () => "\n" }
        );

        expect(diagnosticMessages.trim()).toMatchSnapshot("diagnostics");
        if (!diagnosticsOnly) {
            expect(this.getMainLuaCodeChunk()).toMatchSnapshot("code");
        }

        return this;
    }

    public tap(callback: TapCallback): this {
        callback(this);
        return this;
    }

    private executeLua(): any {
        // Main file
        const mainFile = this.getMainLuaCodeChunk();

        const { lauxlib, lua, lualib } = getLuaBindingsForVersion(this.options.luaTarget ?? tstl.LuaTarget.Lua54);

        const L = lauxlib.luaL_newstate();
        lualib.luaL_openlibs(L);

        // Load modules
        // Json
        this.packagePreloadLuaFile(L, lua, lauxlib, "json", jsonLib);
        // Lua lib
        if (
            this.options.luaLibImport === tstl.LuaLibImportKind.Require ||
            mainFile.includes('require("lualib_bundle")')
        ) {
            this.packagePreloadLuaFile(L, lua, lauxlib, "lualib_bundle", luaLib);
        }

        // Load all transpiled files into Lua's package cache
        const { transpiledFiles } = this.getLuaResult();
        for (const transpiledFile of transpiledFiles) {
            if (transpiledFile.lua) {
                const filePath = path.relative(getEmitOutDir(this.getProgram()), transpiledFile.outPath);
                this.packagePreloadLuaFile(L, lua, lauxlib, filePath, transpiledFile.lua);
            }
        }

        // Execute Main
        const wrappedMainCode = `
local JSON = require("json");
return JSON.stringify((function()
    ${this.getLuaCodeWithWrapper(mainFile)}
end)());`;

        const status = lauxlib.luaL_dostring(L, wrappedMainCode);

        if (status === LUA_OK) {
            if (lua.lua_isstring(L, -1)) {
                const result = eval(`(${lua.lua_tostring(L, -1)})`);
                lua.lua_close(L);
                return result === null ? undefined : result;
            } else {
                const returnType = lua.lua_typename(L, lua.lua_type(L, -1));
                lua.lua_close(L);
                throw new Error(`Unsupported Lua return type: ${returnType}`);
            }
        } else {
            const luaStackString = lua.lua_tostring(L, -1);
            const message = luaStackString.replace(/^\[string "(--)?\.\.\."\]:\d+: /, "");
            lua.lua_close(L);
            return new ExecutionError(message);
        }
    }

    private packagePreloadLuaFile(state: LuaState, lua: Lua, lauxlib: LauxLib, fileName: string, fileContent: string) {
        // Adding source Lua to the package.preload cache will allow require to find it
        lua.lua_getglobal(state, "package");
        lua.lua_getfield(state, -1, "preload");
        lauxlib.luaL_loadstring(state, fileContent);
        lua.lua_setfield(state, -2, formatPathToLuaPath(fileName.replace(".lua", "")));
    }

    private executeJs(): any {
        const { transpiledFiles } = this.getJsResult();
        // Custom require for extra files. Really basic. Global support is hacky
        // TODO Should be replaced with vm.Module https://nodejs.org/api/vm.html#vm_class_vm_module
        // once stable
        const globalContext: any = {};
        const mainExports = {};
        globalContext.exports = mainExports;
        globalContext.module = { exports: mainExports };
        globalContext.require = (fileName: string) => {
            // create clean export object for "module"
            const moduleExports = {};
            globalContext.exports = moduleExports;
            globalContext.module = { exports: moduleExports };
            const transpiledExtraFile = transpiledFiles.find(({ sourceFiles }) =>
                sourceFiles.some(f => f.fileName === fileName.replace("./", "") + ".ts")
            );

            if (transpiledExtraFile?.js) {
                vm.runInContext(transpiledExtraFile.js, globalContext);
            }

            // Have to return globalContext.module.exports
            // becuase module.exports might no longer be equal to moduleExports (export assignment)
            const result = globalContext.module.exports;
            // Reset module/export
            globalContext.exports = mainExports;
            globalContext.module = { exports: mainExports };
            return result;
        };

        vm.createContext(globalContext);

        let result: unknown;
        try {
            result = vm.runInContext(this.getJsCodeWithWrapper(), globalContext);
        } catch (error) {
            const hasMessage = (error: any): error is { message: string } => error.message !== undefined;
            assert(hasMessage(error));
            return new ExecutionError(error.message);
        }

        function removeUndefinedFields(obj: any): any {
            if (obj === null) {
                return undefined;
            }

            if (Array.isArray(obj)) {
                return obj.map(removeUndefinedFields);
            }

            if (typeof obj === "object") {
                const copy: any = {};
                for (const [key, value] of Object.entries(obj)) {
                    if (obj[key] !== undefined) {
                        copy[key] = removeUndefinedFields(value);
                    }
                }

                if (Object.keys(copy).length === 0) {
                    return [];
                }

                return copy;
            }

            return obj;
        }

        return removeUndefinedFields(result);
    }
}

class AccessorTestBuilder extends TestBuilder {
    protected accessor = "";

    protected getLuaCodeWithWrapper(code: string) {
        return `return (function(...)\n${code}\nend)()${this.accessor}`;
    }

    @memoize
    protected getJsCodeWithWrapper(): string {
        return this.getMainJsCodeChunk() + `\n;module.exports = module.exports${this.accessor}`;
    }
}

class BundleTestBuilder extends AccessorTestBuilder {
    constructor(_tsCode: string) {
        super(_tsCode);
        this.setOptions({ luaBundle: "main.lua", luaBundleEntry: this.mainFileName });
    }

    public setEntryPoint(fileName: string): this {
        return this.setOptions({ luaBundleEntry: fileName });
    }
}

class ModuleTestBuilder extends AccessorTestBuilder {
    public setReturnExport(...names: string[]): this {
        expect(this.hasProgram).toBe(false);
        this.accessor = names.map(n => `[${tstl.escapeString(n)}]`).join("");
        return this;
    }
}
class FunctionTestBuilder extends AccessorTestBuilder {
    protected accessor = ".__main()";
    public getTsCode(): string {
        return `${this.tsHeader}export function __main() {${this._tsCode}}`;
    }
}

class ExpressionTestBuilder extends AccessorTestBuilder {
    protected accessor = ".__result";
    public getTsCode(): string {
        return `${this.tsHeader}export const __result = ${this._tsCode};`;
    }
}

class ProjectTestBuilder extends ModuleTestBuilder {
    constructor(private tsConfig: string) {
        super("");
        this.setOptions({ configFilePath: this.tsConfig, ...tstl.parseConfigFileWithSystem(this.tsConfig) });
    }

    @memoize
    public getLuaResult(): tstl.TranspileVirtualProjectResult {
        // Override getLuaResult to use transpileProject with tsconfig.json instead
        const collector = createEmitOutputCollector();
        const { diagnostics } = transpileProject(this.tsConfig, this.options, collector.writeFile);

        return { diagnostics: [...diagnostics], transpiledFiles: collector.files };
    }
}

const createTestBuilderFactory =
    <T extends TestBuilder>(builder: new (_tsCode: string) => T, serializeSubstitutions: boolean) =>
    (...args: [string] | [TemplateStringsArray, ...any[]]): T => {
        let tsCode: string;
        if (typeof args[0] === "string") {
            expect(serializeSubstitutions).toBe(false);
            tsCode = args[0];
        } else {
            let [raw, ...substitutions] = args;
            if (serializeSubstitutions) {
                substitutions = substitutions.map(s => formatCode(s));
            }

            tsCode = String.raw(Object.assign([], { raw }), ...substitutions);
        }

        return new builder(tsCode);
    };

export const testBundle = createTestBuilderFactory(BundleTestBuilder, false);
export const testModule = createTestBuilderFactory(ModuleTestBuilder, false);
export const testModuleTemplate = createTestBuilderFactory(ModuleTestBuilder, true);
export const testFunction = createTestBuilderFactory(FunctionTestBuilder, false);
export const testFunctionTemplate = createTestBuilderFactory(FunctionTestBuilder, true);
export const testExpression = createTestBuilderFactory(ExpressionTestBuilder, false);
export const testExpressionTemplate = createTestBuilderFactory(ExpressionTestBuilder, true);
export const testProject = createTestBuilderFactory(ProjectTestBuilder, false);
