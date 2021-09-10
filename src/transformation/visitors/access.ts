import * as ts from "typescript";
import * as lua from "../../LuaAST";
import { transformBuiltinPropertyAccessExpression } from "../builtins";
import { FunctionVisitor, TransformationContext } from "../context";
import { AnnotationKind, getTypeAnnotations } from "../utils/annotations";
import { annotationRemoved, invalidMultiReturnAccess } from "../utils/diagnostics";
import { addToNumericExpression } from "../utils/lua-ast";
import { LuaLibFeature, transformLuaLibFunction } from "../utils/lualib";
import { isArrayType, isNumberType, isStringType } from "../utils/typescript";
import { tryGetConstEnumValue } from "./enum";
import { transformOrderedExpressions } from "./expression-list";
import { isMultiReturnCall, returnsMultiType } from "./language-extensions/multi";

export function transformElementAccessArgument(
    context: TransformationContext,
    node: ts.ElementAccessExpression
): lua.Expression {
    const index = context.transformExpression(node.argumentExpression);

    const type = context.checker.getTypeAtLocation(node.expression);
    const argumentType = context.checker.getTypeAtLocation(node.argumentExpression);
    if (isArrayType(context, type) && isNumberType(context, argumentType)) {
        return addToNumericExpression(index, 1);
    }

    return index;
}

export function getElementAccessArgument(
    context: TransformationContext,
    node: ts.ElementAccessExpression,
    index: lua.Expression
): lua.Expression {
    const type = context.checker.getTypeAtLocation(node.expression);
    const argumentType = context.checker.getTypeAtLocation(node.argumentExpression);
    if (isArrayType(context, type) && isNumberType(context, argumentType)) {
        return addToNumericExpression(index, 1);
    }

    return index;
}

export const transformElementAccessExpression: FunctionVisitor<ts.ElementAccessExpression> = (node, context) => {
    const constEnumValue = tryGetConstEnumValue(context, node);
    if (constEnumValue) {
        return constEnumValue;
    }

    let [table, accessExpression] = transformOrderedExpressions(context, [node.expression, node.argumentExpression]);

    const type = context.checker.getTypeAtLocation(node.expression);
    const argumentType = context.checker.getTypeAtLocation(node.argumentExpression);
    if (isStringType(context, type) && isNumberType(context, argumentType)) {
        return transformLuaLibFunction(context, LuaLibFeature.StringAccess, node, table, accessExpression);
    }

    accessExpression = getElementAccessArgument(context, node, accessExpression);

    if (isMultiReturnCall(context, node.expression)) {
        const accessType = context.checker.getTypeAtLocation(node.argumentExpression);
        if (!isNumberType(context, accessType)) {
            context.diagnostics.push(invalidMultiReturnAccess(node));
        }

        // When selecting the first element, we can shortcut
        if (ts.isNumericLiteral(node.argumentExpression) && node.argumentExpression.text === "0") {
            return table;
        } else {
            const selectIdentifier = lua.createIdentifier("select");
            const selectCall = lua.createCallExpression(selectIdentifier, [accessExpression, table]);
            return selectCall;
        }
    }

    if (ts.isOptionalChain(node)) {
        return transformLuaLibFunction(context, LuaLibFeature.OptionalChainAccess, node, table, accessExpression);
    }

    return lua.createTableIndexExpression(table, accessExpression, node);
};

export const transformPropertyAccessExpression: FunctionVisitor<ts.PropertyAccessExpression> = (node, context) => {
    const property = node.name.text;
    const type = context.checker.getTypeAtLocation(node.expression);

    const annotations = getTypeAnnotations(type);

    if (annotations.has(AnnotationKind.LuaTable)) {
        context.diagnostics.push(annotationRemoved(node, AnnotationKind.LuaTable));
    }

    const constEnumValue = tryGetConstEnumValue(context, node);
    if (constEnumValue) {
        return constEnumValue;
    }

    const builtinResult = transformBuiltinPropertyAccessExpression(context, node);
    if (builtinResult) {
        return builtinResult;
    }

    if (ts.isCallExpression(node.expression) && returnsMultiType(context, node.expression)) {
        context.diagnostics.push(invalidMultiReturnAccess(node));
    }

    // Do not output path for member only enums
    if (annotations.has(AnnotationKind.CompileMembersOnly)) {
        if (ts.isPropertyAccessExpression(node.expression)) {
            // in case of ...x.enum.y transform to ...x.y
            return lua.createTableIndexExpression(
                context.transformExpression(node.expression.expression),
                lua.createStringLiteral(property),
                node
            );
        } else {
            return lua.createIdentifier(property, node);
        }
    }

    if (ts.isOptionalChain(node)) {
        // Only handle full optional chains separately, not partial ones
        return transformOptionalChain(context, node);
    }

    const callPath = context.transformExpression(node.expression);
    return lua.createTableIndexExpression(callPath, lua.createStringLiteral(property), node);
};

function transformOptionalChain(
    context: TransformationContext,
    node: ts.OptionalChain & ts.PropertyAccessExpression
): lua.CallExpression {
    const left = context.transformExpression(node.expression);
    const right = lua.createStringLiteral(node.name.text, node.name);

    return transformLuaLibFunction(context, LuaLibFeature.OptionalChainAccess, node, left, right);
}

export const transformQualifiedName: FunctionVisitor<ts.QualifiedName> = (node, context) => {
    const right = lua.createStringLiteral(node.right.text, node.right);
    const left = context.transformExpression(node.left);

    return lua.createTableIndexExpression(left, right, node);
};
