import * as ts from "typescript";
import * as lua from "../../LuaAST";
import { TransformationContext } from "../context";
import { createUnpackCall, wrapInTable } from "../utils/lua-ast";
import { LuaLibFeature, transformLuaLibFunction } from "../utils/lualib";
import { getReferenceCountInScope, popScope, pushScope, ScopeType } from "../utils/scope";
import { isConstIdentifier } from "../utils/typescript";

// Cache an expression in a preceding statement and return the temp identifier
export function moveToPrecedingTemp(
    context: TransformationContext,
    expression: lua.Expression,
    tsOriginal?: ts.Node
): lua.Expression {
    if (lua.isLiteral(expression) || (tsOriginal && isConstIdentifier(context, tsOriginal))) {
        return expression;
    }
    const tempIdentifier = context.createTempForLuaExpression(expression);
    const tempDeclaration = lua.createVariableDeclarationStatement(tempIdentifier, expression);
    lua.setNodePosition(tempDeclaration, lua.getOriginalPos(expression));
    context.addPrecedingStatements([tempDeclaration]);
    const tempClone = lua.cloneIdentifier(tempIdentifier);
    lua.setNodePosition(tempClone, lua.getOriginalPos(tempIdentifier));
    return tempClone;
}

function transformExpressionsInOrder(
    context: TransformationContext,
    expressions: readonly ts.Expression[]
): [lua.Expression[], number] {
    // Use a custom scope to track variable references
    const scope = pushScope(context, ScopeType.ExpressionList);

    const transformedExpressions: lua.Expression[] = [];
    const precedingStatements: lua.Statement[][] = [];
    let lastPrecedingStatementsIndex = -1;
    for (let i = 0; i < expressions.length; ++i) {
        const expression = expressions[i];

        // Transform expression and catch preceding statements
        context.pushPrecedingStatements();
        const transformedExpression = context.transformExpression(expression);
        transformedExpressions.push(transformedExpression);
        const expressionPrecedingStatements = context.popPrecedingStatements();
        precedingStatements.push(expressionPrecedingStatements);

        // Track preceding statements
        if (expressionPrecedingStatements.length > 0) {
            lastPrecedingStatementsIndex = i;
        }
    }

    // No need for extra processing if there were no preceding statements generated
    if (lastPrecedingStatementsIndex === -1) {
        popScope(context);
        return [transformedExpressions, lastPrecedingStatementsIndex];
    }

    for (let i = 0; i < transformedExpressions.length; ++i) {
        let transformedExpression = transformedExpressions[i];
        const expression = expressions[i];
        const expressionPrecedingStatements = precedingStatements[i];

        // Bubble up preceding statements
        context.addPrecedingStatements(expressionPrecedingStatements);

        // Cache expression in temp to maintain execution order, unless:
        // - Expression is after the last one in the list which generated preceding statements
        // - Expression is an identifier that hasn't been referenced more than once
        if (
            i >= lastPrecedingStatementsIndex ||
            (lua.isIdentifier(transformedExpression) &&
                transformedExpression.symbolId &&
                getReferenceCountInScope(scope, transformedExpression.symbolId) <= 1)
        ) {
            continue;
        }

        // Wrap spreads in table to store in a temp
        if (ts.isSpreadElement(expression)) {
            transformedExpression = wrapInTable(transformedExpression);
        }

        transformedExpressions[i] = moveToPrecedingTemp(context, transformedExpression, expression);
    }

    popScope(context);
    return [transformedExpressions, lastPrecedingStatementsIndex];
}

// Transforms a series of expressions while maintaining execution order
export function transformOrderedExpressions(
    context: TransformationContext,
    expressions: readonly ts.Expression[]
): lua.Expression[] {
    const [transformedExpressions] = transformExpressionsInOrder(context, expressions);
    return transformedExpressions;
}

function buildArrayConcatCall(
    context: TransformationContext,
    expressions: readonly ts.Expression[],
    transformedExpressions: lua.Expression[],
    lastPrecedingStatementsIndex: number
) {
    const tbls: lua.Expression[] = [];
    let tbl: lua.Expression[] = [];
    for (let i = 0; i < expressions.length; ++i) {
        const transformedExpression = transformedExpressions[i];
        if (ts.isSpreadElement(expressions[i])) {
            if (i < lastPrecedingStatementsIndex) {
                // Spread statements cached in temps will need to be unpacked
                tbls.push(wrapInTable(...tbl, createUnpackCall(context, transformedExpression)));
            } else {
                tbls.push(wrapInTable(...tbl, transformedExpression));
            }
            tbl = [];
        } else {
            tbl.push(transformedExpression);
        }
    }
    if (tbl.length > 0) {
        tbls.push(wrapInTable(...tbl));
    }
    return [createUnpackCall(context, transformLuaLibFunction(context, LuaLibFeature.ArrayConcat, undefined, ...tbls))];
}

// Transforms a list of expressions while flattening spreads and maintaining execution order
export function transformExpressionList(
    context: TransformationContext,
    expressions: readonly ts.Expression[]
): lua.Expression[] {
    const [transformedExpressions, lastPrecedingStatementsIndex] = transformExpressionsInOrder(context, expressions);

    // If there are spreads in the middle, use the array concat lib function
    const firstSpreadIndex = expressions.findIndex(i => ts.isSpreadElement(i));
    if (firstSpreadIndex >= 0 && firstSpreadIndex < expressions.length - 1) {
        return buildArrayConcatCall(context, expressions, transformedExpressions, lastPrecedingStatementsIndex);
    }

    return transformedExpressions;
}
