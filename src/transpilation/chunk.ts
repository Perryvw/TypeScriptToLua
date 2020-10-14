import * as path from "path";
import { SourceNode } from "source-map";
import * as ts from "typescript";
import { CompilerOptions, isBundleEnabled } from "../CompilerOptions";
import { escapeString } from "../LuaPrinter";
import { assert, normalizeSlashes } from "../utils";
import { couldNotFindBundleEntryPoint } from "./diagnostics";
import { Module } from "./module";
import { Transpilation } from "./transpilation";
import { getConfigDirectory } from "./utils";

export interface Chunk {
    outputPath: string;
    code: string;
    sourceMap?: string;
    sourceFiles?: ts.SourceFile[];
}

export function modulesToChunks(transpilation: Transpilation, modules: Module[]): Chunk[] {
    return modules.map(module => {
        const moduleId = transpilation.getModuleId(module);
        const outputPath = normalizeSlashes(path.resolve(transpilation.outDir, `${moduleId.replace(/\./g, "/")}.lua`));
        return { outputPath, code: module.code, sourceMap: module.sourceMap, sourceFiles: module.sourceFiles };
    });
}

// Override `require` to read from ____modules table.
const requireOverride = `
local ____modules = {}
local ____moduleCache = {}
local ____originalRequire = require
local function require(file)
    if ____moduleCache[file] then
        return ____moduleCache[file]
    end
    if ____modules[file] then
        ____moduleCache[file] = ____modules[file]()
        return ____moduleCache[file]
    else
        if ____originalRequire then
            return ____originalRequire(file)
        else
            error("module '" .. file .. "' not found")
        end
    end
end
`;

export function modulesToBundleChunks(transpilation: Transpilation, modules: Module[]): Chunk[] {
    const options = transpilation.program.getCompilerOptions() as CompilerOptions;
    assert(isBundleEnabled(options));
    const projectDirectory = getConfigDirectory(options, transpilation.emitHost);
    const outputPath = normalizeSlashes(path.resolve(projectDirectory, options.luaBundle));

    // Resolve project settings relative to project file.
    const entryFileName = normalizeSlashes(path.resolve(projectDirectory, options.luaBundleEntry));
    const entryModule = modules.find(m => m.request === entryFileName);
    if (entryModule === undefined) {
        transpilation.diagnostics.push(couldNotFindBundleEntryPoint(options.luaBundleEntry));
        return [{ outputPath, code: "" }];
    }

    // For each file: ["<module path>"] = function() <lua content> end,
    const moduleTableEntries = modules.map(m => moduleSourceNode(m, escapeString(transpilation.getModuleId(m))));

    // Create ____modules table containing all entries from moduleTableEntries
    const moduleTable = createModuleTableNode(moduleTableEntries);

    // return require("<entry module path>")
    const bootstrap = `return require(${escapeString(transpilation.getModuleId(entryModule))})\n`;

    const bundleNode = joinSourceChunks([requireOverride, moduleTable, bootstrap]);
    const { code, map } = bundleNode.toStringWithSourceMap();

    return [
        {
            outputPath,
            code,
            sourceMap: map.toString(),
            sourceFiles: modules.flatMap(x => x.sourceFiles ?? []),
        },
    ];
}

function moduleSourceNode(module: Module, modulePath: string): SourceNode {
    return joinSourceChunks([`[${modulePath}] = function()\n`, module.sourceMapNode ?? module.code, "\nend,\n"]);
}

function createModuleTableNode(fileChunks: SourceChunk[]): SourceNode {
    return joinSourceChunks(["____modules = {\n", ...fileChunks, "}\n"]);
}

type SourceChunk = string | SourceNode;
function joinSourceChunks(chunks: SourceChunk[]): SourceNode {
    return new SourceNode(null, null, null, chunks);
}
