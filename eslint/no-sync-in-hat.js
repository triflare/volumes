import {
  findObjectProperty,
  getMethodName,
  getStaticStringValue,
  hasLoopStatement,
  getEnclosingClassOrObject,
} from './rule-utils.js';

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Warn when hat blocks use synchronous loops in their implementations',
      recommended: false,
    },
    messages: {
      noSyncInHat:
        "Hat block '{{opcode}}' uses loop-based synchronous work in its method. Consider non-blocking patterns.",
    },
    schema: [],
  },
  create(context) {
    const classScopes = new Map();
    const GLOBAL_SCOPE = Symbol('global');
    classScopes.set(GLOBAL_SCOPE, { opcodes: new Set(), methods: new Map() });

    function processScope(scopeKey) {
      const scope = classScopes.get(scopeKey);
      if (!scope) return;
      const { opcodes, methods } = scope;
      for (const opcode of opcodes) {
        const methodNode = methods.get(opcode);
        if (!methodNode?.value?.body) continue;
        if (!hasLoopStatement(methodNode.value.body)) continue;

        context.report({
          node: methodNode.key,
          messageId: 'noSyncInHat',
          data: { opcode },
        });
      }
    }

    return {
      ClassDeclaration(node) {
        classScopes.set(node, { opcodes: new Set(), methods: new Map() });
      },
      ClassExpression(node) {
        classScopes.set(node, { opcodes: new Set(), methods: new Map() });
      },
      ObjectExpression(node) {
        const classKey = getEnclosingClassOrObject(node) ?? GLOBAL_SCOPE;
        let scope = classScopes.get(classKey);
        if (!scope) {
          scope = { opcodes: new Set(), methods: new Map() };
          classScopes.set(classKey, scope);
        }

        const blockTypeProp = findObjectProperty(node, 'blockType');
        const opcodeProp = findObjectProperty(node, 'opcode');
        const blockType = blockTypeProp ? getStaticStringValue(blockTypeProp.value) : null;
        const opcode = opcodeProp ? getStaticStringValue(opcodeProp.value) : null;
        if (blockType === 'hat' && opcode) {
          scope.opcodes.add(opcode);
        }
      },
      MethodDefinition(node) {
        const methodName = getMethodName(node);
        if (!methodName) return;
        const classKey = getEnclosingClassOrObject(node) ?? GLOBAL_SCOPE;
        let scope = classScopes.get(classKey);
        if (!scope) {
          scope = { opcodes: new Set(), methods: new Map() };
          classScopes.set(classKey, scope);
        }
        scope.methods.set(methodName, node);
      },
      'ClassDeclaration:exit'(node) {
        processScope(node);
        classScopes.delete(node);
      },
      'ClassExpression:exit'(node) {
        processScope(node);
        classScopes.delete(node);
      },
      'Program:exit'() {
        // Process any top-level / global groupings
        processScope(GLOBAL_SCOPE);
      },
    };
  },
};
