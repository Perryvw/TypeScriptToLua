// Simplified Lua AST based roughly on http://lua-users.org/wiki/MetaLuaAbstractSyntaxTree,
// https://www.lua.org/manual/5.3/manual.html#9 and the TS AST implementation

// We can elide a lot of nodes especially tokens and keywords
// because we don't create the AST from text

import * as ts from "typescript";
import { LuaLibFeature } from "./transformation/utils/lualib";
import { castArray } from "./utils";

export enum SyntaxKind {
    File,
    Block,

    // Statements
    DoStatement,
    VariableDeclarationStatement,
    AssignmentStatement,
    IfStatement,
    WhileStatement,
    RepeatStatement,
    ForStatement,
    ForInStatement,
    GotoStatement,
    LabelStatement,
    ReturnStatement,
    BreakStatement,
    ExpressionStatement,

    // Expression
    StringLiteral,
    NumericLiteral,
    NilKeyword,
    DotsKeyword,
    TrueKeyword,
    FalseKeyword,
    FunctionExpression,
    TableFieldExpression,
    TableExpression,
    UnaryExpression,
    BinaryExpression,
    CallExpression,
    MethodCallExpression,
    Identifier,
    TableIndexExpression,

    // Operators

    // Arithmetic
    AdditionOperator, // Maybe use abbreviations for those add, sub, mul ...
    SubtractionOperator,
    MultiplicationOperator,
    DivisionOperator,
    FloorDivisionOperator,
    ModuloOperator,
    PowerOperator,
    NegationOperator, // Unary minus

    // Concat
    ConcatOperator,

    // Length
    LengthOperator, // Unary

    // Relational Ops
    EqualityOperator,
    InequalityOperator,
    LessThanOperator,
    LessEqualOperator,
    // Syntax Sugar `x > y` <=> `not (y <= x)`
    // but we should probably use them to make the output code more readable
    GreaterThanOperator,
    GreaterEqualOperator, // Syntax Sugar `x >= y` <=> `not (y < x)`

    // Logical
    AndOperator,
    OrOperator,
    NotOperator, // Unary

    // Bitwise
    BitwiseAndOperator,
    BitwiseOrOperator,
    BitwiseExclusiveOrOperator,
    BitwiseRightShiftOperator,
    BitwiseLeftShiftOperator,
    BitwiseNotOperator, // Unary
}

export enum NodeFlags {
    None = 0,
    Inline = 1 << 0, // Keep function body on same line
    Declaration = 1 << 1, // Prefer declaration syntax `function foo()` over assignment syntax `foo = function()`
    PossiblyNotUsed = 1 << 2, // for an expression, if in an ExpressionStatement, statement is not emitted
    IsUnpackCall = 1 << 3,
}

// TODO maybe name this PrefixUnary? not sure it makes sense to do so, because all unary ops in Lua are prefix
export type UnaryBitwiseOperator = SyntaxKind.BitwiseNotOperator;

export type UnaryOperator =
    | SyntaxKind.NegationOperator
    | SyntaxKind.LengthOperator
    | SyntaxKind.NotOperator
    | UnaryBitwiseOperator;

export type BinaryBitwiseOperator =
    | SyntaxKind.BitwiseAndOperator
    | SyntaxKind.BitwiseOrOperator
    | SyntaxKind.BitwiseExclusiveOrOperator
    | SyntaxKind.BitwiseRightShiftOperator
    | SyntaxKind.BitwiseLeftShiftOperator;

export type BinaryOperator =
    | SyntaxKind.AdditionOperator
    | SyntaxKind.SubtractionOperator
    | SyntaxKind.MultiplicationOperator
    | SyntaxKind.DivisionOperator
    | SyntaxKind.FloorDivisionOperator
    | SyntaxKind.ModuloOperator
    | SyntaxKind.PowerOperator
    | SyntaxKind.ConcatOperator
    | SyntaxKind.EqualityOperator
    | SyntaxKind.InequalityOperator
    | SyntaxKind.LessThanOperator
    | SyntaxKind.LessEqualOperator
    | SyntaxKind.GreaterThanOperator
    | SyntaxKind.GreaterEqualOperator
    | SyntaxKind.AndOperator
    | SyntaxKind.OrOperator
    | BinaryBitwiseOperator;

export type Operator = UnaryOperator | BinaryOperator;

export type SymbolId = number & { _symbolIdBrand: any };

export interface TextRange {
    line?: number;
    column?: number;
}

