import * as ts from "typescript";
import { SyntaxKind } from "typescript";
import * as lua from "../../../LuaAST";
import { TransformationContext } from "../../context";
import { validateAssignment } from "../../utils/assignment-validation";
import { createExportedIdentifier, getDependenciesOfSymbol, isSymbolExported } from "../../utils/export";
import { createUnpackCall, wrapInTable } from "../../utils/lua-ast";
import { LuaLibFeature, transformLuaLibFunction } from "../../utils/lualib";
import { isArrayType, isDestructuringAssignment } from "../../utils/typescript";
import { isArrayLength, transformDestructuringAssignment } from "./destructuring-assignments";
import { isMultiReturnCall } from "../language-extensions/multi";
import { cannotAssignToNodeOfKind, notAllowedOptionalAssignment } from "../../utils/diagnostics";
import { transformElementAccessArgument } from "../access";
import { moveToPrecedingTemp, transformExpressionList } from "../expression-list";
import { transformInPrecedingStatementScope } from "../../utils/preceding-statements";

export function transformAssignmentLeftHandSideExpression(
    context: TransformationContext,
    node: ts.Expression,
    rightHasPrecedingStatements?: boolean
): lua.AssignmentLeftHandSideExpression {
    // Access expressions need the components of the left side cached in temps before the right side's preceding statements
    if (rightHasPrecedingStatements && (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node))) {
        let table = context.transformExpression(node.expression);
        table = moveToPrecedingTemp(context, table, node.expression);

        let index: lua.Expression;
        if (ts.isElementAccessExpression(node)) {
            index = transformElementAccessArgument(context, node);
            index = moveToPrecedingTemp(context, index, node.argumentExpression);
        } else {
            index = lua.createStringLiteral(node.name.text, node.name);
        }
        return lua.createTableIndexExpression(table, index, node);
    }

    const symbol = context.checker.getSymbolAtLocation(node);
    const left = context.transformExpression(node);

    if (lua.isIdentifier(left) && symbol && isSymbolExported(context, symbol)) {
        return createExportedIdentifier(context, left);
    }

    if (lua.isAssignmentLeftHandSideExpression(left)) {
        return left;
    } else {
        context.diagnostics.push(cannotAssignToNodeOfKind(node, left.kind));
        return lua.createAnonymousIdentifier();
    }
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

    if (ts.isPropertyAccessExpression(lhs) || ts.isElementAccessExpression(lhs)) {
        if (lhs.expression.kind === SyntaxKind.SuperKeyword) {
            const symbol = context.checker.getSymbolAtLocation(lhs);
            if (symbol && symbol.flags & ts.SymbolFlags.SetAccessor) {
                return [
                    lua.createExpressionStatement(
                        transformLuaLibFunction(
                            context,
                            LuaLibFeature.DescriptorSet,
                            parent,
                            lua.createIdentifier("self"),
                            context.transformExpression(lhs.expression),
                            ts.isPropertyAccessExpression(lhs)
                                ? lua.createStringLiteral(lhs.name.text)
                                : context.transformExpression(lhs.argumentExpression),
                            right
                        )
                    ),
                ];
            }
        }
    }

    const symbol =
        lhs.parent && ts.isShorthandPropertyAssignment(lhs.parent)
            ? context.checker.getShorthandAssignmentValueSymbol(lhs.parent)
            : context.checker.getSymbolAtLocation(lhs);

    const dependentSymbols = symbol ? getDependenciesOfSymbol(context, symbol) : [];

    const left = transformAssignmentLeftHandSideExpression(context, lhs, rightHasPrecedingStatements);

    const rootAssignment = lua.createAssignmentStatement(left, right, lhs.parent);

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
    let { precedingStatements: rightPrecedingStatements, result: right } = transformInPrecedingStatementScope(
        context,
        () => context.transformExpression(expression.right)
    );
    context.addPrecedingStatements(rightPrecedingStatements);
    if (isMultiReturnCall(context, expression.right)) {
        right = wrapInTable(right);
    }

    const rightExpr = moveToPrecedingTemp(context, right, expression.right);
    const statements = transformDestructuringAssignment(
        context,
        expression,
        rightExpr,
        rightPrecedingStatements.length > 0
    );

    return { statements, result: rightExpr };
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
        const { precedingStatements, result: right } = transformInPrecedingStatementScope(context, () =>
            context.transformExpression(expression.right)
        );

        const left = transformAssignmentLeftHandSideExpression(
            context,
            expression.left,
            precedingStatements.length > 0
        );

        context.addPrecedingStatements(precedingStatements);
        const rightExpr = moveToPrecedingTemp(context, right, expression.right);
        context.addPrecedingStatements(lua.createAssignmentStatement(left, rightExpr, expression.left));
        return rightExpr;
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
            // Lua's execution order for multi-assignments is not the same as JS's, so we should always
            // break these down when the left side may have side effects.
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
                right = transformExpressionList(context, expression.right.elements);
            } else if (ts.isStringLiteral(expression.right)) {
                right = Array.from(expression.right.text).map(c => lua.createStringLiteral(c));
            } else {
                right = context.transformExpression(expression.right);
                if (!isMultiReturnCall(context, expression.right) && isArrayType(context, rightType)) {
                    right = createUnpackCall(context, right, expression.right);
                }
            }

            const left = expression.left.elements.map(e => transformAssignmentLeftHandSideExpression(context, e));

            return [lua.createAssignmentStatement(left, right, expression)];
        }

        const { statements } = transformDestructuredAssignmentExpression(context, expression);
        return statements;
    } else {
        const { precedingStatements, result: right } = transformInPrecedingStatementScope(context, () =>
            context.transformExpression(expression.right)
        );
        return transformAssignmentWithRightPrecedingStatements(context, expression.left, right, precedingStatements);
    }
}
