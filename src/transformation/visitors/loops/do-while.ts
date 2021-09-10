import * as ts from "typescript";
import * as lua from "../../../LuaAST";
import { FunctionVisitor } from "../../context";
import { invertCondition, transformLoopBody } from "./utils";

export const transformWhileStatement: FunctionVisitor<ts.WhileStatement> = (statement, context) => {
    const body = transformLoopBody(context, statement);

    context.pushPrecedingStatements();
    let condition = context.transformExpression(statement.expression);
    const precedingStatements = context.popPrecedingStatements();

    // Change from 'while condition' to 'while true - if not condition then break'
    if (precedingStatements.length > 0) {
        precedingStatements.push(
            lua.createIfStatement(
                invertCondition(condition),
                lua.createBlock([lua.createBreakStatement()]),
                undefined,
                statement.expression
            )
        );
        body.unshift(...precedingStatements);
        condition = lua.createBooleanLiteral(true);
    }

    return lua.createWhileStatement(lua.createBlock(body), condition, statement);
};

export const transformDoStatement: FunctionVisitor<ts.DoStatement> = (statement, context) => {
    const body = lua.createDoStatement(transformLoopBody(context, statement));

    context.pushPrecedingStatements();
    let condition = invertCondition(context.transformExpression(statement.expression));
    const precedingStatements = context.popPrecedingStatements();

    // Change from 'repeat until not condition' to 'repeat - if not condition break - until false'
    if (precedingStatements.length > 0) {
        precedingStatements.push(
            lua.createIfStatement(
                condition,
                lua.createBlock([lua.createBreakStatement()]),
                undefined,
                statement.expression
            )
        );
        condition = lua.createBooleanLiteral(false);
    }

    return lua.createRepeatStatement(lua.createBlock([body, ...precedingStatements]), condition, statement);
};