export interface Node extends TextRange {
    kind: SyntaxKind;
    flags: NodeFlags;
}

export function createNode(kind: SyntaxKind, tsOriginal?: ts.Node, flags: NodeFlags = NodeFlags.None): Node {
    if (tsOriginal === undefined) {
        return { kind, flags };
    }

    const sourcePosition = getSourcePosition(tsOriginal);
    if (sourcePosition) {
        return { kind, flags, line: sourcePosition.line, column: sourcePosition.column };
    } else {
        return { kind, flags };
    }
}

export function cloneNode<T extends Node>(node: T): T {
    return { ...node };
}

export function setNodeFlags<T extends Node>(node: T, flags: NodeFlags): T {
    node.flags = flags;
    return node;
}

export function addNodeFlags<T extends Node>(node: T, flags: NodeFlags): T {
    node.flags |= flags;
    return node;
}

export function setNodePosition<T extends Node>(node: T, position: TextRange): T {
    node.line = position.line;
    node.column = position.column;

    return node;
}

export function setNodeOriginal<T extends Node>(node: T, tsOriginal: ts.Node): T;
export function setNodeOriginal<T extends Node>(node: T | undefined, tsOriginal: ts.Node): T | undefined;
export function setNodeOriginal<T extends Node>(node: T | undefined, tsOriginal: ts.Node): T | undefined {
    if (node === undefined) {
        return undefined;
    }

    const sourcePosition = getSourcePosition(tsOriginal);
    if (sourcePosition) {
        setNodePosition(node, sourcePosition);
    }

    return node;
}

function getSourcePosition(sourceNode: ts.Node): TextRange | undefined {
    const parseTreeNode = ts.getParseTreeNode(sourceNode) ?? sourceNode;
    const sourceFile = parseTreeNode.getSourceFile();
    if (sourceFile !== undefined && parseTreeNode.pos >= 0) {
        const { line, character } = ts.getLineAndCharacterOfPosition(
            sourceFile,
            parseTreeNode.pos + parseTreeNode.getLeadingTriviaWidth()
        );

        return { line, column: character };
    }
}

export function getOriginalPos(node: Node): TextRange {
    return { line: node.line, column: node.column };
}

export interface File extends Node {
    kind: SyntaxKind.File;
    statements: Statement[];
    luaLibFeatures: Set<LuaLibFeature>;
    trivia: string;
}

export function isFile(node: Node): node is File {
    return node.kind === SyntaxKind.File;
}

export function createFile(
    statements: Statement[],
    luaLibFeatures: Set<LuaLibFeature>,
    trivia: string,
    tsOriginal?: ts.Node
): File {
    const file = createNode(SyntaxKind.File, tsOriginal) as File;
    file.statements = statements;
    file.luaLibFeatures = luaLibFeatures;
    file.trivia = trivia;
    return file;
}

export interface Block extends Node {
    kind: SyntaxKind.Block;
    statements: Statement[];
}

export function isBlock(node: Node): node is Block {
    return node.kind === SyntaxKind.Block;
}

export function createBlock(statements: Statement[], tsOriginal?: ts.Node): Block {
    const block = createNode(SyntaxKind.Block, tsOriginal) as Block;
    block.statements = statements;
    return block;
}

export interface Statement extends Node {
    _statementBrand: any;
    leadingComments?: Array<string | string[]>;
    trailingComments?: Array<string | string[]>;
}

export interface DoStatement extends Statement {
    kind: SyntaxKind.DoStatement;
    statements: Statement[];
}

export function isDoStatement(node: Node): node is DoStatement {
    return node.kind === SyntaxKind.DoStatement;
}

export function createDoStatement(statements: Statement[], tsOriginal?: ts.Node): DoStatement {
    const statement = createNode(SyntaxKind.DoStatement, tsOriginal) as DoStatement;
    statement.statements = statements;
    return statement;
}

// `local test1, test2 = 12, 42` or `local test1, test2`
export interface VariableDeclarationStatement extends Statement {
    kind: SyntaxKind.VariableDeclarationStatement;
    left: Identifier[];
    right?: Expression[];
}

export function isVariableDeclarationStatement(node: Node): node is VariableDeclarationStatement {
    return node.kind === SyntaxKind.VariableDeclarationStatement;
}

