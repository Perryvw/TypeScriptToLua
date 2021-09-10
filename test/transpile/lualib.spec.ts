import * as ts from "typescript";
import { LuaLibFeature } from "../../src";
import { loadLuaLibFeatures, luaLibDependencies } from "../../src/LuaLib";
import * as path from "path";
import * as fs from "fs";

test.each(Object.entries(LuaLibFeature))("Lualib feature has correct dependencies (%p)", (_, feature) => {
    const lualibCode = loadLuaLibFeatures([feature], ts.sys);

    // Find all used lualib features
    const luaLibReferences = lualibCode.match(/__TS__[a-zA-Z_]+\(/g);

    // For every reference lualib function, check if its definition is also included
    const missingReferences = [];

    if (luaLibReferences !== null) {
        for (const reference of luaLibReferences) {
            if (
                !lualibCode.includes(`function ${reference}`) &&
                !lualibCode.includes(`${reference.substring(0, reference.length - 1)} =`)
            ) {
                missingReferences.push(reference);
            }
        }
    }

    expect(missingReferences).toHaveLength(0);
});

describe("Lualib dependencies match what is needed", () => {
    const lualibText = new Map<LuaLibFeature, string>();
    const definedBy = new Map<string, LuaLibFeature>();
    beforeAll(done => {
        definedBy.set("Symbol", LuaLibFeature.Symbol);
        void Promise.all(
            Object.values(LuaLibFeature).map(async feature => {
                const featurePath = path.resolve(__dirname, `../../dist/lualib/${feature}.lua`);
                const luaLibFeature = await fs.promises.readFile(featurePath, "utf-8");
                lualibText.set(feature, luaLibFeature);
                const defines = Array.from(
                    luaLibFeature.matchAll(/function (__TS__[a-zA-Z_]+)\(|(__TS__[a-zA-Z_]+) =/g)
                ).map(match => match[1] ?? match[2]);
                for (const define of defines) {
                    // if duplicate define, will be caught by build-lualib
                    definedBy.set(define, feature);
                }
            })
        ).then(() => done());
    });

    test.each(Object.entries(LuaLibFeature))("%p", (_, feature) => {
        const lualibFeature = lualibText.get(feature)!;

        // Find all used lualib references
        // __TS__* or Symbol, not surrounded by valid id characters
        const luaLibReferences = new Set(
            Array.from(lualibFeature.matchAll(/(?<![a-zA-Z_0-9])(__TS__[a-zA-Z_]+|Symbol)(?![a-zA-Z_0-9])/g)).map(
                match => match[1]
            )
        );

        const neededDependencies = new Set<LuaLibFeature>();
        for (const luaLibReference of luaLibReferences) {
            const dependency = definedBy.get(luaLibReference);
            if (!dependency) {
                throw new Error(`Reference to nonexistent lualib value: ${luaLibReference}`);
            }
            neededDependencies.add(dependency);
        }
        neededDependencies.delete(feature);

        const dependencies = new Set(luaLibDependencies[feature]);
        expect(dependencies).toEqual(neededDependencies);
    });
});
