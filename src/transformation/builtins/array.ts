import * as ts from "typescript";
import * as lua from "../../LuaAST";
import { TransformationContext } from "../context";
import { unsupportedProperty } from "../utils/diagnostics";
import { LuaLibFeature, transformLuaLibFunction } from "../utils/lualib";
import { PropertyCallExpression, transformArguments, transformCallAndArguments } from "../visitors/call";
import { isStringType, isNumberType } from "../utils/typescript";
import { moveToPrecedingTemp } from "../visitors/expression-list";
import { wrapInReadonlyTable } from "../utils/lua-ast";

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

/**
 * Optimized single element Array.push
 *
 * array[#array+1] = el
 * return #array
 */
function transformSingleElementArrayPush(
    context: TransformationContext,
    node: PropertyCallExpression,
    caller: lua.Expression,
    param: lua.Expression
): lua.Expression {
    const arrayIdentifier = lua.isIdentifier(caller) ? caller : moveToPrecedingTemp(context, caller);

    // #array + 1
    const lengthExpression = lua.createBinaryExpression(
        lua.createUnaryExpression(arrayIdentifier, lua.SyntaxKind.LengthOperator),
        lua.createNumericLiteral(1),
        lua.SyntaxKind.AdditionOperator
    );

    // array[#array + 1] = <element>
    const pushStatement = lua.createAssignmentStatement(
        lua.createTableIndexExpression(arrayIdentifier, lengthExpression),
        param,
        node
    );
    context.addPrecedingStatements([pushStatement]);

    return lua.setNodeFlags(
        lua.createUnaryExpression(arrayIdentifier, lua.SyntaxKind.LengthOperator),
        lua.NodeFlags.PossiblyNotUsed
    );
}

export function transformArrayPrototypeCall(
    context: TransformationContext,
    node: PropertyCallExpression
): lua.Expression | undefined {
    const expression = node.expression;
    const signature = context.checker.getResolvedSignature(node);
    const [caller, params] = transformCallAndArguments(context, expression.expression, node.arguments, signature);

    const expressionName = expression.name.text;
    switch (expressionName) {
        case "concat":
            return transformLuaLibFunction(
                context,
                LuaLibFeature.ArrayConcat,
                node,
                caller,
                wrapInReadonlyTable(params)
            );
        case "entries":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayEntries, node, caller);
        case "push":
            if (node.arguments.length === 1 && !ts.isSpreadElement(node.arguments[0])) {
                return transformSingleElementArrayPush(context, node, caller, params[0]);
            }

            return transformLuaLibFunction(context, LuaLibFeature.ArrayPush, node, caller, wrapInReadonlyTable(params));
        case "reverse":
            return transformLuaLibFunction(context, LuaLibFeature.ArrayReverse, node, caller);
        case "shift":
            return lua.createCallExpression(
                lua.createTableIndexExpression(lua.createIdentifier("table"), lua.createStringLiteral("remove")),
                [caller, lua.createNumericLiteral(1)],
                node
            );
        case "unshift":
            return transformLuaLibFunction(
                context,
                LuaLibFeature.ArrayUnshift,
                node,
                caller,
                wrapInReadonlyTable(params)
            );
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
                const param = params[0];
                const parameters = [
                    caller,
                    node.arguments.length === 0
                        ? defaultSeparatorLiteral
                        : lua.isStringLiteral(param)
                        ? param
                        : lua.createBinaryExpression(param, defaultSeparatorLiteral, lua.SyntaxKind.OrOperator),
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
