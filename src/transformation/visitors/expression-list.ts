import * as ts from "typescript";
import * as lua from "../../LuaAST";
import { TransformationContext } from "../context";
import { assert } from "../../utils";
import { createUnpackCall, wrapInTable } from "../utils/lua-ast";
import { LuaLibFeature, transformLuaLibFunction } from "../utils/lualib";

interface ExpressionListInfo {
    transformedExpression: lua.Expression;
    precedingStatements: lua.Statement[];
    isSpread: boolean;
    needsUnpack?: boolean;
}

function isPrecedingStatementTemp(info: ExpressionListInfo) {
    return info.precedingStatements.length > 0 && lua.isIdentifier(info.transformedExpression);
}

export function moveToPrecedingTemp(context: TransformationContext, expression: lua.Expression) {
    const tempIdentifier = context.createTempForLuaExpression(expression);
    const tempDeclaration = lua.createVariableDeclarationStatement(tempIdentifier, expression);
    lua.setNodePosition(tempDeclaration, lua.getOriginalPos(expression));
    context.addPrecedingStatements([tempDeclaration]);
    const tempClone = lua.cloneIdentifier(tempIdentifier);
    lua.setNodePosition(tempClone, lua.getOriginalPos(tempIdentifier));
    return tempClone;
}

function processPrecedingStatements(
    context: TransformationContext,
    expressionInfo: ExpressionListInfo[],
    lastPrecedingStatementsIndex: number
) {
    if (lastPrecedingStatementsIndex < 0) {
        return;
    }

    for (let i = 0; i < expressionInfo.length; ++i) {
        const info = expressionInfo[i];

        // Bubble up preceding statements
        context.addPrecedingStatements(info.precedingStatements);

        // Cache expression in temp to maintain execution order, unless:
        // - Expression is after the last one in the list which generated preceding statements
        // - Expression is a literal that wouldn't be affected by preceding statements (includes optimized vararg '...')
        // - Expression is a temp identifier which is a result of preceding statements
        if (
            i >= lastPrecedingStatementsIndex ||
            lua.isLiteral(info.transformedExpression) ||
            isPrecedingStatementTemp(info)
        ) {
            continue;
        }

        // Strip 'unpack' from spreads to store in a temp - it will be added back in buildArrayConcatCall, if needed
        if (info.isSpread) {
            assert(lua.isCallExpression(info.transformedExpression) && info.transformedExpression.params.length === 1);
            info.transformedExpression = info.transformedExpression.params[0];
            info.needsUnpack = true;
        }

        // Inject temp assignment in correct place in preceding statements
        info.transformedExpression = moveToPrecedingTemp(context, info.transformedExpression);
    }
}

function buildArrayConcatCall(context: TransformationContext, expressionInfo: ExpressionListInfo[]) {
    const tbls: lua.Expression[] = [];
    let tbl: lua.Expression[] = [];
    for (const info of expressionInfo) {
        if (info.isSpread) {
            if (info.needsUnpack) {
                if (tbl.length === 0) {
                    tbls.push(info.transformedExpression); // Optimize '{table.unpack(x)}' to just 'x'
                } else {
                    tbls.push(wrapInTable(...tbl, createUnpackCall(context, info.transformedExpression)));
                }
            } else {
                tbls.push(wrapInTable(...tbl, info.transformedExpression));
            }
            tbl = [];
        } else {
            tbl.push(info.transformedExpression);
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
    // Transform expressions and collect info about them
    let lastPrecedingStatementsIndex = -1;
    const transformListExpression = (expression: ts.Expression, index: number): ExpressionListInfo => {
        context.pushPrecedingStatements();
        const transformedExpression = context.transformExpression(expression);
        const precedingStatements = context.popPrecedingStatements();
        if (precedingStatements.length > 0) lastPrecedingStatementsIndex = index;
        return { transformedExpression, precedingStatements, isSpread: ts.isSpreadElement(expression) };
    };
    const expressionInfo = expressions.map(transformListExpression);

    // Bubble up preceding statements, generating temps when needed to maintain execution order
    processPrecedingStatements(context, expressionInfo, lastPrecedingStatementsIndex);

    // If there are spreads in the middle, use the array concat lib function
    const firstSpreadIndex = expressionInfo.findIndex(i => i.isSpread);
    if (firstSpreadIndex >= 0 && firstSpreadIndex < expressionInfo.length - 1) {
        return buildArrayConcatCall(context, expressionInfo);
    }

    return expressionInfo.map(e => e.transformedExpression);
}

export function transformOrderedExpressions(
    context: TransformationContext,
    expressions: readonly ts.Expression[]
): lua.Expression[] {
    const transformedExpressions: lua.Expression[] = [];
    const precedingStatements: lua.Statement[][] = [];
    let lastPrecedingStatementsIndex = -1;
    for (let i = 0; i < expressions.length; ++i) {
        context.pushPrecedingStatements();
        transformedExpressions.push(context.transformExpression(expressions[i]));
        const expressionPrecedingStatements = context.popPrecedingStatements();
        precedingStatements.push(expressionPrecedingStatements);
        if (expressionPrecedingStatements.length > 0) {
            lastPrecedingStatementsIndex = i;
        }
    }

    if (lastPrecedingStatementsIndex < 0) {
        return transformedExpressions;
    }

    for (let i = 0; i < transformedExpressions.length; ++i) {
        const transformedExpression = transformedExpressions[i];
        const expressionPrecedingStatements = precedingStatements[i];

        // Bubble up preceding statements
        context.addPrecedingStatements(expressionPrecedingStatements);

        // Cache expression in temp to maintain execution order, unless:
        // - Expression is after the last one in the list which generated preceding statements
        // - Expression is a literal that wouldn't be affected by preceding statements
        // - Expression is a temp identifier which is a result of preceding statements
        if (
            i >= lastPrecedingStatementsIndex ||
            lua.isLiteral(transformedExpression) ||
            (expressionPrecedingStatements.length > 0 && lua.isIdentifier(transformedExpression))
        ) {
            continue;
        }

        transformedExpressions[i] = moveToPrecedingTemp(context, transformedExpression);
    }

    return transformedExpressions;
}
