import * as ts from "typescript";
import * as lua from "../../../LuaAST";
import { TransformationContext } from "../../context";
import { performHoisting, popScope, pushScope, ScopeType } from "../../utils/scope";
import { isAssignmentPattern } from "../../utils/typescript";
import { transformAssignment } from "../binary-expression/assignments";
import { transformAssignmentPattern } from "../binary-expression/destructuring-assignments";
import { transformBlockOrStatement } from "../block";
import { transformIdentifier } from "../identifier";
import { checkVariableDeclarationList, transformBindingPattern } from "../variable-declaration";

export function transformLoopBody(
    context: TransformationContext,
    loop: ts.WhileStatement | ts.DoStatement | ts.ForStatement | ts.ForOfStatement | ts.ForInOrOfStatement
): lua.Statement[] {
    pushScope(context, ScopeType.Loop);
    const body = performHoisting(context, transformBlockOrStatement(context, loop.statement));
    const scope = popScope(context);
    const scopeId = scope.id;

    if (!scope.loopContinued) {
        return body;
    }

    const baseResult: lua.Statement[] = [lua.createDoStatement(body)];
    const continueLabel = lua.createLabelStatement(`__continue${scopeId}`);
    baseResult.push(continueLabel);

    return baseResult;
}

export function getVariableDeclarationBinding(
    context: TransformationContext,
    node: ts.VariableDeclarationList
): ts.BindingName {
    checkVariableDeclarationList(context, node);

    if (node.declarations.length === 0) {
        return ts.factory.createIdentifier("____");
    }

    return node.declarations[0].name;
}

export function transformForInitializer(
    context: TransformationContext,
    initializer: ts.ForInitializer,
    block: lua.Block
): lua.Identifier {
    const valueVariable = lua.createIdentifier("____value");

    if (ts.isVariableDeclarationList(initializer)) {
        // Declaration of new variable

        const binding = getVariableDeclarationBinding(context, initializer);
        if (ts.isArrayBindingPattern(binding) || ts.isObjectBindingPattern(binding)) {
            block.statements.unshift(...transformBindingPattern(context, binding, valueVariable));
        } else {
            // Single variable declared in for loop
            return transformIdentifier(context, binding);
        }
    } else {
        // Assignment to existing variable(s)

        block.statements.unshift(
            ...(isAssignmentPattern(initializer)
                ? transformAssignmentPattern(context, initializer, valueVariable, false)
                : transformAssignment(context, initializer, valueVariable))
        );
    }

    return valueVariable;
}

export function invertCondition(expression: lua.Expression) {
    if (lua.isUnaryExpression(expression) && expression.operator === lua.SyntaxKind.NotOperator) {
        return expression.operand;
    } else {
        const notExpression = lua.createUnaryExpression(expression, lua.SyntaxKind.NotOperator);
        lua.setNodePosition(notExpression, lua.getOriginalPos(expression));
        return notExpression;
    }
}
