import * as ts from "typescript";
import * as lua from "../../../LuaAST";
import { cast } from "../../../utils";
import { TransformationContext } from "../../context";
import { validateAssignment } from "../../utils/assignment-validation";
import { createExportedIdentifier, getDependenciesOfSymbol, isSymbolExported } from "../../utils/export";
import { createUnpackCall, wrapInTable } from "../../utils/lua-ast";
import { LuaLibFeature, transformLuaLibFunction } from "../../utils/lualib";
import { isArrayType, isDestructuringAssignment } from "../../utils/typescript";
import { isArrayLength, transformDestructuringAssignment } from "./destructuring-assignments";
import { isMultiReturnCall } from "../language-extensions/multi";
import { notAllowedOptionalAssignment } from "../../utils/diagnostics";
import { transformElementAccessArgument } from "../access";
import { transformOrderedExpressions } from "../expression-list";

export function transformAssignmentLeftHandSideExpression(
    context: TransformationContext,
    node: ts.Expression,
    rightHasPrecedingStatements?: boolean
): lua.AssignmentLeftHandSideExpression {
    // Cache index expression in a temp so it can be evaluated before right's preceding statements
    if (
        rightHasPrecedingStatements &&
        ts.isElementAccessExpression(node) &&
        !ts.isLiteralExpression(node.argumentExpression)
    ) {
        let table = context.transformExpression(node.expression);

        // If table is complex, it could reference things from the index expression and needs to be cached as well
        if (!ts.isIdentifier(node.expression)) {
            const tableTemp = context.createTempForNode(node.expression);
            context.addPrecedingStatements([lua.createVariableDeclarationStatement(tableTemp, table, node.expression)]);
            table = lua.cloneIdentifier(tableTemp);
        }

        const indexNode = node.argumentExpression;
        const indexTemp = context.createTempForNode(indexNode);
        const index = transformElementAccessArgument(context, node);
        context.addPrecedingStatements([lua.createVariableDeclarationStatement(indexTemp, index, indexNode)]);
        return lua.createTableIndexExpression(table, lua.cloneIdentifier(indexTemp), node);
    }

    const symbol = context.checker.getSymbolAtLocation(node);
    const left = context.transformExpression(node);

    return lua.isIdentifier(left) && symbol && isSymbolExported(context, symbol)
        ? createExportedIdentifier(context, left)
        : cast(left, lua.isAssignmentLeftHandSideExpression);
}

export function transformAssignment(
    context: TransformationContext,
    // TODO: Change type to ts.LeftHandSideExpression?
    lhs: ts.Expression,
    right: lua.Expression,
    rightHasPrecedingStatements?: boolean,
    parent?: ts.Expression
): lua.Statement[] {
    if (ts.isOptionalChain(lhs)) {
        context.diagnostics.push(notAllowedOptionalAssignment(lhs));
        return [];
    }

    if (isArrayLength(context, lhs)) {
        const arrayLengthAssignment = lua.createExpressionStatement(
            transformLuaLibFunction(
                context,
                LuaLibFeature.ArraySetLength,
                parent,
                context.transformExpression(lhs.expression),
                right
            )
        );

        return [arrayLengthAssignment];
    }

    const symbol =
        lhs.parent && ts.isShorthandPropertyAssignment(lhs.parent)
            ? context.checker.getShorthandAssignmentValueSymbol(lhs.parent)
            : context.checker.getSymbolAtLocation(lhs);

    const dependentSymbols = symbol ? getDependenciesOfSymbol(context, symbol) : [];

    const left = transformAssignmentLeftHandSideExpression(context, lhs, rightHasPrecedingStatements);

    const rootAssignment = lua.createAssignmentStatement(left, right, lhs);

    return [
        rootAssignment,
        ...dependentSymbols.map(symbol => {
            const [left] = rootAssignment.left;
            const identifierToAssign = createExportedIdentifier(context, lua.createIdentifier(symbol.name));
            return lua.createAssignmentStatement(identifierToAssign, left);
        }),
    ];
}

export function transformAssignmentWithRightPrecedingStatements(
    context: TransformationContext,
    lhs: ts.Expression,
    right: lua.Expression,
    rightPrecedingStatements: lua.Statement[],
    parent?: ts.Expression
): lua.Statement[] {
    return [
        ...rightPrecedingStatements,
        ...transformAssignment(context, lhs, right, rightPrecedingStatements.length > 0, parent),
    ];
}

function transformDestructuredAssignmentExpression(
    context: TransformationContext,
    expression: ts.DestructuringAssignment
) {
    const rootIdentifier = context.createTempForNode(expression.right);

    context.pushPrecedingStatements();
    let right = context.transformExpression(expression.right);
    const rootPrecedingStatements = context.popPrecedingStatements();
    context.addPrecedingStatements(rootPrecedingStatements);
    if (isMultiReturnCall(context, expression.right)) {
        right = wrapInTable(right);
    }

    const statements = [
        lua.createVariableDeclarationStatement(rootIdentifier, right),
        ...transformDestructuringAssignment(context, expression, rootIdentifier, rootPrecedingStatements.length > 0),
    ];

    return { statements, result: rootIdentifier };
}

