import * as ts from "typescript";
import * as lua from "../../../../LuaAST";
import { TransformationContext } from "../../../context";
import { createSelfIdentifier } from "../../../utils/lua-ast";
import { popScope, pushScope, ScopeType } from "../../../utils/scope";
import { transformFunctionBodyContent, transformFunctionBodyHeader, transformParameters } from "../../function";
import { transformIdentifier } from "../../identifier";
import { transformClassInstanceFields } from "./fields";

export function createPrototypeName(className: lua.Identifier): lua.TableIndexExpression {
    return lua.createTableIndexExpression(lua.cloneIdentifier(className), lua.createStringLiteral("prototype"));
}

export function createConstructorName(className: lua.Identifier): lua.TableIndexExpression {
    return lua.createTableIndexExpression(createPrototypeName(className), lua.createStringLiteral("____constructor"));
}

export function transformConstructorDeclaration(
    context: TransformationContext,
    statement: ts.ConstructorDeclaration,
    className: lua.Identifier,
    instanceFields: ts.PropertyDeclaration[],
    classDeclaration: ts.ClassLikeDeclaration
): lua.Statement | undefined {
    // Don't transform methods without body (overload declarations)
    if (!statement.body) {
        return undefined;
    }

    // Transform body
    const scope = pushScope(context, ScopeType.Function);
    const body = transformFunctionBodyContent(context, statement.body);

    const [params, dotsLiteral, restParamName] = transformParameters(
        context,
        statement.parameters,
        createSelfIdentifier()
    );

    // Make sure default parameters are assigned before fields are initialized
    const bodyWithFieldInitializers = transformFunctionBodyHeader(context, scope, statement.parameters, restParamName);

    // Check for field declarations in constructor
    const constructorFieldsDeclarations = statement.parameters.filter(p => p.modifiers !== undefined);

    const classInstanceFields = transformClassInstanceFields(context, instanceFields);

    // If there are field initializers and the first statement is a super call,
    // move super call between default assignments and initializers
    if (
        (constructorFieldsDeclarations.length > 0 || classInstanceFields.length > 0) &&
        statement.body &&
        statement.body.statements.length > 0
    ) {
        const firstStatement = statement.body.statements[0];
        if (
            ts.isExpressionStatement(firstStatement) &&
            ts.isCallExpression(firstStatement.expression) &&
            firstStatement.expression.expression.kind === ts.SyntaxKind.SuperKeyword
        ) {
            const superCall = body.shift();
            if (superCall) {
                bodyWithFieldInitializers.push(superCall);
            }
        }
    }

    // Add in instance field declarations
    for (const declaration of constructorFieldsDeclarations) {
        if (ts.isIdentifier(declaration.name)) {
            // self.declarationName = declarationName
            const assignment = lua.createAssignmentStatement(
                lua.createTableIndexExpression(createSelfIdentifier(), lua.createStringLiteral(declaration.name.text)),
                transformIdentifier(context, declaration.name)
            );
            bodyWithFieldInitializers.push(assignment);
        }
        // else { TypeScript error: A parameter property may not be declared using a binding pattern }
    }

    bodyWithFieldInitializers.push(...classInstanceFields);

    bodyWithFieldInitializers.push(...body);

    const block = lua.createBlock(bodyWithFieldInitializers);

    const constructorWasGenerated = statement.pos === -1;

    popScope(context);

    return lua.createAssignmentStatement(
        createConstructorName(className),
        lua.createFunctionExpression(block, params, dotsLiteral, lua.NodeFlags.Declaration),
        constructorWasGenerated ? classDeclaration : statement
    );
}