export function createVariableDeclarationStatement(
    left: Identifier | Identifier[],
    right?: Expression | Expression[],
    tsOriginal?: ts.Node
): VariableDeclarationStatement {
    const statement = createNode(SyntaxKind.VariableDeclarationStatement, tsOriginal) as VariableDeclarationStatement;
    statement.left = castArray(left);
    if (right) statement.right = castArray(right);
    return statement;
}

// `test1, test2 = 12, 42`
export interface AssignmentStatement extends Statement {
    kind: SyntaxKind.AssignmentStatement;
    left: AssignmentLeftHandSideExpression[];
    right: Expression[];
}

export function isAssignmentStatement(node: Node): node is AssignmentStatement {
    return node.kind === SyntaxKind.AssignmentStatement;
}

export function createAssignmentStatement(
    left: AssignmentLeftHandSideExpression | AssignmentLeftHandSideExpression[],
    right?: Expression | Expression[],
    tsOriginal?: ts.Node
): AssignmentStatement {
    const statement = createNode(SyntaxKind.AssignmentStatement, tsOriginal) as AssignmentStatement;
    statement.left = castArray(left);
    statement.right = right ? castArray(right) : [];
    return statement;
}

export interface IfStatement extends Statement {
    kind: SyntaxKind.IfStatement;
    condition: Expression;
    ifBlock: Block;
    elseBlock?: Block | IfStatement;
}

export function isIfStatement(node: Node): node is IfStatement {
    return node.kind === SyntaxKind.IfStatement;
}

export function createIfStatement(
    condition: Expression,
    ifBlock: Block,
    elseBlock?: Block | IfStatement,
    tsOriginal?: ts.Node
): IfStatement {
    const statement = createNode(SyntaxKind.IfStatement, tsOriginal) as IfStatement;
    statement.condition = condition;
    statement.ifBlock = ifBlock;
    statement.elseBlock = elseBlock;
    return statement;
}

export interface IterationStatement extends Statement {
    body: Block;
}

export function isIterationStatement(node: Node): node is IterationStatement {
    return (
        node.kind === SyntaxKind.WhileStatement ||
        node.kind === SyntaxKind.RepeatStatement ||
        node.kind === SyntaxKind.ForStatement ||
        node.kind === SyntaxKind.ForInStatement
    );
}

export interface WhileStatement extends IterationStatement {
    kind: SyntaxKind.WhileStatement;
    condition: Expression;
}

export function isWhileStatement(node: Node): node is WhileStatement {
    return node.kind === SyntaxKind.WhileStatement;
}

export function createWhileStatement(body: Block, condition: Expression, tsOriginal?: ts.Node): WhileStatement {
    const statement = createNode(SyntaxKind.WhileStatement, tsOriginal) as WhileStatement;
    statement.body = body;
    statement.condition = condition;
    return statement;
}

export interface RepeatStatement extends IterationStatement {
    kind: SyntaxKind.RepeatStatement;
    condition: Expression;
}

export function isRepeatStatement(node: Node): node is RepeatStatement {
    return node.kind === SyntaxKind.RepeatStatement;
}

export function createRepeatStatement(body: Block, condition: Expression, tsOriginal?: ts.Node): RepeatStatement {
    const statement = createNode(SyntaxKind.RepeatStatement, tsOriginal) as RepeatStatement;
    statement.body = body;
    statement.condition = condition;
    return statement;
}

// TODO maybe rename to ForNumericStatement
export interface ForStatement extends IterationStatement {
    kind: SyntaxKind.ForStatement;
    controlVariable: Identifier;
    controlVariableInitializer: Expression;
    limitExpression: Expression;
    stepExpression?: Expression;
}

export function isForStatement(node: Node): node is ForStatement {
    return node.kind === SyntaxKind.ForStatement;
}

export function createForStatement(
    body: Block,
    controlVariable: Identifier,
    controlVariableInitializer: Expression,
    limitExpression: Expression,
    stepExpression?: Expression,
    tsOriginal?: ts.Node
): ForStatement {
    const statement = createNode(SyntaxKind.ForStatement, tsOriginal) as ForStatement;
    statement.body = body;
    statement.controlVariable = controlVariable;
    statement.controlVariableInitializer = controlVariableInitializer;
    statement.limitExpression = limitExpression;
    statement.stepExpression = stepExpression;
    return statement;
}

export interface ForInStatement extends IterationStatement {
    kind: SyntaxKind.ForInStatement;
    names: Identifier[];
    expressions: Expression[];
}

export function isForInStatement(node: Node): node is ForInStatement {
    return node.kind === SyntaxKind.ForInStatement;
}

