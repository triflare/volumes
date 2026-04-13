export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require a getInfo() method in TurboWarp extension classes',
      recommended: false,
    },
    messages: {
      missingGetInfo: 'TurboWarp extension sources should define a class method named getInfo().',
    },
    schema: [],
  },
  create(context) {
    const classHasGetInfo = new Map();
    const registeredClassUsages = [];
    const anonymousMissingNodes = [];
    let turboWarpClassNode = null;

    function isGetInfoMethod(node) {
      const isMethod = node.type === 'MethodDefinition' && node.kind === 'method';
      const isGetInfoIdentifier = node.key?.type === 'Identifier' && node.key.name === 'getInfo';
      const isGetInfoLiteral = node.key?.type === 'Literal' && node.key.value === 'getInfo';
      return isMethod && (isGetInfoIdentifier || isGetInfoLiteral);
    }

    function classExpressionHasGetInfo(node) {
      return Boolean(
        node?.body?.body?.some(
          classMember => classMember.type === 'MethodDefinition' && isGetInfoMethod(classMember)
        )
      );
    }

    return {
      ClassDeclaration(node) {
        if (node.id?.type === 'Identifier') {
          classHasGetInfo.set(node.id.name, classHasGetInfo.get(node.id.name) ?? false);
          if (node.id.name === 'TurboWarpExtension') {
            turboWarpClassNode = node.id;
          }
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type !== 'MemberExpression') return;
        const object = callee.object;
        const property = callee.property;

        if (
          object?.type === 'MemberExpression' &&
          object.object?.type === 'Identifier' &&
          object.object.name === 'Scratch' &&
          object.property?.type === 'Identifier' &&
          object.property.name === 'extensions' &&
          property?.type === 'Identifier' &&
          property.name === 'register'
        ) {
          const [firstArg] = node.arguments;
          if (!firstArg) return;

          if (firstArg.type === 'NewExpression') {
            if (firstArg.callee.type === 'Identifier') {
              registeredClassUsages.push({ name: firstArg.callee.name, node: firstArg.callee });
            } else if (
              firstArg.callee.type === 'ClassExpression' &&
              !classExpressionHasGetInfo(firstArg.callee)
            ) {
              anonymousMissingNodes.push(firstArg.callee);
            }
            return;
          }

          if (firstArg.type === 'Identifier') {
            registeredClassUsages.push({ name: firstArg.name, node: firstArg });
            return;
          }

          if (firstArg.type === 'ClassExpression' && !classExpressionHasGetInfo(firstArg)) {
            anonymousMissingNodes.push(firstArg);
          }
        }
      },
      MethodDefinition(node) {
        if (!isGetInfoMethod(node)) {
          return;
        }

        const classDeclaration = node.parent?.parent;
        if (
          classDeclaration?.type === 'ClassDeclaration' &&
          classDeclaration.id?.type === 'Identifier'
        ) {
          classHasGetInfo.set(classDeclaration.id.name, true);
        }
      },
      'Program:exit'() {
        const registeredClassNames = new Set(registeredClassUsages.map(usage => usage.name));

        for (const usage of registeredClassUsages) {
          if (classHasGetInfo.get(usage.name) !== true) {
            context.report({ node: usage.node, messageId: 'missingGetInfo' });
          }
        }

        if (
          turboWarpClassNode &&
          !registeredClassNames.has('TurboWarpExtension') &&
          classHasGetInfo.get('TurboWarpExtension') !== true
        ) {
          context.report({ node: turboWarpClassNode, messageId: 'missingGetInfo' });
        }

        for (const anonymousMissingNode of anonymousMissingNodes) {
          context.report({ node: anonymousMissingNode, messageId: 'missingGetInfo' });
        }
      },
    };
  },
};
