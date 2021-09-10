import * as ts from "typescript";
import { LuaTarget } from "../../CompilerOptions";
import * as lua from "../../LuaAST";
import { TransformationContext } from "../context";
import { unsupportedForTarget, unsupportedProperty, unsupportedSelfFunctionConversion } from "../utils/diagnostics";
import { ContextType, getFunctionContextType } from "../utils/function-context";
import { createUnpackCall } from "../utils/lua-ast";
import { LuaLibFeature, transformLuaLibFunction } from "../utils/lualib";
import { PropertyCallExpression, transformCallAndArguments } from "../visitors/call";

export function transformFunctionPrototypeCall(
    context: TransformationContext,
    node: PropertyCallExpression
): lua.CallExpression | undefined {
    const expression = node.expression;
    const callerType = context.checker.getTypeAtLocation(expression.expression);
    if (getFunctionContextType(context, callerType) === ContextType.Void) {
        context.diagnostics.push(unsupportedSelfFunctionConversion(node));
    }

    const signature = context.checker.getResolvedSignature(node);
    const [caller, params] = transformCallAndArguments(context, expression.expression, node.arguments, signature);
    const expressionName = expression.name.text;
    switch (expressionName) {
        case "apply":
            return lua.createCallExpression(
                caller,
                [params[0], createUnpackCall(context, params[1], node.arguments[1])],
                node
            );
        case "bind":
            return transformLuaLibFunction(context, LuaLibFeature.FunctionBind, node, caller, ...params);
        case "call":
            return lua.createCallExpression(caller, params, node);
        default:
            context.diagnostics.push(unsupportedProperty(expression.name, "function", expressionName));
    }
}

export function transformFunctionProperty(
    context: TransformationContext,
    node: ts.PropertyAccessExpression
): lua.Expression | undefined {
    switch (node.name.text) {
        case "length":
            if (context.luaTarget === LuaTarget.Lua51 || context.luaTarget === LuaTarget.Universal) {
                context.diagnostics.push(unsupportedForTarget(node, "function.length", LuaTarget.Lua51));
            }

            // debug.getinfo(fn)
            const getInfoCall = lua.createCallExpression(
                lua.createTableIndexExpression(lua.createIdentifier("debug"), lua.createStringLiteral("getinfo")),
                [context.transformExpression(node.expression)]
            );

            const nparams = lua.createTableIndexExpression(getInfoCall, lua.createStringLiteral("nparams"));

            const contextType = getFunctionContextType(context, context.checker.getTypeAtLocation(node.expression));
            return contextType === ContextType.NonVoid
                ? lua.createBinaryExpression(nparams, lua.createNumericLiteral(1), lua.SyntaxKind.SubtractionOperator)
                : nparams;

        default:
            context.diagnostics.push(unsupportedProperty(node.name, "function", node.name.text));
    }
}
