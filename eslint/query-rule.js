export function createQueryRule(rules) {
  return {
    meta: {
      type: 'problem',
      docs: {
        description: 'Rule generated from query selectors',
        recommended: false,
      },
      schema: [],
    },
    create(context) {
      // Build a map from selector -> array of rules so duplicate selectors are preserved
      const selectorMap = new Map();
      for (const rule of rules) {
        if (!selectorMap.has(rule.selector)) selectorMap.set(rule.selector, []);
        selectorMap.get(rule.selector).push(rule);
      }

      const listeners = {};
      for (const [selector, ruleList] of selectorMap.entries()) {
        listeners[selector] = node => {
          for (const r of ruleList) {
            context.report({ node, message: r.message });
          }
        };
      }

      return listeners;
    },
  };
}
