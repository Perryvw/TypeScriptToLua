import * as ts from "typescript";
import * as lua from "../../LuaAST";
import { FunctionVisitor } from "../context";
import { ContextType, getDeclarationContextType } from "../utils/function-context";
import { wrapInToStringForConcat } from "../utils/lua-ast";
import { isStringType } from "../utils/typescript/types";
import { transformArguments, transformContextualCallExpression } from "./call";
import { transformOrderedExpressions } from "./expression-list";

// TODO: Source positions
function getRawLiteral(node: ts.LiteralLikeNode): string {
    let text = node.getText();
    const isLast =
        node.kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral || node.kind === ts.SyntaxKind.TemplateTail;
    text = text.substring(1, text.length - (isLast ? 1 : 2));
    text = text.replace(/\r\n?/g, "\n");
    return text;
}

export const transformTemplateExpression: FunctionVisitor<ts.TemplateExpression> = (node, context) => {
    const parts: lua.Expression[] = [];

    const head = node.head.text;
    if (head.length > 0) {
        parts.push(lua.createStringLiteral(head, node.head));
    }

    const transformedExpressions = transformOrderedExpressions(
        context,
        node.templateSpans.map(s => s.expression)
    );
    for (let i = 0; i < node.templateSpans.length; ++i) {
        const span = node.templateSpans[i];
        const expression = transformedExpressions[i];
        const spanType = context.checker.getTypeAtLocation(span.expression);
        if (isStringType(context, spanType)) {
            parts.push(expression);
        } else {
            parts.push(wrapInToStringForConcat(expression));
        }

        const text = span.literal.text;
        if (text.length > 0) {
            parts.push(lua.createStringLiteral(text, span.literal));
        }
    }

    return parts.reduce((prev, current) => lua.createBinaryExpression(prev, current, lua.SyntaxKind.ConcatOperator));
};

export const transformTaggedTemplateExpression: FunctionVisitor<ts.TaggedTemplateExpression> = (
    expression,
    context
) => {
    const strings: string[] = [];
    const rawStrings: string[] = [];
    const expressions: ts.Expression[] = [];

    if (ts.isTemplateExpression(expression.template)) {
        // Expressions are in the string.
        strings.push(expression.template.head.text);
        rawStrings.push(getRawLiteral(expression.template.head));
        strings.push(...expression.template.templateSpans.map(span => span.literal.text));
        rawStrings.push(...expression.template.templateSpans.map(span => getRawLiteral(span.literal)));
        expressions.push(...expression.template.templateSpans.map(span => span.expression));
    } else {
        // No expressions are in the string.
        strings.push(expression.template.text);
        rawStrings.push(getRawLiteral(expression.template));
    }

    // Construct table with strings and literal strings

    const rawStringsArray = ts.factory.createArrayLiteralExpression(
        rawStrings.map(text => ts.factory.createStringLiteral(text))
    );

    const stringObject = ts.factory.createObjectLiteralExpression([
        ...strings.map((partialString, i) =>
            ts.factory.createPropertyAssignment(
                ts.factory.createNumericLiteral(i + 1),
                ts.factory.createStringLiteral(partialString)
            )
        ),
        ts.factory.createPropertyAssignment("raw", rawStringsArray),
    ]);

    expressions.unshift(stringObject);

    // Evaluate if there is a self parameter to be used.
    const signature = context.checker.getResolvedSignature(expression);
    const signatureDeclaration = signature?.getDeclaration();
    const useSelfParameter =
        signatureDeclaration && getDeclarationContextType(context, signatureDeclaration) !== ContextType.Void;

    if (useSelfParameter) {
        return transformContextualCallExpression(context, expression, expressions, signature);
    }

    // Argument evaluation.
    const callArguments = transformArguments(context, expressions, signature);

    const leftHandSideExpression = context.transformExpression(expression.tag);
    return lua.createCallExpression(leftHandSideExpression, callArguments);
};