export function transformAssignmentExpression(
    context: TransformationContext,
    expression: ts.AssignmentExpression<ts.EqualsToken>
): lua.Expression {
    // Validate assignment
    const rightType = context.checker.getTypeAtLocation(expression.right);
    const leftType = context.checker.getTypeAtLocation(expression.left);
    validateAssignment(context, expression.right, rightType, leftType);

    if (isArrayLength(context, expression.left)) {
        // array.length = x
        return transformLuaLibFunction(
            context,
            LuaLibFeature.ArraySetLength,
            expression,
            context.transformExpression(expression.left.expression),
            context.transformExpression(expression.right)
        );
    }

    if (isDestructuringAssignment(expression)) {
        const { statements, result } = transformDestructuredAssignmentExpression(context, expression);
        context.addPrecedingStatements(statements);
        return result;
    }

    if (ts.isPropertyAccessExpression(expression.left) || ts.isElementAccessExpression(expression.left)) {
        const tempVar = context.createTempForNode(expression.right);
        context.pushPrecedingStatements();
        const right = context.transformExpression(expression.right);
        const precedingStatements = context.popPrecedingStatements();

        const left = transformAssignmentLeftHandSideExpression(
            context,
            expression.left,
            precedingStatements.length > 0
        );

        context.addPrecedingStatements([
            ...precedingStatements,
            lua.createVariableDeclarationStatement(tempVar, right, expression.right),
            lua.createAssignmentStatement(left, lua.cloneIdentifier(tempVar), expression.left),
        ]);
        return lua.cloneIdentifier(tempVar);
    } else {
        // Simple assignment
        // ${left} = ${right}; return ${left}
        const left = context.transformExpression(expression.left);
        const right = context.transformExpression(expression.right);
        context.addPrecedingStatements(transformAssignment(context, expression.left, right));
        return left;
    }
}

const canBeTransformedToLuaAssignmentStatement = (
    context: TransformationContext,
    node: ts.DestructuringAssignment
): node is ts.ArrayDestructuringAssignment =>
    ts.isArrayLiteralExpression(node.left) &&
    node.left.elements.every(element => {
        if (isArrayLength(context, element)) {
            return false;
        }

        if (ts.isPropertyAccessExpression(element) || ts.isElementAccessExpression(element)) {
            return false;
        }

        if (ts.isIdentifier(element)) {
            const symbol = context.checker.getSymbolAtLocation(element);
            if (symbol) {
                const aliases = getDependenciesOfSymbol(context, symbol);
                return aliases.length === 0;
            }
        }
    });

export function transformAssignmentStatement(
    context: TransformationContext,
    expression: ts.AssignmentExpression<ts.EqualsToken>
): lua.Statement[] {
    // Validate assignment
    const rightType = context.checker.getTypeAtLocation(expression.right);
    const leftType = context.checker.getTypeAtLocation(expression.left);
    validateAssignment(context, expression.right, rightType, leftType);

    if (isDestructuringAssignment(expression)) {
        if (canBeTransformedToLuaAssignmentStatement(context, expression)) {
            const rightType = context.checker.getTypeAtLocation(expression.right);
            let right: lua.Expression | lua.Expression[];

            if (ts.isArrayLiteralExpression(expression.right)) {
                right = transformOrderedExpressions(context, expression.right.elements);
            } else {
                right = context.transformExpression(expression.right);
                if (!isMultiReturnCall(context, expression.right) && isArrayType(context, rightType)) {
                    right = createUnpackCall(context, right, expression.right);
                }
            }

            const left = expression.left.elements.map(e => transformAssignmentLeftHandSideExpression(context, e));

            return [lua.createAssignmentStatement(left, right, expression)];
        }

        context.pushPrecedingStatements();
        let right = context.transformExpression(expression.right);
        const rootPrecedingStatements = context.popPrecedingStatements();
        context.addPrecedingStatements(rootPrecedingStatements);
        if (isMultiReturnCall(context, expression.right)) {
            right = wrapInTable(right);
        }

        const rootIdentifier = context.createTempForNode(expression.left);
        return [
            lua.createVariableDeclarationStatement(rootIdentifier, right),
            ...transformDestructuringAssignment(
                context,
                expression,
                rootIdentifier,
                rootPrecedingStatements.length > 0
            ),
        ];
    } else {
        context.pushPrecedingStatements();
        const right = context.transformExpression(expression.right);
        const precedingStatements = context.popPrecedingStatements();
        return transformAssignmentWithRightPrecedingStatements(context, expression.left, right, precedingStatements);
    }
}
