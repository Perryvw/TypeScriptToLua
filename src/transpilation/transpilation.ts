import { Resolver, ResolverFactory } from "enhanced-resolve";
import * as fs from "fs";
import * as path from "path";
import { SourceNode } from "source-map";
import * as ts from "typescript";
import { CompilerOptions, isBundleEnabled, LuaTarget } from "../CompilerOptions";
import { getLuaLibBundle } from "../LuaLib";
import { assert, cast, isNonNull, normalizeSlashes, trimExtension } from "../utils";
import { Chunk, modulesToBundleChunks, modulesToChunks } from "./chunk";
import { createResolutionErrorDiagnostic } from "./diagnostics";
import { buildModule, Module } from "./module";
import { applyBailPlugin, applySinglePlugin, getPlugins, Plugin } from "./plugins";
import { Transpiler, TranspilerHost } from "./transpiler";
import { isResolveError } from "./utils";

export class Transpilation {
    public readonly diagnostics: ts.Diagnostic[] = [];
    public modules: Module[] = [];

    public host: TranspilerHost;
    public options = this.program.getCompilerOptions() as CompilerOptions;
    public rootDir: string;
    public outDir: string;
    public projectDir: string;

    public plugins: Plugin[];
    protected resolver: Resolver;

    constructor(public transpiler: Transpiler, public program: ts.Program, extraPlugins: Plugin[]) {
        this.host = transpiler.host;

        this.rootDir =
            // getCommonSourceDirectory ignores provided rootDir when TS6059 is emitted
            this.options.rootDir == null
                ? program.getCommonSourceDirectory()
                : ts.getNormalizedAbsolutePath(this.options.rootDir, this.host.getCurrentDirectory());

        this.outDir = this.options.outDir ?? this.rootDir;

        this.projectDir =
            this.options.configFilePath !== undefined
                ? path.dirname(this.options.configFilePath)
                : this.host.getCurrentDirectory();

        this.plugins = getPlugins(this, extraPlugins);

        this.resolver = ResolverFactory.createResolver({
            extensions: [".lua", ".ts", ".tsx", ".js", ".jsx"],
            conditionNames: ["lua", `lua:${this.options.luaTarget ?? LuaTarget.Universal}`],
            fileSystem: this.host.resolutionFileSystem ?? fs,
            useSyncFileSystemCalls: true,
            plugins: this.plugins.flatMap(p => p.getResolvePlugins?.(this) ?? []),
        });
    }

    public emit(): Chunk[] {
        this.modules.forEach(module => this.buildModule(module));

        const lualibRequired = this.modules.some(m => m.source.toString().includes('require("lualib_bundle")'));
        if (lualibRequired) {
            const fileName = normalizeSlashes(path.resolve(this.rootDir, "lualib_bundle.lua"));
            this.modules.unshift({
                request: fileName,
                isBuilt: true,
                source: new SourceNode(null, null, null, getLuaLibBundle(this.host)),
            });
        }

        return this.mapModulesToChunks(this.modules);
    }

    private buildModule(module: Module) {
        buildModule(module, request => {
            const result = this.resolveRequestToModule(module.request, request);
            if ("error" in result) {
                this.diagnostics.push(result.error);
                return { error: ts.flattenDiagnosticMessageText(result.error.messageText, "\n") };
            }

            return this.getModuleId(result);
        });
    }

    private resolveRequestToModule(issuer: string, request: string) {
        let resolvedPath: string;
        try {
            const result = this.resolver.resolveSync({}, path.dirname(issuer), request);
            assert(typeof result === "string", `Invalid resolution result: ${result}`);
            resolvedPath = result;
        } catch (error) {
            if (!isResolveError(error)) throw error;
            return { error: createResolutionErrorDiagnostic(error.message, request, issuer) };
        }

        let module = this.modules.find(m => m.request === resolvedPath);
        if (!module) {
            if (!resolvedPath.endsWith(".lua")) {
                const messageText = `Resolved source file '${resolvedPath}' is not a part of the project.`;
                return { error: createResolutionErrorDiagnostic(messageText, request, issuer) };
            }

            // TODO: Load source map files
            const code = cast(this.host.readFile(resolvedPath), isNonNull);
            module = {
                request: resolvedPath,
                isBuilt: false,
                source: new SourceNode(null, null, null, code),
            };

            this.modules.push(module);
            this.buildModule(module);
        }

        return module;
    }

    public getModuleId(module: Module) {
        const pluginResult = applyBailPlugin(this.plugins, p => p.getModuleId?.(module, this));
        if (pluginResult !== undefined) return pluginResult;

        const result = path.relative(this.rootDir, trimExtension(module.request));
        // TODO: handle files on other drives
        assert(!path.isAbsolute(result), `Invalid path: ${result}`);
        return result
            .replace(/\.\.[/\\]/g, "_/")
            .replace(/\./g, "__")
            .replace(/[/\\]/g, ".");
    }

    private mapModulesToChunks(modules: Module[]): Chunk[] {
        return (
            applySinglePlugin(this.plugins, "mapModulesToChunks")?.(modules, this) ??
            (isBundleEnabled(this.options) ? modulesToBundleChunks(this, modules) : modulesToChunks(this, modules))
        );
    }
}
