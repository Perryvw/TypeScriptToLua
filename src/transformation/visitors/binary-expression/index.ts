import * as ts from "typescript";
import * as lua from "../../../LuaAST";
import { FunctionVisitor, TransformationContext } from "../../context";
import { wrapInToStringForConcat } from "../../utils/lua-ast";
import { LuaLibFeature, transformLuaLibFunction } from "../../utils/lualib";
import { isStandardLibraryType, isStringType, typeCanSatisfy } from "../../utils/typescript";
import { transformTypeOfBinaryExpression } from "../typeof";
import { transformAssignmentExpression, transformAssignmentStatement } from "./assignments";
import { BitOperator, isBitOperator, transformBinaryBitOperation } from "./bit";
import {
    isCompoundAssignmentToken,
    transformCompoundAssignmentExpression,
    transformCompoundAssignmentStatement,
    unwrapCompoundAssignmentToken,
} from "./compound";
import { assert } from "../../../utils";
import { transformOrderedExpressions } from "../expression-list";

type SimpleOperator =
    | ts.AdditiveOperatorOrHigher
    | Exclude<ts.RelationalOperator, ts.SyntaxKind.InstanceOfKeyword | ts.SyntaxKind.InKeyword>
    | ts.EqualityOperator
    | ts.LogicalOperator;

const simpleOperatorsToLua: Record<SimpleOperator, lua.BinaryOperator> = {
    [ts.SyntaxKind.AmpersandAmpersandToken]: lua.SyntaxKind.AndOperator,
    [ts.SyntaxKind.BarBarToken]: lua.SyntaxKind.OrOperator,
    [ts.SyntaxKind.PlusToken]: lua.SyntaxKind.AdditionOperator,
    [ts.SyntaxKind.MinusToken]: lua.SyntaxKind.SubtractionOperator,
    [ts.SyntaxKind.AsteriskToken]: lua.SyntaxKind.MultiplicationOperator,
    [ts.SyntaxKind.AsteriskAsteriskToken]: lua.SyntaxKind.PowerOperator,
    [ts.SyntaxKind.SlashToken]: lua.SyntaxKind.DivisionOperator,
    [ts.SyntaxKind.PercentToken]: lua.SyntaxKind.ModuloOperator,
    [ts.SyntaxKind.GreaterThanToken]: lua.SyntaxKind.GreaterThanOperator,
    [ts.SyntaxKind.GreaterThanEqualsToken]: lua.SyntaxKind.GreaterEqualOperator,
    [ts.SyntaxKind.LessThanToken]: lua.SyntaxKind.LessThanOperator,
    [ts.SyntaxKind.LessThanEqualsToken]: lua.SyntaxKind.LessEqualOperator,
    [ts.SyntaxKind.EqualsEqualsToken]: lua.SyntaxKind.EqualityOperator,
    [ts.SyntaxKind.EqualsEqualsEqualsToken]: lua.SyntaxKind.EqualityOperator,
    [ts.SyntaxKind.ExclamationEqualsToken]: lua.SyntaxKind.InequalityOperator,
    [ts.SyntaxKind.ExclamationEqualsEqualsToken]: lua.SyntaxKind.InequalityOperator,
};

export function transformBinaryOperation(
    context: TransformationContext,
    left: lua.Expression,
    right: lua.Expression,
    operator: BitOperator | SimpleOperator | ts.SyntaxKind.QuestionQuestionToken,
    node: ts.Node
): lua.Expression {
    if (isBitOperator(operator)) {
        return transformBinaryBitOperation(context, node, left, right, operator);
    }

    if (operator === ts.SyntaxKind.QuestionQuestionToken) {
        assert(ts.isBinaryExpression(node));
        return transformNullishCoalescingExpression(context, node, left, right);
    }

    let luaOperator = simpleOperatorsToLua[operator];

    // Check if we need to use string concat operator
    if (operator === ts.SyntaxKind.PlusToken && ts.isBinaryExpression(node)) {
        const typeLeft = context.checker.getTypeAtLocation(node.left);
        const typeRight = context.checker.getTypeAtLocation(node.right);

        const isLeftString = isStringType(context, typeLeft);
        const isRightString = isStringType(context, typeRight);
        if (isLeftString || isRightString) {
            left = isLeftString ? left : wrapInToStringForConcat(left);
            right = isRightString ? right : wrapInToStringForConcat(right);
            luaOperator = lua.SyntaxKind.ConcatOperator;
        }
    }

    return lua.createBinaryExpression(left, right, luaOperator, node);
}

function createShortCircuitBinaryExpression(
    context: TransformationContext,
    node: ts.BinaryExpression,
    operator: BitOperator | SimpleOperator | ts.SyntaxKind.QuestionQuestionToken,
    createCondition: (identifier: lua.Identifier) => lua.Expression
) {
    const lhs = context.transformExpression(node.left);
    context.pushPrecedingStatements();
    const rhs = context.transformExpression(node.right);
    const rightPrecedingStatements = context.popPrecedingStatements();
    if (rightPrecedingStatements.length > 0) {
        const result = context.createTempForLuaExpression(lhs);
        const assignmentStatement = lua.createVariableDeclarationStatement(result, lhs, node.left);
        const ifStatement = lua.createIfStatement(
            createCondition(lua.cloneIdentifier(result)),
            lua.createBlock([...rightPrecedingStatements, lua.createAssignmentStatement(result, rhs)]),
            undefined,
            node.left
        );
        context.addPrecedingStatements([assignmentStatement, ifStatement]);
        return result;
    } else {
        return transformBinaryOperation(context, lhs, rhs, operator, node);
    }
}

