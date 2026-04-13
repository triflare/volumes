import { getPropertyName, getStaticStringValue } from './rule-utils.js';

const CAMEL_CASE_OPCODE = /^[a-z][a-zA-Z0-9]*$/;

export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Require camelCase opcode names',
      recommended: false,
    },
    messages: {
      opcodeCamelCase: "Opcode '{{opcode}}' should use camelCase.",
    },
    schema: [],
  },
  create(context) {
    return {
      Property(node) {
        if (getPropertyName(node) !== 'opcode') return;
        const opcode = getStaticStringValue(node.value);
        if (!opcode || CAMEL_CASE_OPCODE.test(opcode)) return;

        context.report({
          node: node.value,
          messageId: 'opcodeCamelCase',
          data: { opcode },
        });
      },
    };
  },
};