export function createForInStatement(
    body: Block,
    names: Identifier[],
    expressions: Expression[],
    tsOriginal?: ts.Node
): ForInStatement {
    const statement = createNode(SyntaxKind.ForInStatement, tsOriginal) as ForInStatement;
    statement.body = body;
    statement.names = names;
    statement.expressions = expressions;
    return statement;
}

export interface GotoStatement extends Statement {
    kind: SyntaxKind.GotoStatement;
    label: string; // or identifier ?
}

export function isGotoStatement(node: Node): node is GotoStatement {
    return node.kind === SyntaxKind.GotoStatement;
}

export function createGotoStatement(label: string, tsOriginal?: ts.Node): GotoStatement {
    const statement = createNode(SyntaxKind.GotoStatement, tsOriginal) as GotoStatement;
    statement.label = label;
    return statement;
}

export interface LabelStatement extends Statement {
    kind: SyntaxKind.LabelStatement;
    name: string; // or identifier ?
}

export function isLabelStatement(node: Node): node is LabelStatement {
    return node.kind === SyntaxKind.LabelStatement;
}

export function createLabelStatement(name: string, tsOriginal?: ts.Node): LabelStatement {
    const statement = createNode(SyntaxKind.LabelStatement, tsOriginal) as LabelStatement;
    statement.name = name;
    return statement;
}

export interface ReturnStatement extends Statement {
    kind: SyntaxKind.ReturnStatement;
    expressions: Expression[];
}

export function isReturnStatement(node: Node): node is ReturnStatement {
    return node.kind === SyntaxKind.ReturnStatement;
}

export function createReturnStatement(expressions: Expression[], tsOriginal?: ts.Node): ReturnStatement {
    const statement = createNode(SyntaxKind.ReturnStatement, tsOriginal) as ReturnStatement;
    statement.expressions = expressions;
    return statement;
}

export interface BreakStatement extends Statement {
    kind: SyntaxKind.BreakStatement;
}

export function isBreakStatement(node: Node): node is BreakStatement {
    return node.kind === SyntaxKind.BreakStatement;
}

export function createBreakStatement(tsOriginal?: ts.Node): BreakStatement {
    return createNode(SyntaxKind.BreakStatement, tsOriginal) as BreakStatement;
}

export interface ExpressionStatement extends Statement {
    kind: SyntaxKind.ExpressionStatement;
    expression: Expression;
}

export function isExpressionStatement(node: Node): node is ExpressionStatement {
    return node.kind === SyntaxKind.ExpressionStatement;
}

export function createExpressionStatement(expressions: Expression, tsOriginal?: ts.Node): ExpressionStatement {
    const statement = createNode(SyntaxKind.ExpressionStatement, tsOriginal) as ExpressionStatement;
    statement.expression = expressions;
    return statement;
}

export interface Expression extends Node {
    _expressionBrand: any;
}

// Expressions
// TODO maybe create subexport interface for Literals/PrimaryExpressions
export interface NilLiteral extends Expression {
    kind: SyntaxKind.NilKeyword;
}

export function isNilLiteral(node: Node): node is NilLiteral {
    return node.kind === SyntaxKind.NilKeyword;
}

export function createNilLiteral(tsOriginal?: ts.Node): NilLiteral {
    return createNode(SyntaxKind.NilKeyword, tsOriginal) as NilLiteral;
}

export interface BooleanLiteral extends Expression {
    kind: SyntaxKind.TrueKeyword | SyntaxKind.FalseKeyword;
}

export function isBooleanLiteral(node: Node): node is BooleanLiteral {
    return node.kind === SyntaxKind.TrueKeyword || node.kind === SyntaxKind.FalseKeyword;
}

export function createBooleanLiteral(value: boolean, tsOriginal?: ts.Node): BooleanLiteral {
    return createNode(value ? SyntaxKind.TrueKeyword : SyntaxKind.FalseKeyword, tsOriginal) as BooleanLiteral;
}

// TODO Call this DotsLiteral or DotsKeyword?
export interface DotsLiteral extends Expression {
    kind: SyntaxKind.DotsKeyword;
}

export function isDotsLiteral(node: Node): node is DotsLiteral {
    return node.kind === SyntaxKind.DotsKeyword;
}

export function createDotsLiteral(tsOriginal?: ts.Node): DotsLiteral {
    return createNode(SyntaxKind.DotsKeyword, tsOriginal) as DotsLiteral;
}

