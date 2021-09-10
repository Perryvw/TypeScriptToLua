import * as path from "path";
import { EmitHost } from "./transpilation";

export enum LuaLibFeature {
    ArrayConcat = "ArrayConcat",
    ArrayEntries = "ArrayEntries",
    ArrayEvery = "ArrayEvery",
    ArrayFilter = "ArrayFilter",
    ArrayForEach = "ArrayForEach",
    ArrayFind = "ArrayFind",
    ArrayFindIndex = "ArrayFindIndex",
    ArrayIncludes = "ArrayIncludes",
    ArrayIndexOf = "ArrayIndexOf",
    ArrayIsArray = "ArrayIsArray",
    ArrayJoin = "ArrayJoin",
    ArrayMap = "ArrayMap",
    ArrayPush = "ArrayPush",
    ArrayReduce = "ArrayReduce",
    ArrayReduceRight = "ArrayReduceRight",
    ArrayReverse = "ArrayReverse",
    ArrayUnshift = "ArrayUnshift",
    ArraySort = "ArraySort",
    ArraySlice = "ArraySlice",
    ArraySome = "ArraySome",
    ArraySplice = "ArraySplice",
    ArrayToObject = "ArrayToObject",
    ArrayFlat = "ArrayFlat",
    ArrayFlatMap = "ArrayFlatMap",
    ArraySetLength = "ArraySetLength",
    Await = "Await",
    Class = "Class",
    ClassExtends = "ClassExtends",
    CloneDescriptor = "CloneDescriptor",
    Decorate = "Decorate",
    DecorateParam = "DecorateParam",
    Delete = "Delete",
    DelegatedYield = "DelegatedYield",
    Error = "Error",
    FunctionBind = "FunctionBind",
    Generator = "Generator",
    InstanceOf = "InstanceOf",
    InstanceOfObject = "InstanceOfObject",
    Iterator = "Iterator",
    Map = "Map",
    MathAtan2 = "MathAtan2",
    New = "New",
    Number = "Number",
    NumberIsFinite = "NumberIsFinite",
    NumberIsNaN = "NumberIsNaN",
    NumberToString = "NumberToString",
    ObjectAssign = "ObjectAssign",
    ObjectDefineProperty = "ObjectDefineProperty",
    ObjectEntries = "ObjectEntries",
    ObjectFromEntries = "ObjectFromEntries",
    ObjectGetOwnPropertyDescriptor = "ObjectGetOwnPropertyDescriptor",
    ObjectGetOwnPropertyDescriptors = "ObjectGetOwnPropertyDescriptors",
    ObjectKeys = "ObjectKeys",
    ObjectRest = "ObjectRest",
    ObjectValues = "ObjectValues",
    OptionalChainAccess = "OptionalChainAccess",
    OptionalFunctionCall = "OptionalFunctionCall",
    OptionalMethodCall = "OptionalMethodCall",
    ParseFloat = "ParseFloat",
    ParseInt = "ParseInt",
    Promise = "Promise",
    PromiseAll = "PromiseAll",
    PromiseAllSettled = "PromiseAllSettled",
    PromiseAny = "PromiseAny",
    PromiseRace = "PromiseRace",
    Set = "Set",
    SetDescriptor = "SetDescriptor",
    WeakMap = "WeakMap",
    WeakSet = "WeakSet",
    SourceMapTraceBack = "SourceMapTraceBack",
    Spread = "Spread",
    StringAccess = "StringAccess",
    StringCharAt = "StringCharAt",
    StringCharCodeAt = "StringCharCodeAt",
    StringEndsWith = "StringEndsWith",
    StringIncludes = "StringIncludes",
    StringPadEnd = "StringPadEnd",
    StringPadStart = "StringPadStart",
    StringReplace = "StringReplace",
    StringReplaceAll = "StringReplaceAll",
    StringSlice = "StringSlice",
    StringSplit = "StringSplit",
    StringStartsWith = "StringStartsWith",
    StringSubstr = "StringSubstr",
    StringSubstring = "StringSubstring",
    StringTrim = "StringTrim",
    StringTrimEnd = "StringTrimEnd",
    StringTrimStart = "StringTrimStart",
    Symbol = "Symbol",
    SymbolRegistry = "SymbolRegistry",
    TypeOf = "TypeOf",
    Unpack = "Unpack",
}

