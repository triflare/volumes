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
      description: 'Warn when reporter blocks perform potentially heavy synchronous loops',
      recommended: false,
    },
    messages: {
      reporterHeavySync:
        "Reporter block '{{opcode}}' contains synchronous loop logic that may impact runtime performance.",
    },
    schema: [],
  },
  create(context) {
    const classScopes = new Map();
    const GLOBAL_SCOPE = Symbol('global');
    classScopes.set(GLOBAL_SCOPE, { opcodes: new Set(), methods: new Map() });

    return {
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
        if (blockType === 'reporter' && opcode) {
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
      'Program:exit'() {
        for (const [, { opcodes, methods }] of classScopes) {
          for (const opcode of opcodes) {
            const methodNode = methods.get(opcode);
            if (!methodNode?.value?.body) continue;
            if (!hasLoopStatement(methodNode.value.body)) continue;
            context.report({
              node: methodNode.key,
              messageId: 'reporterHeavySync',
              data: { opcode },
            });
          }
        }
      },
    };
  },
};
