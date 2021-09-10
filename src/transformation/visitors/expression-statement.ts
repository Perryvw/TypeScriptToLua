import * as ts from "typescript";
import * as lua from "../../LuaAST";
import { FunctionVisitor } from "../context";
import { transformBinaryExpressionStatement } from "./binary-expression";
import {
    isTableDeleteCall,
    isTableSetCall,
    transformTableDeleteExpression,
    transformTableSetExpression,
} from "./language-extensions/table";
import { transformUnaryExpressionStatement } from "./unary-expression";

export const transformExpressionStatement: FunctionVisitor<ts.ExpressionStatement> = (node, context) => {
    const expression = node.expression;

    if (ts.isCallExpression(expression) && isTableDeleteCall(context, expression)) {
        return transformTableDeleteExpression(context, expression);
    }

    if (ts.isCallExpression(expression) && isTableSetCall(context, expression)) {
        return transformTableSetExpression(context, expression);
    }

    const unaryExpressionResult = transformUnaryExpressionStatement(context, node);
    if (unaryExpressionResult) {
        return unaryExpressionResult;
    }

    const binaryExpressionResult = transformBinaryExpressionStatement(context, node);
    if (binaryExpressionResult) {
        return binaryExpressionResult;
    }

    const result = context.transformExpression(expression);
    return result.flags & lua.NodeFlags.PossiblyNotUsed
        ? undefined
        : lua.isCallExpression(result) || lua.isMethodCallExpression(result)
        ? lua.createExpressionStatement(result)
        : // Assign expression statements to dummy to make sure they're legal Lua
          lua.createVariableDeclarationStatement(lua.createAnonymousIdentifier(), result);
};
