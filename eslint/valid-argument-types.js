import { findObjectProperty, getStaticStringValue } from './rule-utils.js';

const VALID_ARGUMENT_TYPES = new Set([
  'angle',
  'Boolean',
  'color',
  'number',
  'string',
  'matrix',
  'note',
  'image',
]);

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Validate TurboWarp block argument type values',
      recommended: false,
    },
    messages: {
      invalidArgumentType:
        "Invalid TurboWarp argument type '{{argumentType}}'. Use one of: {{allowedTypes}}.",
    },
    schema: [],
  },
  create(context) {
    return {
      Property(node) {
        if (node.key?.type !== 'Identifier' || node.key.name !== 'arguments') return;
        if (!node.value || node.value.type !== 'ObjectExpression') return;

        for (const argProp of node.value.properties) {
          if (argProp.type !== 'Property') continue;
          if (!argProp.value || argProp.value.type !== 'ObjectExpression') continue;

          const typeProp = findObjectProperty(argProp.value, 'type');
          if (!typeProp) continue;

          const argumentType = getStaticStringValue(typeProp.value);
          if (!argumentType || VALID_ARGUMENT_TYPES.has(argumentType)) continue;

          context.report({
            node: typeProp.value,
            messageId: 'invalidArgumentType',
            data: {
              argumentType,
              allowedTypes: [...VALID_ARGUMENT_TYPES].join(', '),
            },
          });
        }
      },
    };
  },
};
