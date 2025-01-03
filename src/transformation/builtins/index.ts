import * as ts from "typescript";
import * as lua from "../../LuaAST";
import { TransformationContext } from "../context";
import { createNaN } from "../utils/lua-ast";
import { importLuaLibFeature, LuaLibFeature } from "../utils/lualib";
import { getIdentifierSymbolId } from "../utils/symbols";
import { isStandardLibraryType, isStringType, isArrayType, isFunctionType } from "../utils/typescript";
import { getCalledExpression } from "../visitors/call";
import { transformArrayConstructorCall, transformArrayProperty, transformArrayPrototypeCall } from "./array";
import { transformConsoleCall } from "./console";
import { transformFunctionPrototypeCall, transformFunctionProperty } from "./function";
import { tryTransformBuiltinGlobalCall } from "./global";
import { transformMathCall, transformMathProperty } from "./math";
import { transformNumberConstructorCall, transformNumberPrototypeCall, transformNumberProperty } from "./number";
import { transformObjectConstructorCall, tryTransformObjectPrototypeCall } from "./object";
import { transformPromiseConstructorCall } from "./promise";
import { transformStringConstructorMethodCall, transformStringProperty, transformStringPrototypeCall } from "./string";
import { transformSymbolConstructorCall } from "./symbol";
import { unsupportedBuiltinOptionalCall } from "../utils/diagnostics";
import { LuaTarget } from "../../CompilerOptions";
import { transformMapConstructorCall } from "./map";

export function transformBuiltinPropertyAccessExpression(
    context: TransformationContext,
    node: ts.PropertyAccessExpression
): lua.Expression | undefined {
    const ownerType = context.checker.getTypeAtLocation(node.expression);

    if (ts.isIdentifier(node.expression) && isStandardLibraryType(context, ownerType, undefined)) {
        switch (ownerType.symbol.name) {
            case "NumberConstructor":
                return transformNumberProperty(context, node);
            case "Math":
                return transformMathProperty(context, node);
            case "SymbolConstructor":
                importLuaLibFeature(context, LuaLibFeature.Symbol);
        }
    }

    if (isStringType(context, ownerType)) {
        return transformStringProperty(context, node);
    }

    if (isArrayType(context, ownerType)) {
        return transformArrayProperty(context, node);
    }

    if (isFunctionType(ownerType)) {
        return transformFunctionProperty(context, node);
    }
}

export function transformBuiltinCallExpression(
    context: TransformationContext,
    node: ts.CallExpression
): lua.Expression | undefined {
    const expressionType = context.checker.getTypeAtLocation(node.expression);
    if (ts.isIdentifier(node.expression) && isStandardLibraryType(context, expressionType, undefined)) {
        checkForLuaLibType(context, expressionType);
        const result = tryTransformBuiltinGlobalCall(context, node, expressionType);
        if (result) return result;
    }

    const calledMethod = ts.getOriginalNode(getCalledExpression(node));
    if (ts.isPropertyAccessExpression(calledMethod)) {
        const globalResult = tryTransformBuiltinGlobalMethodCall(context, node, calledMethod);
        if (globalResult) return globalResult;

        const prototypeResult = tryTransformBuiltinPropertyCall(context, node, calledMethod);
        if (prototypeResult) return prototypeResult;

        // object prototype call may work even without resolved signature/type (which the other builtin calls use)
        // e.g. (foo as any).toString()
        // prototype methods take precedence (e.g. number.toString(2))
        const objectResult = tryTransformObjectPrototypeCall(context, node, calledMethod);
        if (objectResult) return objectResult;
    }
}

function tryTransformBuiltinGlobalMethodCall(
    context: TransformationContext,
    node: ts.CallExpression,
    calledMethod: ts.PropertyAccessExpression
) {
    const ownerType = context.checker.getTypeAtLocation(calledMethod.expression);
    const ownerSymbol = tryGetStandardLibrarySymbolOfType(context, ownerType);
    if (!ownerSymbol || (ownerSymbol.parent && context.checker.getFullyQualifiedName(ownerSymbol.parent) !== "global"))
        return;

    let result: lua.Expression | undefined;
    switch (ownerSymbol.name) {
        case "ArrayConstructor":
            result = transformArrayConstructorCall(context, node, calledMethod);
            break;
        case "Console":
            result = transformConsoleCall(context, node, calledMethod);
            break;
        case "MapConstructor":
            result = transformMapConstructorCall(context, node, calledMethod);
            break;
        case "Math":
            result = transformMathCall(context, node, calledMethod);
            break;
        case "StringConstructor":
            result = transformStringConstructorMethodCall(context, node, calledMethod);
            break;
        case "ObjectConstructor":
            result = transformObjectConstructorCall(context, node, calledMethod);
            break;
        case "SymbolConstructor":
            result = transformSymbolConstructorCall(context, node, calledMethod);
            break;
        case "NumberConstructor":
            result = transformNumberConstructorCall(context, node, calledMethod);
            break;
        case "PromiseConstructor":
            result = transformPromiseConstructorCall(context, node, calledMethod);
            break;
    }
    if (result && calledMethod.questionDotToken) {
        // e.g. console?.log()
        context.diagnostics.push(unsupportedBuiltinOptionalCall(calledMethod));
    }
    return result;
}