/* eslint-disable @typescript-eslint/naming-convention */
export const luaLibDependencies: Readonly<Partial<Record<LuaLibFeature, LuaLibFeature[]>>> = {
    ArrayConcat: [LuaLibFeature.ArrayIsArray],
    ArrayFlat: [LuaLibFeature.ArrayIsArray],
    ArrayFlatMap: [LuaLibFeature.ArrayIsArray],
    ArrayEntries: [LuaLibFeature.Symbol],
    Await: [LuaLibFeature.InstanceOf, LuaLibFeature.New, LuaLibFeature.Promise],
    Decorate: [LuaLibFeature.ObjectGetOwnPropertyDescriptor, LuaLibFeature.SetDescriptor, LuaLibFeature.ObjectAssign],
    DelegatedYield: [LuaLibFeature.StringAccess, LuaLibFeature.Symbol],
    Delete: [LuaLibFeature.ObjectGetOwnPropertyDescriptors],
    Error: [LuaLibFeature.Class, LuaLibFeature.ClassExtends, LuaLibFeature.New],
    FunctionBind: [LuaLibFeature.Unpack, LuaLibFeature.ArrayUnshift],
    Generator: [LuaLibFeature.Symbol],
    InstanceOf: [LuaLibFeature.Symbol],
    Iterator: [LuaLibFeature.Symbol],
    NumberToString: [LuaLibFeature.StringAccess],
    ObjectDefineProperty: [LuaLibFeature.SetDescriptor],
    ObjectFromEntries: [LuaLibFeature.Symbol],
    Promise: [LuaLibFeature.Class, LuaLibFeature.FunctionBind, LuaLibFeature.InstanceOf, LuaLibFeature.New],
    PromiseAll: [LuaLibFeature.InstanceOf, LuaLibFeature.New, LuaLibFeature.Promise, LuaLibFeature.Iterator],
    PromiseAllSettled: [LuaLibFeature.InstanceOf, LuaLibFeature.New, LuaLibFeature.Promise, LuaLibFeature.Iterator],
    PromiseAny: [LuaLibFeature.InstanceOf, LuaLibFeature.New, LuaLibFeature.Promise, LuaLibFeature.Iterator],
    PromiseRace: [LuaLibFeature.InstanceOf, LuaLibFeature.New, LuaLibFeature.Promise, LuaLibFeature.Iterator],
    ParseFloat: [LuaLibFeature.StringAccess],
    ParseInt: [LuaLibFeature.StringSubstr, LuaLibFeature.StringSubstring],
    SetDescriptor: [LuaLibFeature.CloneDescriptor],
    Spread: [LuaLibFeature.Iterator, LuaLibFeature.StringAccess, LuaLibFeature.Unpack],
    StringReplaceAll: [LuaLibFeature.StringSplit],
    SymbolRegistry: [LuaLibFeature.Symbol],

    Map: [LuaLibFeature.Iterator, LuaLibFeature.Symbol, LuaLibFeature.Class],
    Set: [LuaLibFeature.Iterator, LuaLibFeature.Symbol, LuaLibFeature.Class],
    WeakMap: [LuaLibFeature.Symbol, LuaLibFeature.Class],
    WeakSet: [LuaLibFeature.Symbol, LuaLibFeature.Class],
};
/* eslint-enable @typescript-eslint/naming-convention */

export function loadLuaLibFeatures(features: Iterable<LuaLibFeature>, emitHost: EmitHost): string {
    let result = "";

    const loadedFeatures = new Set<LuaLibFeature>();

    function load(feature: LuaLibFeature): void {
        if (loadedFeatures.has(feature)) return;
        loadedFeatures.add(feature);

        const dependencies = luaLibDependencies[feature];
        if (dependencies) {
            dependencies.forEach(load);
        }

        const featurePath = path.resolve(__dirname, `../dist/lualib/${feature}.lua`);
        const luaLibFeature = emitHost.readFile(featurePath);
        if (luaLibFeature !== undefined) {
            result += luaLibFeature + "\n";
        } else {
            throw new Error(`Could not load lualib feature from '${featurePath}'`);
        }
    }

    for (const feature of features) {
        load(feature);
    }

    return result;
}

let luaLibBundleContent: string;
export function getLuaLibBundle(emitHost: EmitHost): string {
    if (luaLibBundleContent === undefined) {
        const lualibPath = path.resolve(__dirname, "../dist/lualib/lualib_bundle.lua");
        const result = emitHost.readFile(lualibPath);
        if (result !== undefined) {
            luaLibBundleContent = result;
        } else {
            throw new Error(`Could not load lualib bundle from '${lualibPath}'`);
        }
    }

    return luaLibBundleContent;
}