export const transformBinaryExpression: FunctionVisitor<ts.BinaryExpression> = (node, context) => {
    const operator = node.operatorToken.kind;

    const typeOfResult = transformTypeOfBinaryExpression(context, node);
    if (typeOfResult) {
        return typeOfResult;
    }

    if (isCompoundAssignmentToken(operator)) {
        const token = unwrapCompoundAssignmentToken(operator);
        return transformCompoundAssignmentExpression(context, node, node.left, node.right, token, false);
    }

    switch (operator) {
        case ts.SyntaxKind.EqualsToken:
            return transformAssignmentExpression(context, node as ts.AssignmentExpression<ts.EqualsToken>);

        case ts.SyntaxKind.InKeyword: {
            const lhs = context.transformExpression(node.left);
            const rhs = context.transformExpression(node.right);
            const indexExpression = lua.createTableIndexExpression(rhs, lhs);
            return lua.createBinaryExpression(
                indexExpression,
                lua.createNilLiteral(),
                lua.SyntaxKind.InequalityOperator,
                node
            );
        }

        case ts.SyntaxKind.InstanceOfKeyword: {
            const lhs = context.transformExpression(node.left);
            const rhs = context.transformExpression(node.right);
            const rhsType = context.checker.getTypeAtLocation(node.right);

            if (isStandardLibraryType(context, rhsType, "ObjectConstructor")) {
                return transformLuaLibFunction(context, LuaLibFeature.InstanceOfObject, node, lhs);
            }

            return transformLuaLibFunction(context, LuaLibFeature.InstanceOf, node, lhs, rhs);
        }

        case ts.SyntaxKind.CommaToken: {
            const statements = context.transformStatements(ts.factory.createExpressionStatement(node.left));
            context.pushPrecedingStatements();
            const result = context.transformExpression(node.right);
            statements.push(...context.popPrecedingStatements());
            context.addPrecedingStatements(statements);
            return result;
        }

        case ts.SyntaxKind.QuestionQuestionToken: {
            return createShortCircuitBinaryExpression(context, node, operator, i =>
                lua.createBinaryExpression(i, lua.createNilLiteral(), lua.SyntaxKind.EqualityOperator, node)
            );
        }

        case ts.SyntaxKind.BarBarToken: {
            return createShortCircuitBinaryExpression(context, node, operator, i =>
                lua.createUnaryExpression(i, lua.SyntaxKind.NotOperator, node)
            );
        }

        case ts.SyntaxKind.AmpersandAmpersandToken: {
            return createShortCircuitBinaryExpression(context, node, operator, i => i);
        }
    }

    const [lhs, rhs] = transformOrderedExpressions(context, [node.left, node.right]);
    return transformBinaryOperation(context, lhs, rhs, operator, node);
};

export function transformBinaryExpressionStatement(
    context: TransformationContext,
    node: ts.ExpressionStatement
): lua.Statement[] | lua.Statement | undefined {
    const expression = node.expression;
    if (!ts.isBinaryExpression(expression)) return;
    const operator = expression.operatorToken.kind;

    if (isCompoundAssignmentToken(operator)) {
        // +=, -=, etc...
        const token = unwrapCompoundAssignmentToken(operator);
        return transformCompoundAssignmentStatement(context, expression, expression.left, expression.right, token);
    } else if (operator === ts.SyntaxKind.EqualsToken) {
        return transformAssignmentStatement(context, expression as ts.AssignmentExpression<ts.EqualsToken>);
    } else if (operator === ts.SyntaxKind.CommaToken) {
        const statements = [
            ...context.transformStatements(ts.factory.createExpressionStatement(expression.left)),
            ...context.transformStatements(ts.factory.createExpressionStatement(expression.right)),
        ];

        return lua.createDoStatement(statements, expression);
    }
}

function transformNullishCoalescingExpression(
    context: TransformationContext,
    node: ts.BinaryExpression,
    transformedLeft: lua.Expression,
    transformedRight: lua.Expression
): lua.Expression {
    const lhsType = context.checker.getTypeAtLocation(node.left);

    // Check if we can take a shortcut to 'lhs or rhs' if the left-hand side cannot be 'false'.
    const typeCanBeFalse = (type: ts.Type) =>
        (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Boolean)) !== 0 ||
        (type.flags & ts.TypeFlags.BooleanLiteral & ts.TypeFlags.PossiblyFalsy) !== 0;
    if (typeCanSatisfy(context, lhsType, typeCanBeFalse)) {
        // lhs can be false, transform to IIFE
        const lhsIdentifier = lua.createIdentifier("____lhs");
        const nilComparison = lua.createBinaryExpression(
            lua.cloneIdentifier(lhsIdentifier),
            lua.createNilLiteral(),
            lua.SyntaxKind.EqualityOperator
        );
        // if ____ == nil then return rhs else return ____ end
        const ifStatement = lua.createIfStatement(
            nilComparison,
            lua.createBlock([lua.createReturnStatement([transformedRight])]),
            lua.createBlock([lua.createReturnStatement([lua.cloneIdentifier(lhsIdentifier)])])
        );
        // (function(lhs') if lhs' == nil then return rhs else return lhs' end)(lhs)
        return lua.createCallExpression(lua.createFunctionExpression(lua.createBlock([ifStatement]), [lhsIdentifier]), [
            transformedLeft,
        ]);
    } else {
        // lhs or rhs
        return lua.createBinaryExpression(transformedLeft, transformedRight, lua.SyntaxKind.OrOperator, node);
    }
}