function tryTransformBuiltinPropertyCall(
    context: TransformationContext,
    node: ts.CallExpression,
    calledMethod: ts.PropertyAccessExpression
) {
    const functionType = context.checker.getTypeAtLocation(node.expression);
    const callSymbol = tryGetStandardLibrarySymbolOfType(context, functionType);
    if (!callSymbol) return;
    const ownerSymbol = callSymbol.parent;
    if (!ownerSymbol || ownerSymbol.parent) return;

    switch (ownerSymbol.name) {
        case "String":
            return transformStringPrototypeCall(context, node, calledMethod);
        case "Number":
            return transformNumberPrototypeCall(context, node, calledMethod);
        case "Array":
        case "ReadonlyArray":
            return transformArrayPrototypeCall(context, node, calledMethod);
        case "Function":
        case "CallableFunction":
        case "NewableFunction":
            return transformFunctionPrototypeCall(context, node, calledMethod);
    }
}

export function transformBuiltinIdentifierExpression(
    context: TransformationContext,
    node: ts.Identifier,
    symbol: ts.Symbol | undefined
): lua.Expression | undefined {
    switch (node.text) {
        case "NaN":
            return createNaN(node);

        case "Infinity":
            if (context.luaTarget === LuaTarget.Lua50) {
                const one = lua.createNumericLiteral(1);
                const zero = lua.createNumericLiteral(0);
                return lua.createBinaryExpression(one, zero, lua.SyntaxKind.DivisionOperator);
            } else {
                const math = lua.createIdentifier("math");
                const huge = lua.createStringLiteral("huge");
                return lua.createTableIndexExpression(math, huge, node);
            }
        case "globalThis":
            return lua.createIdentifier("_G", node, getIdentifierSymbolId(context, node, symbol), "globalThis");
    }
}

const builtinErrorTypeNames = new Set([
    "Error",
    "ErrorConstructor",
    "RangeError",
    "RangeErrorConstructor",
    "ReferenceError",
    "ReferenceErrorConstructor",
    "SyntaxError",
    "SyntaxErrorConstructor",
    "TypeError",
    "TypeErrorConstructor",
    "URIError",
    "URIErrorConstructor",
]);

export function checkForLuaLibType(context: TransformationContext, type: ts.Type): void {
    const symbol = type.symbol;
    if (!symbol || symbol.parent) return;
    const name = symbol.name;

    switch (name) {
        case "Map":
        case "MapConstructor":
            importLuaLibFeature(context, LuaLibFeature.Map);
            return;
        case "Set":
        case "SetConstructor":
            importLuaLibFeature(context, LuaLibFeature.Set);
            return;
        case "WeakMap":
        case "WeakMapConstructor":
            importLuaLibFeature(context, LuaLibFeature.WeakMap);
            return;
        case "WeakSet":
        case "WeakSetConstructor":
            importLuaLibFeature(context, LuaLibFeature.WeakSet);
            return;
        case "Promise":
        case "PromiseConstructor":
            importLuaLibFeature(context, LuaLibFeature.Promise);
            return;
    }

    if (builtinErrorTypeNames.has(name)) {
        importLuaLibFeature(context, LuaLibFeature.Error);
    }
}

export function tryGetStandardLibrarySymbolOfType(
    context: TransformationContext,
    type: ts.Type
): ts.Symbol | undefined {
    if (type.isUnionOrIntersection()) {
        for (const subType of type.types) {
            const symbol = tryGetStandardLibrarySymbolOfType(context, subType);
            if (symbol) return symbol;
        }
    } else if (isStandardLibraryType(context, type, undefined)) {
        return type.symbol;
    }

    return undefined;
}
