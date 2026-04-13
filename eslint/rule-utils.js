function getPropertyName(node) {
  if (!node || node.type !== 'Property') return null;
  if (node.key.type === 'Identifier') return node.key.name;
  if (node.key.type === 'Literal' && typeof node.key.value === 'string') return node.key.value;
  return null;
}

function getStaticStringValue(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked ?? null;
  }
  return null;
}

function getLiteralBooleanValue(node) {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'boolean') return node.value;
  return null;
}

function findObjectProperty(objectNode, keyName) {
  if (!objectNode || objectNode.type !== 'ObjectExpression') return null;
  return objectNode.properties.find(
    property => property.type === 'Property' && getPropertyName(property) === keyName
  );
}

function hasLoopStatement(node) {
  const isAstNode = candidate =>
    candidate && typeof candidate === 'object' && typeof candidate.type === 'string';

  if (!node || typeof node !== 'object') return false;
  if (
    node.type === 'ForStatement' ||
    node.type === 'ForInStatement' ||
    node.type === 'ForOfStatement' ||
    node.type === 'WhileStatement' ||
    node.type === 'DoWhileStatement'
  ) {
    return true;
  }

  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      if (child.some(item => isAstNode(item) && hasLoopStatement(item))) return true;
    } else if (isAstNode(child)) {
      if (hasLoopStatement(child)) return true;
    }
  }
  return false;
}

function getMethodName(node) {
  if (!node?.key) return null;
  if (node.key.type === 'Identifier') return node.key.name;
  if (node.key.type === 'Literal' && typeof node.key.value === 'string') return node.key.value;
  return null;
}

function getEnclosingClassOrObject(node) {
  let current = node?.parent ?? null;
  let objectFallback = null;
  while (current) {
    if (current.type === 'ClassDeclaration' || current.type === 'ClassExpression') return current;
    if (current.type === 'ObjectExpression' && objectFallback === null) objectFallback = current;
    current = current.parent ?? null;
  }
  return objectFallback;
}

export {
  findObjectProperty,
  getLiteralBooleanValue,
  getMethodName,
  getPropertyName,
  getStaticStringValue,
  hasLoopStatement,
  getEnclosingClassOrObject,
};
