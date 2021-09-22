import * as ts from "typescript";
import * as lua from "../../LuaAST";
import { assert, getOrUpdate, isNonNull } from "../../utils";
import { TransformationContext } from "../context";
import { getSymbolInfo } from "./symbols";
import { findFirstNodeAbove, getFirstDeclarationInFile } from "./typescript";

export enum ScopeType {
    File = 1 << 0,
    Function = 1 << 1,
    Switch = 1 << 2,
    Loop = 1 << 3,
    Conditional = 1 << 4,
    Block = 1 << 5,
    Try = 1 << 6,
    Catch = 1 << 7,
    ExpressionList = 1 << 8,
}

interface FunctionDefinitionInfo {
    referencedSymbols: Map<lua.SymbolId, ts.Node[]>;
    definition?: lua.VariableDeclarationStatement | lua.AssignmentStatement;
}

export interface Scope {
    type: ScopeType;
    id: number;
    node?: ts.Node;
    referencedSymbols?: Map<lua.SymbolId, ts.Node[]>;
    variableDeclarations?: lua.VariableDeclarationStatement[];
    functionDefinitions?: Map<lua.SymbolId, FunctionDefinitionInfo>;
    importStatements?: lua.Statement[];
    loopContinued?: boolean;
    functionReturned?: boolean;
}

export interface HoistingResult {
    statements: lua.Statement[];
    hoistedStatements: lua.Statement[];
    hoistedIdentifiers: lua.Identifier[];
}

const scopeStacks = new WeakMap<TransformationContext, Scope[]>();
function getScopeStack(context: TransformationContext): Scope[] {
    return getOrUpdate(scopeStacks, context, () => []);
}

export function* walkScopesUp(context: TransformationContext): IterableIterator<Scope> {
    const scopeStack = getScopeStack(context);
    for (let i = scopeStack.length - 1; i >= 0; --i) {
        const scope = scopeStack[i];
        yield scope;
    }
}

export function markSymbolAsReferencedInCurrentScopes(
    context: TransformationContext,
    symbolId: lua.SymbolId,
    identifier: ts.Identifier
): void {
    for (const scope of getScopeStack(context)) {
        if (!scope.referencedSymbols) {
            scope.referencedSymbols = new Map();
        }

        const references = getOrUpdate(scope.referencedSymbols, symbolId, () => []);
        references.push(identifier);
    }
}

export function getReferenceCountInScope(scope: Scope, symbolId: lua.SymbolId) {
    if (!scope.referencedSymbols) {
        return 0;
    }
    const referencedSymbols = scope.referencedSymbols.get(symbolId);
    if (!referencedSymbols) {
        return 0;
    }
    return referencedSymbols.length;
}

export function peekScope(context: TransformationContext): Scope {
    const scopeStack = getScopeStack(context);
    const scope = scopeStack[scopeStack.length - 1];
    assert(scope);

    return scope;
}

export function findScope(context: TransformationContext, scopeTypes: ScopeType): Scope | undefined {
    return [...getScopeStack(context)].reverse().find(s => scopeTypes & s.type);
}

const scopeIdCounters = new WeakMap<TransformationContext, number>();
export function pushScope(context: TransformationContext, scopeType: ScopeType): Scope {
    const nextScopeId = (scopeIdCounters.get(context) ?? 0) + 1;
    scopeIdCounters.set(context, nextScopeId);

    const scopeStack = getScopeStack(context);
    const scope: Scope = { type: scopeType, id: nextScopeId };
    scopeStack.push(scope);
    return scope;
}

export function popScope(context: TransformationContext): Scope {
    const scopeStack = getScopeStack(context);
    const scope = scopeStack.pop();
    assert(scope);

    return scope;
}

export function addScopeVariableDeclaration(scope: Scope, declaration: lua.VariableDeclarationStatement) {
    if (!scope.variableDeclarations) {
        scope.variableDeclarations = [];
    }
    scope.variableDeclarations.push(declaration);
}

function isHoistableFunctionDeclaredInScope(symbol: ts.Symbol, scopeNode: ts.Node) {
    return symbol?.declarations?.some(
        d => ts.isFunctionDeclaration(d) && findFirstNodeAbove(d, (n): n is ts.Node => n === scopeNode)
    );
}

// Checks for references to local functions which haven't been defined yet,
// and thus will be hoisted above the current position.
export function hasReferencedUndefinedLocalFunction(context: TransformationContext, scope: Scope) {
    if (!scope.referencedSymbols || !scope.node) {
        return false;
    }
    for (const [symbolId, nodes] of scope.referencedSymbols) {
        const type = context.checker.getTypeAtLocation(nodes[0]);
        if (
            !scope.functionDefinitions?.has(symbolId) &&
            type.getCallSignatures().length > 0 &&
            isHoistableFunctionDeclaredInScope(type.symbol, scope.node)
        ) {
            return true;
        }
    }
    return false;
}

export function hasReferencedSymbol(context: TransformationContext, scope: Scope, symbol: ts.Symbol) {
    if (!scope.referencedSymbols) {
        return;
    }
    for (const nodes of scope.referencedSymbols.values()) {
        if (nodes.some(node => context.checker.getSymbolAtLocation(node) === symbol)) {
            return true;
        }
    }
    return false;
}

export function isFunctionScopeWithDefinition(scope: Scope): scope is Scope & { node: ts.SignatureDeclaration } {
    return scope.node !== undefined && ts.isFunctionLike(scope.node);
}