// StringLiteral / NumberLiteral
// TODO TS uses the export interface "LiteralLikeNode" with a "text: string" member
// but since we don't parse from text I think we can simplify by just having a value member

// TODO NumericLiteral or NumberLiteral?
export interface NumericLiteral extends Expression {
    kind: SyntaxKind.NumericLiteral;
    value: number;
}

export function isNumericLiteral(node: Node): node is NumericLiteral {
    return node.kind === SyntaxKind.NumericLiteral;
}

export function createNumericLiteral(value: number, tsOriginal?: ts.Node): NumericLiteral {
    const expression = createNode(SyntaxKind.NumericLiteral, tsOriginal) as NumericLiteral;
    expression.value = value;
    return expression;
}

export interface StringLiteral extends Expression {
    kind: SyntaxKind.StringLiteral;
    value: string;
}

export function isStringLiteral(node: Node): node is StringLiteral {
    return node.kind === SyntaxKind.StringLiteral;
}

export function createStringLiteral(value: string, tsOriginal?: ts.Node): StringLiteral {
    const expression = createNode(SyntaxKind.StringLiteral, tsOriginal) as StringLiteral;
    expression.value = value;
    return expression;
}

export function isLiteral(
    node: Node
): node is NilLiteral | DotsLiteral | BooleanLiteral | NumericLiteral | StringLiteral {
    return (
        isNilLiteral(node) ||
        isDotsLiteral(node) ||
        isBooleanLiteral(node) ||
        isNumericLiteral(node) ||
        isStringLiteral(node)
    );
}

export interface FunctionExpression extends Expression {
    kind: SyntaxKind.FunctionExpression;
    params?: Identifier[];
    dots?: DotsLiteral;
    body: Block;
}

export function isFunctionExpression(node: Node): node is FunctionExpression {
    return node.kind === SyntaxKind.FunctionExpression;
}

export function createFunctionExpression(
    body: Block,
    params?: Identifier[],
    dots?: DotsLiteral,
    flags = NodeFlags.None,
    tsOriginal?: ts.Node
): FunctionExpression {
    const expression = createNode(SyntaxKind.FunctionExpression, tsOriginal, flags) as FunctionExpression;
    expression.body = body;
    expression.params = params;
    expression.dots = dots;
    return expression;
}

export interface TableFieldExpression extends Expression {
    kind: SyntaxKind.TableFieldExpression;
    value: Expression;
    key?: Expression;
}

export function isTableFieldExpression(node: Node): node is TableFieldExpression {
    return node.kind === SyntaxKind.TableFieldExpression;
}

export function createTableFieldExpression(
    value: Expression,
    key?: Expression,
    tsOriginal?: ts.Node
): TableFieldExpression {
    const expression = createNode(SyntaxKind.TableFieldExpression, tsOriginal) as TableFieldExpression;
    expression.value = value;
    expression.key = key;
    return expression;
}

export interface TableExpression extends Expression {
    kind: SyntaxKind.TableExpression;
    fields: TableFieldExpression[];
}

export function isTableExpression(node: Node): node is TableExpression {
    return node.kind === SyntaxKind.TableExpression;
}

export function createTableExpression(fields: TableFieldExpression[] = [], tsOriginal?: ts.Node): TableExpression {
    const expression = createNode(SyntaxKind.TableExpression, tsOriginal) as TableExpression;
    expression.fields = fields;
    return expression;
}

export interface UnaryExpression extends Expression {
    kind: SyntaxKind.UnaryExpression;
    operand: Expression;
    operator: UnaryOperator;
}

export function isUnaryExpression(node: Node): node is UnaryExpression {
    return node.kind === SyntaxKind.UnaryExpression;
}

export function createUnaryExpression(
    operand: Expression,
    operator: UnaryOperator,
    tsOriginal?: ts.Node
): UnaryExpression {
    const expression = createNode(SyntaxKind.UnaryExpression, tsOriginal) as UnaryExpression;
    expression.operand = operand;
    expression.operator = operator;
    return expression;
}

export interface BinaryExpression extends Expression {
    kind: SyntaxKind.BinaryExpression;
    operator: BinaryOperator;
    left: Expression;
    right: Expression;
}

export function isBinaryExpression(node: Node): node is BinaryExpression {
    return node.kind === SyntaxKind.BinaryExpression;
}

