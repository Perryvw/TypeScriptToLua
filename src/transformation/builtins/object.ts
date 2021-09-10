import * as lua from "../../LuaAST";
import { TransformationContext } from "../context";
import { unsupportedProperty } from "../utils/diagnostics";
import { LuaLibFeature, transformLuaLibFunction } from "../utils/lualib";
import { PropertyCallExpression, transformArguments } from "../visitors/call";
import { wrapInReadonlyTable } from "../utils/lua-ast";

export function transformObjectConstructorCall(
    context: TransformationContext,
    expression: PropertyCallExpression
): lua.Expression | undefined {
    const method = expression.expression;
    const args = transformArguments(context, expression.arguments);
    const methodName = method.name.text;

    switch (methodName) {
        case "assign":
            return transformLuaLibFunction(context, LuaLibFeature.ObjectAssign, expression, wrapInReadonlyTable(args));
        case "defineProperty":
            return transformLuaLibFunction(context, LuaLibFeature.ObjectDefineProperty, expression, ...args);
        case "entries":
            return transformLuaLibFunction(context, LuaLibFeature.ObjectEntries, expression, ...args);
        case "fromEntries":
            return transformLuaLibFunction(context, LuaLibFeature.ObjectFromEntries, expression, ...args);
        case "getOwnPropertyDescriptor":
            return transformLuaLibFunction(context, LuaLibFeature.ObjectGetOwnPropertyDescriptor, expression, ...args);
        case "getOwnPropertyDescriptors":
            return transformLuaLibFunction(context, LuaLibFeature.ObjectGetOwnPropertyDescriptors, expression, ...args);
        case "keys":
            return transformLuaLibFunction(context, LuaLibFeature.ObjectKeys, expression, ...args);
        case "values":
            return transformLuaLibFunction(context, LuaLibFeature.ObjectValues, expression, ...args);
        default:
            context.diagnostics.push(unsupportedProperty(method.name, "Object", methodName));
    }
}

export function transformObjectPrototypeCall(
    context: TransformationContext,
    node: PropertyCallExpression
): lua.Expression | undefined {
    const expression = node.expression;
    const signature = context.checker.getResolvedSignature(node);

    const name = expression.name.text;
    switch (name) {
        case "toString":
            const toStringIdentifier = lua.createIdentifier("tostring");
            return lua.createCallExpression(
                toStringIdentifier,
                [context.transformExpression(expression.expression)],
                node
            );
        case "hasOwnProperty":
            const expr = context.transformExpression(expression.expression);
            const parameters = transformArguments(context, node.arguments, signature);
            const rawGetIdentifier = lua.createIdentifier("rawget");
            const rawGetCall = lua.createCallExpression(rawGetIdentifier, [expr, ...parameters]);
            return lua.createBinaryExpression(
                rawGetCall,
                lua.createNilLiteral(),
                lua.SyntaxKind.InequalityOperator,
                node
            );
    }
}
