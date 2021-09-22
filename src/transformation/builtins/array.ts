import * as ts from "typescript";
import * as lua from "../../LuaAST";
import { TransformationContext } from "../context";
import { unsupportedProperty } from "../utils/diagnostics";
import { LuaLibFeature, transformLuaLibFunction } from "../utils/lualib";
import { PropertyCallExpression, transformArguments, transformCallAndArguments } from "../visitors/call";
import { isStringType, isNumberType } from "../utils/typescript";

export function transformArrayConstructorCall(
    context: TransformationContext,
    node: PropertyCallExpression
): lua.CallExpression | undefined {
    const expression = node.expression;
    const signature = context.checker.getResolvedSignature(node);
    const params = transformArguments(context, node.arguments, signature);

    const expressionName = expression.name.text;
    switch (expressionName) {
        case "isArray":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayIsArray, node, ...params);
        default:
            context.diagnostics.push(unsupportedProperty(expression.name, "Array", expressionName));
    }
}

export function transformArrayPrototypeCall(
    context: TransformationContext,
    node: PropertyCallExpression
): lua.CallExpression | undefined {
    const expression = node.expression;
    const signature = context.checker.getResolvedSignature(node);
    const [caller, params] = transformCallAndArguments(context, expression.expression, node.arguments, signature);

    const expressionName = expression.name.text;
    switch (expressionName) {
        case "concat":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayConcat, node, caller, ...params);
        case "entries":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayEntries, node, caller);
        case "push":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayPush, node, caller, ...params);
        case "reverse":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayReverse, node, caller);
        case "shift":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayShift, node, caller);
        case "unshift":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayUnshift, node, caller, ...params);
        case "sort":
            return transformLuaLibFunction(context, LuaLibFeature.ArraySort, node, caller, ...params);
        case "pop":
            return lua.createCallExpression(
                lua.createTableIndexExpression(lua.createIdentifier("table"), lua.createStringLiteral("remove")),
                [caller],
                node
            );
        case "forEach":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayForEach, node, caller, ...params);
        case "find":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayFind, node, caller, ...params);
        case "findIndex":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayFindIndex, node, caller, ...params);
        case "includes":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayIncludes, node, caller, ...params);
        case "indexOf":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayIndexOf, node, caller, ...params);
        case "map":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayMap, node, caller, ...params);
        case "filter":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayFilter, node, caller, ...params);
        case "reduce":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayReduce, node, caller, ...params);
        case "reduceRight":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayReduceRight, node, caller, ...params);
        case "some":
            return transformLuaLibFunction(context, LuaLibFeature.ArraySome, node, caller, ...params);
        case "every":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayEvery, node, caller, ...params);
        case "slice":
            return transformLuaLibFunction(context, LuaLibFeature.ArraySlice, node, caller, ...params);
        case "splice":
            return transformLuaLibFunction(context, LuaLibFeature.ArraySplice, node, caller, ...params);
        case "join":
            const callerType = context.checker.getTypeAtLocation(expression.expression);
            const elementType = context.checker.getElementTypeOfArrayType(callerType);
            if (elementType && (isStringType(context, elementType) || isNumberType(context, elementType))) {
                const defaultSeparatorLiteral = lua.createStringLiteral(",");
                const parameters = [
                    caller,
                    node.arguments.length === 0
                        ? defaultSeparatorLiteral
                        : lua.createBinaryExpression(params[0], defaultSeparatorLiteral, lua.SyntaxKind.OrOperator),
                ];

                return lua.createCallExpression(
                    lua.createTableIndexExpression(lua.createIdentifier("table"), lua.createStringLiteral("concat")),
                    parameters,
                    node
                );
            }

            return transformLuaLibFunction(context, LuaLibFeature.ArrayJoin, node, caller, ...params);
        case "flat":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayFlat, node, caller, ...params);
        case "flatMap":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayFlatMap, node, caller, ...params);
        default:
            context.diagnostics.push(unsupportedProperty(expression.name, "array", expressionName));
    }
}

export function transformArrayProperty(
    context: TransformationContext,
    node: ts.PropertyAccessExpression
): lua.UnaryExpression | undefined {
    switch (node.name.text) {
        case "length":
            const expression = context.transformExpression(node.expression);
            return lua.createUnaryExpression(expression, lua.SyntaxKind.LengthOperator, node);
        default:
            return undefined;
    }
}