export function separateHoistedStatements(context: TransformationContext, statements: lua.Statement[]): HoistingResult {
    const scope = peekScope(context);
    const allHoistedStatments: lua.Statement[] = [];
    const allHoistedIdentifiers: lua.Identifier[] = [];

    let { unhoistedStatements, hoistedStatements, hoistedIdentifiers } = hoistFunctionDefinitions(
        context,
        scope,
        statements
    );
    allHoistedStatments.push(...hoistedStatements);
    allHoistedIdentifiers.push(...hoistedIdentifiers);

    ({ unhoistedStatements, hoistedIdentifiers } = hoistVariableDeclarations(context, scope, unhoistedStatements));
    allHoistedIdentifiers.push(...hoistedIdentifiers);

    ({ unhoistedStatements, hoistedStatements } = hoistImportStatements(scope, unhoistedStatements));
    allHoistedStatments.unshift(...hoistedStatements);

    return {
        statements: unhoistedStatements,
        hoistedStatements: allHoistedStatments,
        hoistedIdentifiers: allHoistedIdentifiers,
    };
}

export function performHoisting(context: TransformationContext, statements: lua.Statement[]): lua.Statement[] {
    const result = separateHoistedStatements(context, statements);
    const modifiedStatements = [...result.hoistedStatements, ...result.statements];
    if (result.hoistedIdentifiers.length > 0) {
        modifiedStatements.unshift(lua.createVariableDeclarationStatement(result.hoistedIdentifiers));
    }
    return modifiedStatements;
}

function shouldHoistSymbol(context: TransformationContext, symbolId: lua.SymbolId, scope: Scope): boolean {
    // Always hoist in top-level of switch statements
    if (scope.type === ScopeType.Switch) {
        return true;
    }

    const symbolInfo = getSymbolInfo(context, symbolId);
    if (!symbolInfo) {
        return false;
    }

    const declaration = getFirstDeclarationInFile(symbolInfo.symbol, context.sourceFile);
    if (!declaration) {
        return false;
    }

    if (symbolInfo.firstSeenAtPos < declaration.pos) {
        return true;
    }

    if (scope.functionDefinitions) {
        for (const [functionSymbolId, functionDefinition] of scope.functionDefinitions) {
            assert(functionDefinition.definition);

            const { line, column } = lua.getOriginalPos(functionDefinition.definition);
            if (line !== undefined && column !== undefined) {
                const definitionPos = ts.getPositionOfLineAndCharacter(context.sourceFile, line, column);
                if (
                    functionSymbolId !== symbolId && // Don't recurse into self
                    declaration.pos < definitionPos && // Ignore functions before symbol declaration
                    functionDefinition.referencedSymbols.has(symbolId) &&
                    shouldHoistSymbol(context, functionSymbolId, scope)
                ) {
                    return true;
                }
            }
        }
    }

    return false;
}

function hoistVariableDeclarations(
    context: TransformationContext,
    scope: Scope,
    statements: lua.Statement[]
): { unhoistedStatements: lua.Statement[]; hoistedIdentifiers: lua.Identifier[] } {
    if (!scope.variableDeclarations) {
        return { unhoistedStatements: statements, hoistedIdentifiers: [] };
    }

    const unhoistedStatements = [...statements];
    const hoistedIdentifiers: lua.Identifier[] = [];
    for (const declaration of scope.variableDeclarations) {
        const symbols = declaration.left.map(i => i.symbolId).filter(isNonNull);
        if (symbols.some(s => shouldHoistSymbol(context, s, scope))) {
            const index = unhoistedStatements.indexOf(declaration);
            if (index < 0) {
                continue; // statements array may not contain all statements in the scope (switch-case)
            }

            if (declaration.right) {
                const assignment = lua.createAssignmentStatement(declaration.left, declaration.right);
                lua.setNodePosition(assignment, declaration); // Preserve position info for sourcemap
                unhoistedStatements.splice(index, 1, assignment);
            } else {
                unhoistedStatements.splice(index, 1);
            }

            hoistedIdentifiers.push(...declaration.left);
        }
    }

    return { unhoistedStatements, hoistedIdentifiers };
}

function hoistFunctionDefinitions(
    context: TransformationContext,
    scope: Scope,
    statements: lua.Statement[]
): { unhoistedStatements: lua.Statement[]; hoistedStatements: lua.Statement[]; hoistedIdentifiers: lua.Identifier[] } {
    if (!scope.functionDefinitions) {
        return { unhoistedStatements: statements, hoistedStatements: [], hoistedIdentifiers: [] };
    }

    const unhoistedStatements = [...statements];
    const hoistedStatements: lua.Statement[] = [];
    const hoistedIdentifiers: lua.Identifier[] = [];
    for (const [functionSymbolId, functionDefinition] of scope.functionDefinitions) {
        assert(functionDefinition.definition);

        if (shouldHoistSymbol(context, functionSymbolId, scope)) {
            const index = unhoistedStatements.indexOf(functionDefinition.definition);
            if (index < 0) {
                continue; // statements array may not contain all statements in the scope (switch-case)
            }
            unhoistedStatements.splice(index, 1);

            if (lua.isVariableDeclarationStatement(functionDefinition.definition)) {
                // Separate function definition and variable declaration
                assert(functionDefinition.definition.right);
                hoistedIdentifiers.push(...functionDefinition.definition.left);
                hoistedStatements.push(
                    lua.createAssignmentStatement(
                        functionDefinition.definition.left,
                        functionDefinition.definition.right
                    )
                );
            } else {
                hoistedStatements.push(functionDefinition.definition);
            }
        }
    }

    return { unhoistedStatements, hoistedStatements, hoistedIdentifiers };
}

function hoistImportStatements(
    scope: Scope,
    statements: lua.Statement[]
): { unhoistedStatements: lua.Statement[]; hoistedStatements: lua.Statement[] } {
    return { unhoistedStatements: statements, hoistedStatements: scope.importStatements ?? [] };
}