export function createBinaryExpression(
    left: Expression,
    right: Expression,
    operator: BinaryOperator,
    tsOriginal?: ts.Node
): BinaryExpression {
    const expression = createNode(SyntaxKind.BinaryExpression, tsOriginal) as BinaryExpression;
    expression.left = left;
    expression.right = right;
    expression.operator = operator;
    return expression;
}

export interface CallExpression extends Expression {
    kind: SyntaxKind.CallExpression;
    expression: Expression;
    params: Expression[];
}

export function isCallExpression(node: Node): node is CallExpression {
    return node.kind === SyntaxKind.CallExpression;
}

export function createCallExpression(
    expression: Expression,
    params: Expression[],
    tsOriginal?: ts.Node
): CallExpression {
    const callExpression = createNode(SyntaxKind.CallExpression, tsOriginal) as CallExpression;
    callExpression.expression = expression;
    callExpression.params = params;
    return callExpression;
}

export interface MethodCallExpression extends Expression {
    kind: SyntaxKind.MethodCallExpression;
    prefixExpression: Expression;
    name: Identifier;
    params: Expression[];
}

export function isMethodCallExpression(node: Node): node is MethodCallExpression {
    return node.kind === SyntaxKind.MethodCallExpression;
}

export function createMethodCallExpression(
    prefixExpression: Expression,
    name: Identifier,
    params: Expression[],
    tsOriginal?: ts.Node
): MethodCallExpression {
    const callExpression = createNode(SyntaxKind.MethodCallExpression, tsOriginal) as MethodCallExpression;
    callExpression.prefixExpression = prefixExpression;
    callExpression.name = name;
    callExpression.params = params;
    return callExpression;
}

export interface Identifier extends Expression {
    kind: SyntaxKind.Identifier;
    exportable: boolean;
    text: string;
    originalName?: string;
    symbolId?: SymbolId;
}

export function isIdentifier(node: Node): node is Identifier {
    return node.kind === SyntaxKind.Identifier;
}

export function createIdentifier(
    text: string,
    tsOriginal?: ts.Node,
    symbolId?: SymbolId,
    originalName?: string
): Identifier {
    const expression = createNode(SyntaxKind.Identifier, tsOriginal) as Identifier;
    expression.exportable = true;
    expression.text = text;
    expression.symbolId = symbolId;
    expression.originalName = originalName;
    return expression;
}

export function cloneIdentifier(identifier: Identifier, tsOriginal?: ts.Node): Identifier {
    return createIdentifier(identifier.text, tsOriginal, identifier.symbolId, identifier.originalName);
}

export function createAnonymousIdentifier(tsOriginal?: ts.Node): Identifier {
    const expression = createNode(SyntaxKind.Identifier, tsOriginal) as Identifier;
    expression.exportable = false;
    expression.text = "____";
    return expression;
}

export interface TableIndexExpression extends Expression {
    kind: SyntaxKind.TableIndexExpression;
    table: Expression;
    index: Expression;
}

export function isTableIndexExpression(node: Node): node is TableIndexExpression {
    return node.kind === SyntaxKind.TableIndexExpression;
}

export function createTableIndexExpression(
    table: Expression,
    index: Expression,
    tsOriginal?: ts.Node
): TableIndexExpression {
    const expression = createNode(SyntaxKind.TableIndexExpression, tsOriginal) as TableIndexExpression;
    expression.table = table;
    expression.index = index;
    return expression;
}

export type AssignmentLeftHandSideExpression = Identifier | TableIndexExpression;
export function isAssignmentLeftHandSideExpression(node: Node): node is AssignmentLeftHandSideExpression {
    return isIdentifier(node) || isTableIndexExpression(node);
}

export type FunctionDefinition = (VariableDeclarationStatement | AssignmentStatement) & {
    right: [FunctionExpression];
};

export function isFunctionDefinition(
    statement: VariableDeclarationStatement | AssignmentStatement
): statement is FunctionDefinition {
    return statement.left.length === 1 && statement.right?.length === 1 && isFunctionExpression(statement.right[0]);
}

export type InlineFunctionExpression = FunctionExpression & {
    body: { statements: [ReturnStatement & { expressions: Expression[] }] };
};

export function isInlineFunctionExpression(expression: FunctionExpression): expression is InlineFunctionExpression {
    return (
        expression.body.statements?.length === 1 &&
        isReturnStatement(expression.body.statements[0]) &&
        expression.body.statements[0].expressions !== undefined &&
        (expression.flags & NodeFlags.Inline) !== 0
    );
}
