import * as ts from "typescript";
import * as lua from "../../../LuaAST";
import { FunctionVisitor } from "../../context";
import { checkVariableDeclarationList, transformVariableDeclaration } from "../variable-declaration";
import { invertCondition, transformLoopBody } from "./utils";

export const transformForStatement: FunctionVisitor<ts.ForStatement> = (statement, context) => {
    const result: lua.Statement[] = [];

    if (statement.initializer) {
        if (ts.isVariableDeclarationList(statement.initializer)) {
            checkVariableDeclarationList(context, statement.initializer);
            // local initializer = value
            result.push(...statement.initializer.declarations.flatMap(d => transformVariableDeclaration(context, d)));
        } else {
            result.push(...context.transformStatements(ts.factory.createExpressionStatement(statement.initializer)));
        }
    }

    const body: lua.Statement[] = transformLoopBody(context, statement);

    let condition: lua.Expression;
    if (statement.condition) {
        context.pushPrecedingStatements();
        condition = context.transformExpression(statement.condition);
        const precedingStatements = context.popPrecedingStatements();

        // Change 'while condition' to 'while true - if not condition break'
        if (precedingStatements.length > 0) {
            precedingStatements.push(
                lua.createIfStatement(
                    invertCondition(condition),
                    lua.createBlock([lua.createBreakStatement()]),
                    undefined,
                    statement.condition
                )
            );
            body.unshift(...precedingStatements);
            condition = lua.createBooleanLiteral(true);
        }
    } else {
        condition = lua.createBooleanLiteral(true);
    }

    if (statement.incrementor) {
        body.push(...context.transformStatements(ts.factory.createExpressionStatement(statement.incrementor)));
    }

    // while (condition) do ... end
    result.push(lua.createWhileStatement(lua.createBlock(body), condition, statement));

    return lua.createDoStatement(result, statement);
};
