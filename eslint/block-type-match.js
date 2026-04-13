import { findObjectProperty, getLiteralBooleanValue, getStaticStringValue } from './rule-utils.js';

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Validate block metadata combinations',
      recommended: false,
    },
    messages: {
      terminalReporter:
        "Block type '{{blockType}}' cannot set isTerminal to true. Use a command block or remove isTerminal.",
    },
    schema: [],
  },
  create(context) {
    return {
      ObjectExpression(node) {
        const blockTypeProp = findObjectProperty(node, 'blockType');
        const isTerminalProp = findObjectProperty(node, 'isTerminal');
        if (!blockTypeProp || !isTerminalProp) return;

        const blockType = getStaticStringValue(blockTypeProp.value);
        const isTerminal = getLiteralBooleanValue(isTerminalProp.value);
        if (!isTerminal) return;
        if (blockType !== 'reporter' && blockType !== 'boolean') return;

        context.report({
          node: isTerminalProp.value,
          messageId: 'terminalReporter',
          data: { blockType },
        });
      },
    };
  },
};
