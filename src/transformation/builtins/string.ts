import * as ts from "typescript";
import * as lua from "../../LuaAST";
import { TransformationContext } from "../context";
import { unsupportedProperty } from "../utils/diagnostics";
import { createExpressionPlusOne, getNumberLiteralValue, modifyNumericExpression } from "../utils/lua-ast";
import { LuaLibFeature, transformLuaLibFunction } from "../utils/lualib";
import { PropertyCallExpression, transformArguments } from "../visitors/call";

function createStringCall(methodName: string, tsOriginal: ts.Node, ...params: lua.Expression[]): lua.CallExpression {
    const stringIdentifier = lua.createIdentifier("string");
    return lua.createCallExpression(
        lua.createTableIndexExpression(stringIdentifier, lua.createStringLiteral(methodName)),
        params,
        tsOriginal
    );
}

export function transformStringPrototypeCall(
    context: TransformationContext,
    node: PropertyCallExpression
): lua.Expression | undefined {
    const expression = node.expression;
    const signature = context.checker.getResolvedSignature(node);
    const params = transformArguments(context, node.arguments, signature);
    const caller = context.transformExpression(expression.expression);

    const expressionName = expression.name.text;
    switch (expressionName) {
        case "replace":
            return transformLuaLibFunction(context, LuaLibFeature.StringReplace, node, caller, ...params);
        case "concat":
            return transformLuaLibFunction(context, LuaLibFeature.StringConcat, node, caller, ...params);
        case "indexOf":
            const stringExpression = createStringCall(
                "find",
                node,
                caller,
                params[0],
                params[1] ? createExpressionPlusOne(params[1]) : lua.createNilLiteral(),
                lua.createBooleanLiteral(true)
            );

            return lua.createBinaryExpression(
                lua.createBinaryExpression(stringExpression, lua.createNumericLiteral(0), lua.SyntaxKind.OrOperator),
                lua.createNumericLiteral(1),
                lua.SyntaxKind.SubtractionOperator,
                node
            );
        case "substr":
            return transformLuaLibFunction(context, LuaLibFeature.StringSubstr, node, caller, ...params);
        case "substring":
            return transformLuaLibFunction(context, LuaLibFeature.StringSubstring, node, caller, ...params);

        case "slice": {
            const literalArg1 = getNumberLiteralValue(params[0]);
            if (params[0] && literalArg1 !== undefined) {
                let stringSubArgs: lua.Expression[] | undefined = [
                    modifyNumericExpression(params[0], literalArg1 < 0 ? 0 : 1),
                ];

                if (params[1]) {
                    const literalArg2 = getNumberLiteralValue(params[1]);
                    if (literalArg2 !== undefined) {
                        stringSubArgs.push(modifyNumericExpression(params[1], literalArg2 < 0 ? -1 : 0));
                    } else {
                        stringSubArgs = undefined;
                    }
                }

                if (stringSubArgs) {
                    return createStringCall("sub", node, caller, ...stringSubArgs);
                }
            }

            return transformLuaLibFunction(context, LuaLibFeature.StringSlice, node, caller, ...params);
        }

        case "toLowerCase":
            return createStringCall("lower", node, caller);
        case "toUpperCase":
            return createStringCall("upper", node, caller);
        case "trim":
            return transformLuaLibFunction(context, LuaLibFeature.StringTrim, node, caller);
        case "trimEnd":
        case "trimRight":
            return transformLuaLibFunction(context, LuaLibFeature.StringTrimEnd, node, caller);
        case "trimStart":
        case "trimLeft":
            return transformLuaLibFunction(context, LuaLibFeature.StringTrimStart, node, caller);
        case "split":
            return transformLuaLibFunction(context, LuaLibFeature.StringSplit, node, caller, ...params);
        case "charAt":
            const firstParamPlusOne = createExpressionPlusOne(params[0]);
            return createStringCall("sub", node, caller, firstParamPlusOne, firstParamPlusOne);
        case "charCodeAt": {
            const firstParamPlusOne = createExpressionPlusOne(params[0]);
            return createStringCall("byte", node, caller, firstParamPlusOne);
        }
        case "startsWith":
            return transformLuaLibFunction(context, LuaLibFeature.StringStartsWith, node, caller, ...params);
        case "endsWith":
            return transformLuaLibFunction(context, LuaLibFeature.StringEndsWith, node, caller, ...params);
        case "repeat":
            const math = lua.createIdentifier("math");
            const floor = lua.createStringLiteral("floor");
            const parameter = lua.createCallExpression(lua.createTableIndexExpression(math, floor), [params[0]]);
            return createStringCall("rep", node, caller, parameter);
        case "padStart":
            return transformLuaLibFunction(context, LuaLibFeature.StringPadStart, node, caller, ...params);
        case "padEnd":
            return transformLuaLibFunction(context, LuaLibFeature.StringPadEnd, node, caller, ...params);
        default:
            context.diagnostics.push(unsupportedProperty(expression.name, "string", expressionName));
    }
}

export function transformStringConstructorCall(
    context: TransformationContext,
    node: PropertyCallExpression
): lua.Expression | undefined {
    const expression = node.expression;
    const signature = context.checker.getResolvedSignature(node);
    const params = transformArguments(context, node.arguments, signature);

    const expressionName = expression.name.text;
    switch (expressionName) {
        case "fromCharCode":
            return lua.createCallExpression(
                lua.createTableIndexExpression(lua.createIdentifier("string"), lua.createStringLiteral("char")),
                params,
                node
            );

        default:
            context.diagnostics.push(unsupportedProperty(expression.name, "String", expressionName));
    }
}

export function transformStringProperty(
    context: TransformationContext,
    node: ts.PropertyAccessExpression
): lua.UnaryExpression | undefined {
    switch (node.name.text) {
        case "length":
            const expression = context.transformExpression(node.expression);
            return lua.createUnaryExpression(expression, lua.SyntaxKind.LengthOperator, node);
        default:
            context.diagnostics.push(unsupportedProperty(node.name, "string", node.name.text));
    }
}
